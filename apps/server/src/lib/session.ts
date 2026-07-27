import crypto from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { UserProfile } from "@chi-tieu/shared";
import { authSessions, oauthLoginStates, users } from "../db/schema.js";
import type { FinanceDatabase } from "../db/client.js";
import type { AppConfig } from "./config.js";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface Session {
  userId: string;
  profile: UserProfile;
  expiresAt: number;
}

export interface PendingOAuthState {
  verifier: string;
  returnTo: string;
  expiresAt: number;
}

export interface SessionManagerOptions {
  config: AppConfig;
  db: FinanceDatabase;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function safeReturnTo(value: unknown): string {
  return ["/funds", "/statistics"].includes(String(value)) ? String(value) : "/expenses";
}

export class SessionManager {
  readonly #config: AppConfig;
  readonly #db: FinanceDatabase;
  readonly #now: () => number;
  readonly #randomBytes: (size: number) => Buffer;
  readonly #requestSessions = new WeakMap<FastifyRequest, Session | null>();

  constructor({ config, db, now = () => Date.now(), randomBytes = crypto.randomBytes }: SessionManagerOptions) {
    this.#config = config;
    this.#db = db;
    this.#now = now;
    this.#randomBytes = randomBytes;
  }

  async cleanupExpired(): Promise<void> {
    const time = new Date(this.#now());
    await Promise.all([
      this.#db.delete(authSessions).where(lte(authSessions.expiresAt, time)),
      this.#db.delete(oauthLoginStates).where(lte(oauthLoginStates.expiresAt, time)),
    ]);
  }

  signature(value: string): string {
    return crypto.createHmac("sha256", this.#config.sessionSecret || "not-configured")
      .update(value)
      .digest("base64url");
  }

  signedSessionValue(sessionId: string): string {
    return `${sessionId}.${this.signature(sessionId)}`;
  }

  sessionIdFromSigned(value: string | undefined): string | null {
    if (!value) return null;
    const dot = value.lastIndexOf(".");
    if (dot < 1) return null;
    const id = value.slice(0, dot);
    const received = Buffer.from(value.slice(dot + 1));
    const expected = Buffer.from(this.signature(id));
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
    return id;
  }

  async authenticate(request: FastifyRequest): Promise<void> {
    const id = this.sessionIdFromSigned(request.cookies.finance_session);
    if (!id) {
      this.#requestSessions.set(request, null);
      return;
    }
    const [record] = await this.#db
      .select({
        userId: authSessions.userId,
        expiresAt: authSessions.expiresAt,
        sub: users.id,
        email: users.email,
        name: users.name,
        picture: users.picture,
      })
      .from(authSessions)
      .innerJoin(users, eq(authSessions.userId, users.id))
      .where(and(eq(authSessions.id, id), gt(authSessions.expiresAt, new Date(this.#now()))))
      .limit(1);
    this.#requestSessions.set(request, record ? {
      userId: record.userId,
      profile: { sub: record.sub, email: record.email, name: record.name, picture: record.picture },
      expiresAt: record.expiresAt.getTime(),
    } : null);
  }

  getSession(request: FastifyRequest): Session | null {
    return this.#requestSessions.get(request) ?? null;
  }

  async beginOAuth(returnTo: unknown): Promise<{ state: string; challenge: string }> {
    await this.cleanupExpired();
    const state = base64Url(this.#randomBytes(32));
    const verifier = base64Url(this.#randomBytes(48));
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    await this.#db.insert(oauthLoginStates).values({
      state,
      verifier,
      returnTo: safeReturnTo(returnTo),
      expiresAt: new Date(this.#now() + OAUTH_STATE_TTL_MS),
    });
    return { state, challenge };
  }

  async consumeOAuth(state: string | undefined, stateCookie: string | undefined): Promise<PendingOAuthState | null> {
    if (!state || stateCookie !== state) return null;
    const [pending] = await this.#db
      .delete(oauthLoginStates)
      .where(and(eq(oauthLoginStates.state, state), gt(oauthLoginStates.expiresAt, new Date(this.#now()))))
      .returning({ verifier: oauthLoginStates.verifier, returnTo: oauthLoginStates.returnTo, expiresAt: oauthLoginStates.expiresAt });
    return pending ? { ...pending, expiresAt: pending.expiresAt.getTime() } : null;
  }

  async createSession(profile: UserProfile): Promise<string> {
    await this.cleanupExpired();
    const id = base64Url(this.#randomBytes(32));
    const now = this.#now();
    await this.#db.insert(authSessions).values({
      id,
      userId: profile.sub,
      createdAt: new Date(now),
      expiresAt: new Date(now + SESSION_TTL_MS),
    });
    return id;
  }

  async deleteSession(signedValue: string | undefined): Promise<void> {
    const id = this.sessionIdFromSigned(signedValue);
    if (id) await this.#db.delete(authSessions).where(eq(authSessions.id, id));
  }
}
