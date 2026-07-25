import crypto from "node:crypto";
import fs from "node:fs/promises";
import type {
  FinanceWorkspaceResponse,
  Fund,
  FundDetail,
  FundGoal,
  SharedFundContent,
  SharedFundRecord,
  SharedFundRole,
  SharedFundView,
  StoredFinancePayload,
  UserDatabase,
  UserDatabaseRecord,
  UserProfile,
} from "@chi-tieu/shared";

export interface UserDataRepository {
  provisionUser(profile: UserProfile): Promise<UserProfile>;
  getUserData(userId: string): Promise<StoredFinancePayload>;
  saveUserData(userId: string, data: StoredFinancePayload): Promise<void>;
  getWorkspace(userId: string): Promise<FinanceWorkspaceResponse>;
  createSharedFund(ownerId: string, fundId: string, email: string, role: SharedFundRole): Promise<SharedFundView>;
  saveSharedFund(userId: string, fundId: string, revision: number, content: SharedFundContent): Promise<SharedFundView>;
  setSharedFundMember(ownerId: string, fundId: string, email: string, role: SharedFundRole): Promise<SharedFundView>;
  removeSharedFundMember(ownerId: string, fundId: string, memberId: string): Promise<void>;
  deleteSharedFund(ownerId: string, fundId: string): Promise<void>;
  addSharedFundContribution(userId: string, fundId: string, month: string, amount: number, note: string): Promise<SharedFundView>;
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
    && (value.schemaVersion === 3 || value.schemaVersion === 4)
    && isObject(value.users);
}

export class SharedFundError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) {
    super(message);
  }
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

  #ensureV4(database: UserDatabase): Record<string, SharedFundRecord> {
    database.schemaVersion = 4;
    database.sharedFunds ??= {};
    return database.sharedFunds;
  }

  #view(database: UserDatabase, record: SharedFundRecord, userId: string): SharedFundView {
    const owner = database.users[record.ownerId]?.profile;
    if (!owner) throw new SharedFundError("owner_not_found", 500, "Không tìm thấy chủ quỹ.");
    const role = record.ownerId === userId ? "owner" : record.members[userId]?.role;
    if (!role) throw new SharedFundError("forbidden", 403, "Bạn không có quyền truy cập quỹ này.");
    return {
      id: record.id,
      revision: record.revision,
      content: structuredClone(record.content),
      owner: { sub: owner.sub, name: owner.name, email: owner.email },
      role,
      contributors: Object.fromEntries(Object.values(record.content.contributions ?? {}).flat().flatMap((entry) => {
        const profile = database.users[entry.memberId]?.profile;
        return profile ? [[entry.memberId, { sub: profile.sub, name: profile.name, email: profile.email }]] : [];
      })),
      ...(role === "owner" ? {
        members: Object.values(record.members).flatMap((member) => {
          const profile = database.users[member.userId]?.profile;
          return profile ? [{ user: { sub: profile.sub, name: profile.name, email: profile.email }, role: member.role }] : [];
        }),
      } : {}),
    };
  }

  #sharedContent(data: StoredFinancePayload, fundId: string, sharedId: string): SharedFundContent {
    const raw = data as any;
    const fund = Array.isArray(raw.funds) ? raw.funds.find((item: Fund) => item?.id === fundId) : undefined;
    if (!fund) throw new SharedFundError("fund_not_found", 404, "Không tìm thấy quỹ để chia sẻ.");
    const years: SharedFundContent["years"] = {};
    for (const [year, value] of Object.entries(raw.years ?? {})) {
      const dataForYear = value as any;
      years[year] = {
        funds: structuredClone(dataForYear?.funds?.[fundId] ?? new Array(12).fill(0)),
        details: structuredClone(dataForYear?.details?.[fundId] ?? new Array<FundDetail>(12).fill(null)),
      };
    }
    return {
      fund: { ...structuredClone(fund), id: sharedId, sharing: undefined },
      years,
      goal: structuredClone(raw.goals?.[fundId] ?? { years: {}, all: 0 }) as FundGoal,
      fundPlan: Number(raw.financialProfile?.fundPlan?.[fundId]) || 0,
      openingBalance: Number(raw.financialProfile?.openingBalances?.[fundId]) || 0,
      contributions: {},
    };
  }

  #removePrivateFund(data: StoredFinancePayload, fundId: string): void {
    const raw = data as any;
    raw.funds = (raw.funds ?? []).filter((item: Fund) => item.id !== fundId);
    for (const year of Object.values(raw.years ?? {}) as any[]) {
      delete year.funds?.[fundId];
      delete year.details?.[fundId];
    }
    delete raw.goals?.[fundId];
    delete raw.financialProfile?.fundPlan?.[fundId];
    delete raw.financialProfile?.openingBalances?.[fundId];
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

      this.#ensureV4(current);

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

  async getWorkspace(userId: string): Promise<FinanceWorkspaceResponse> {
    const database = await this.#read();
    if (!isUserDatabase(database) || !database.users[userId]) throw new Error("Không tìm thấy dữ liệu tài khoản.");
    const sharedFunds = Object.values(database.sharedFunds ?? {})
      .filter((fund) => fund.ownerId === userId || Boolean(fund.members[userId]))
      .map((fund) => this.#view(database, fund, userId));
    return { data: structuredClone(database.users[userId].data), sharedFunds };
  }

  async createSharedFund(ownerId: string, fundId: string, email: string, role: SharedFundRole): Promise<SharedFundView> {
    let result: SharedFundView | undefined;
    await this.#serialize(async () => {
      const database = JSON.parse(await fs.readFile(this.#databasePath, "utf8")) as unknown;
      if (!isUserDatabase(database) || !database.users[ownerId]) throw new Error("Không tìm thấy dữ liệu tài khoản.");
      const target = Object.values(database.users).find((entry) => entry.profile.email.toLowerCase() === email.trim().toLowerCase());
      if (!target) throw new SharedFundError("member_not_found", 404, "Email này chưa từng đăng nhập ứng dụng.");
      if (target.profile.sub === ownerId) throw new SharedFundError("cannot_share_self", 400, "Không thể chia sẻ quỹ với chính bạn.");
      const sharedFunds = this.#ensureV4(database);
      const id = `shared-${this.#randomBytes(12).toString("hex")}`;
      const timestamp = new Date(this.#now()).toISOString();
      const record: SharedFundRecord = {
        id,
        ownerId,
        revision: 1,
        content: this.#sharedContent(database.users[ownerId].data, fundId, id),
        members: { [target.profile.sub]: { userId: target.profile.sub, role, addedAt: timestamp } },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.#removePrivateFund(database.users[ownerId].data, fundId);
      database.users[ownerId].updatedAt = timestamp;
      sharedFunds[id] = record;
      result = this.#view(database, record, ownerId);
      await this.#write(database);
    });
    return result!;
  }

  async saveSharedFund(userId: string, fundId: string, revision: number, content: SharedFundContent): Promise<SharedFundView> {
    let result: SharedFundView | undefined;
    await this.#serialize(async () => {
      const database = JSON.parse(await fs.readFile(this.#databasePath, "utf8")) as unknown;
      if (!isUserDatabase(database)) throw new Error("Không tìm thấy dữ liệu tài khoản.");
      const record = database.sharedFunds?.[fundId];
      if (!record) throw new SharedFundError("fund_not_found", 404, "Không tìm thấy quỹ chung.");
      const role = record.ownerId === userId ? "owner" : record.members[userId]?.role;
      if (role !== "owner" && role !== "editor") throw new SharedFundError("forbidden", 403, "Bạn chỉ có quyền xem quỹ này.");
      if (record.revision !== revision) throw new SharedFundError("shared_fund_conflict", 409, "Quỹ đã được người khác cập nhật. Hãy tải lại.");
      const contributions = record.content.contributions ?? {};
      record.content = structuredClone(content);
      record.content.contributions = contributions;
      record.content.fund.id = record.id;
      delete record.content.fund.sharing;
      record.revision += 1;
      record.updatedAt = new Date(this.#now()).toISOString();
      result = this.#view(database, record, userId);
      await this.#write(database);
    });
    return result!;
  }

  async setSharedFundMember(ownerId: string, fundId: string, email: string, role: SharedFundRole): Promise<SharedFundView> {
    let result: SharedFundView | undefined;
    await this.#serialize(async () => {
      const database = JSON.parse(await fs.readFile(this.#databasePath, "utf8")) as unknown;
      if (!isUserDatabase(database)) throw new Error("Không tìm thấy dữ liệu tài khoản.");
      const record = database.sharedFunds?.[fundId];
      if (!record) throw new SharedFundError("fund_not_found", 404, "Không tìm thấy quỹ chung.");
      if (record.ownerId !== ownerId) throw new SharedFundError("forbidden", 403, "Chỉ chủ quỹ được quản lý thành viên.");
      const target = Object.values(database.users).find((entry) => entry.profile.email.toLowerCase() === email.trim().toLowerCase());
      if (!target) throw new SharedFundError("member_not_found", 404, "Email này chưa từng đăng nhập ứng dụng.");
      if (target.profile.sub === ownerId) throw new SharedFundError("cannot_share_self", 400, "Không thể thêm chính bạn.");
      record.members[target.profile.sub] = { userId: target.profile.sub, role, addedAt: new Date(this.#now()).toISOString() };
      result = this.#view(database, record, ownerId);
      await this.#write(database);
    });
    return result!;
  }

  async removeSharedFundMember(ownerId: string, fundId: string, memberId: string): Promise<void> {
    await this.#serialize(async () => {
      const database = JSON.parse(await fs.readFile(this.#databasePath, "utf8")) as unknown;
      if (!isUserDatabase(database)) throw new Error("Không tìm thấy dữ liệu tài khoản.");
      const record = database.sharedFunds?.[fundId];
      if (!record) throw new SharedFundError("fund_not_found", 404, "Không tìm thấy quỹ chung.");
      if (record.ownerId !== ownerId) throw new SharedFundError("forbidden", 403, "Chỉ chủ quỹ được quản lý thành viên.");
      delete record.members[memberId];
      await this.#write(database);
    });
  }

  async deleteSharedFund(ownerId: string, fundId: string): Promise<void> {
    await this.#serialize(async () => {
      const database = JSON.parse(await fs.readFile(this.#databasePath, "utf8")) as unknown;
      if (!isUserDatabase(database)) throw new Error("Không tìm thấy dữ liệu tài khoản.");
      const record = database.sharedFunds?.[fundId];
      if (!record) throw new SharedFundError("fund_not_found", 404, "Không tìm thấy quỹ chung.");
      if (record.ownerId !== ownerId) throw new SharedFundError("forbidden", 403, "Chỉ chủ quỹ được xóa quỹ.");
      delete database.sharedFunds![fundId];
      await this.#write(database);
    });
  }

  async addSharedFundContribution(userId: string, fundId: string, month: string, amount: number, note: string): Promise<SharedFundView> {
    let result: SharedFundView | undefined;
    await this.#serialize(async () => {
      const database = JSON.parse(await fs.readFile(this.#databasePath, "utf8")) as unknown;
      if (!isUserDatabase(database)) throw new Error("Không tìm thấy dữ liệu tài khoản.");
      const record = database.sharedFunds?.[fundId];
      if (!record) throw new SharedFundError("fund_not_found", 404, "Không tìm thấy quỹ chung.");
      const role = record.ownerId === userId ? "owner" : record.members[userId]?.role;
      if (role !== "owner" && role !== "editor") throw new SharedFundError("forbidden", 403, "Bạn chỉ có quyền xem quỹ này.");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !(amount > 0) || !Number.isFinite(amount)) {
        throw new SharedFundError("invalid_contribution", 400, "Khoản đóng góp không hợp lệ.");
      }
      const timestamp = new Date(this.#now()).toISOString();
      record.content.contributions ??= {};
      record.content.contributions[month] ??= [];
      record.content.contributions[month].push({
        id: `contribution-${this.#randomBytes(10).toString("hex")}`,
        memberId: userId,
        amount: Math.round(amount),
        note: note.trim(),
        createdAt: timestamp,
      });
      record.revision += 1;
      record.updatedAt = timestamp;
      result = this.#view(database, record, userId);
      await this.#write(database);
    });
    return result!;
  }
}
