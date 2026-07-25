import crypto from "node:crypto";
import fs from "node:fs/promises";
import type {
  StoredFinancePayload,
  UserDatabase,
  UserDatabaseRecord,
  UserProfile,
} from "@chi-tieu/shared";

export interface UserDataRepository {
  provisionUser(profile: UserProfile): Promise<UserProfile>;
  getUserData(userId: string): Promise<StoredFinancePayload>;
  saveUserData(userId: string, data: StoredFinancePayload): Promise<void>;
}

export interface JsonUserRepositoryOptions {
  databasePath: string;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isUserDatabase(value: unknown): value is UserDatabase {
  return isObject(value)
    && value.schemaVersion === 3
    && isObject(value.users);
}

export function createEmptyUserData(): StoredFinancePayload {
  return { onboarding: { status: "pending", version: 1 } };
}

export function cleanUserProfile(profile: UserProfile): UserProfile {
  return {
    sub: String(profile.sub),
    email: String(profile.email),
    name: String(profile.name || profile.email),
    picture: typeof profile.picture === "string" ? profile.picture : "",
  };
}

export class JsonUserRepository implements UserDataRepository {
  readonly #databasePath: string;
  readonly #now: () => number;
  readonly #randomBytes: (size: number) => Buffer;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor({
    databasePath,
    now = () => Date.now(),
    randomBytes = crypto.randomBytes,
  }: JsonUserRepositoryOptions) {
    this.#databasePath = databasePath;
    this.#now = now;
    this.#randomBytes = randomBytes;
  }

  async #read(): Promise<StoredFinancePayload | UserDatabase> {
    await this.#writeQueue;
    const parsed: unknown = JSON.parse(await fs.readFile(this.#databasePath, "utf8"));
    if (!isObject(parsed)) throw new Error("Data must be a JSON object");
    return parsed;
  }

  async #write(value: StoredFinancePayload | UserDatabase): Promise<void> {
    const temporaryPath = `${this.#databasePath}.${process.pid}.${this.#randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, this.#databasePath);
  }

  #serialize(change: () => Promise<void>): Promise<void> {
    const operation = this.#writeQueue.then(change);
    this.#writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async provisionUser(profile: UserProfile): Promise<UserProfile> {
    const cleanProfile = cleanUserProfile(profile);
    await this.#serialize(async () => {
      const current: unknown = JSON.parse(await fs.readFile(this.#databasePath, "utf8"));
      if (!isObject(current)) throw new Error("Data must be a JSON object");
      const timestamp = new Date(this.#now()).toISOString();

      if (!isUserDatabase(current)) {
        const database: UserDatabase = {
          schemaVersion: 3,
          users: {
            [cleanProfile.sub]: {
              profile: cleanProfile,
              data: current,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          },
        };
        await this.#write(database);
        return;
      }

      const existing = current.users[cleanProfile.sub];
      if (existing) {
        existing.profile = cleanProfile;
        existing.updatedAt = timestamp;
      } else {
        const record: UserDatabaseRecord = {
          profile: cleanProfile,
          data: createEmptyUserData(),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        current.users[cleanProfile.sub] = record;
      }
      await this.#write(current);
    });
    return cleanProfile;
  }

  async getUserData(userId: string): Promise<StoredFinancePayload> {
    const database = await this.#read();
    if (!isUserDatabase(database) || !database.users[userId]) {
      throw new Error("Không tìm thấy dữ liệu tài khoản.");
    }
    return database.users[userId].data;
  }

  async saveUserData(userId: string, data: StoredFinancePayload): Promise<void> {
    if (!isObject(data)) throw new Error("Data must be a JSON object");
    await this.#serialize(async () => {
      const database: unknown = JSON.parse(await fs.readFile(this.#databasePath, "utf8"));
      if (!isUserDatabase(database) || !database.users[userId]) {
        throw new Error("Không tìm thấy dữ liệu tài khoản.");
      }
      database.users[userId].data = data;
      database.users[userId].updatedAt = new Date(this.#now()).toISOString();
      await this.#write(database);
    });
  }
}
