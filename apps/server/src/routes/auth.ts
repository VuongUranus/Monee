import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import type { UserProfile } from "@chi-tieu/shared";
import { OAUTH_STATE_TTL_MS, SESSION_TTL_MS } from "../lib/session.js";

interface GoogleStartQuery {
  returnTo?: string;
}

interface GoogleCallbackQuery {
  state?: string;
  code?: string;
  error?: string;
}

function requireOAuth(app: FastifyInstance, reply: FastifyReply): boolean {
  if (app.finance.config.oauthConfigured) return true;
  void reply.code(503).send({
    error: "oauth_not_configured",
    message: "Google OAuth chưa được cấu hình. Hãy đặt GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET và SESSION_SECRET.",
  });
  return false;
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/auth/me", async (request, reply) => {
    const session = app.finance.sessions.getSession(request);
    if (!session) {
      return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    }
    return { user: session.profile };
  });

  app.get<{ Querystring: GoogleStartQuery }>("/api/auth/google", async (request, reply) => {
    if (!requireOAuth(app, reply)) return reply;
    const { config, sessions } = app.finance;
    const { state, challenge } = await sessions.beginOAuth(request.query.returnTo);
    const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizeUrl.search = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: `${config.appBaseUrl}/api/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return reply
      .setCookie("finance_oauth_state", state, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies,
        maxAge: OAUTH_STATE_TTL_MS / 1000,
      })
      .redirect(authorizeUrl.toString());
  });

  app.get<{ Querystring: GoogleCallbackQuery }>("/api/auth/google/callback", async (request, reply) => {
    if (!requireOAuth(app, reply)) return reply;
    const { config, sessions, fetchImpl, repository } = app.finance;
    const { state, code, error: oauthError } = request.query;
    const pending = await sessions.consumeOAuth(state, request.cookies.finance_oauth_state);
    if (!pending) return reply.code(400).type("text/plain").send("Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
    if (oauthError || !code) {
      return reply.code(400).type("text/plain").send("Đăng nhập Google đã bị hủy hoặc không thành công.");
    }

    const tokenResponse = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: `${config.appBaseUrl}/api/auth/google/callback`,
        grant_type: "authorization_code",
        code_verifier: pending.verifier,
      }).toString(),
    });
    const token = await tokenResponse.json().catch(() => null) as { access_token?: string } | null;
    if (!tokenResponse.ok || !token?.access_token) {
      return reply.code(401).type("text/plain").send("Không thể xác thực với Google.");
    }

    const profileResponse = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const profile = await profileResponse.json().catch(() => null) as Partial<UserProfile> & { email_verified?: boolean | string } | null;
    if (!profileResponse.ok || !profile?.sub || !profile.email || !(profile.email_verified === true || profile.email_verified === "true")) {
      return reply.code(401).type("text/plain").send("Google không trả về email đã xác thực.");
    }

    const account = await repository.provisionUser({
      sub: String(profile.sub),
      email: String(profile.email),
      name: String(profile.name || profile.email),
      picture: typeof profile.picture === "string" ? profile.picture : "",
    });
    const sessionId = await sessions.createSession(account);
    reply
      .setCookie("finance_session", sessions.signedSessionValue(sessionId), {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies,
        maxAge: SESSION_TTL_MS / 1000,
      })
      .setCookie("finance_oauth_state", "", {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies,
        maxAge: 0,
      });
    return reply.redirect(pending.returnTo);
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const { sessions, config } = app.finance;
    await sessions.deleteSession(request.cookies.finance_session);
    return reply
      .clearCookie("finance_session", {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies,
      })
      .code(204)
      .send();
  });
};
