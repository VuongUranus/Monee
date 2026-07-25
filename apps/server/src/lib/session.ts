import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { UserProfile } from "@chi-tieu/shared";
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
  readonly sessions = new Map<string, Session>();
  readonly oauthStates = new Map<string, PendingOAuthState>();
  readonly #config: AppConfig;
  readonly #now: () => number;
  readonly #randomBytes: (size: number) => Buffer;

  constructor({ config, now = () => Date.now(), randomBytes = crypto.randomBytes }: SessionManagerOptions) {
    this.#config = config;
    this.#now = now;
    this.#randomBytes = randomBytes;
  }

  cleanupExpired(): void {
    const time = this.#now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= time) this.sessions.delete(id);
    }
    for (const [state, pending] of this.oauthStates) {
      if (pending.expiresAt <= time) this.oauthStates.delete(state);
    }
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

  getSession(request: FastifyRequest): Session | null {
    this.cleanupExpired();
    const id = this.sessionIdFromSigned(request.cookies.finance_session);
    return id ? this.sessions.get(id) ?? null : null;
  }

  beginOAuth(returnTo: unknown): { state: string; challenge: string } {
    this.cleanupExpired();
    const state = base64Url(this.#randomBytes(32));
    const verifier = base64Url(this.#randomBytes(48));
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    this.oauthStates.set(state, {
      verifier,
      returnTo: safeReturnTo(returnTo),
      expiresAt: this.#now() + OAUTH_STATE_TTL_MS,
    });
    return { state, challenge };
  }

  consumeOAuth(state: string | undefined, stateCookie: string | undefined): PendingOAuthState | null {
    this.cleanupExpired();
    const pending = state ? this.oauthStates.get(state) : undefined;
    if (!state || !pending || pending.expiresAt <= this.#now() || stateCookie !== state) return null;
    this.oauthStates.delete(state);
    return pending;
  }

  createSession(profile: UserProfile): string {
    const id = base64Url(this.#randomBytes(32));
    this.sessions.set(id, {
      userId: profile.sub,
      profile,
      expiresAt: this.#now() + SESSION_TTL_MS,
    });
    return id;
  }

  deleteSession(signedValue: string | undefined): void {
    const id = this.sessionIdFromSigned(signedValue);
    if (id) this.sessions.delete(id);
  }
}
