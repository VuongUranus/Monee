import type { FastifyPluginAsync } from "fastify";
import type { SharedFundContent, SharedFundRole, StoredFinancePayload } from "@chi-tieu/shared";
import { SharedFundError } from "../lib/repository.js";

function isObject(value: unknown): value is StoredFinancePayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function role(value: unknown): SharedFundRole | null {
  return value === "viewer" || value === "editor" ? value : null;
}

function sendError(reply: any, error: unknown): any {
  if (error instanceof SharedFundError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  throw error;
}

export const dataRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/data", async (request, reply) => {
    const session = app.finance.sessions.getSession(request);
    if (!session) {
      return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    }
    return app.finance.repository.getWorkspace(session.userId);
  });

  app.put<{ Body: unknown }>("/api/data", async (request, reply) => {
    const session = app.finance.sessions.getSession(request);
    if (!session) {
      return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    }
    if (!isObject(request.body)) return reply.code(400).type("text/plain").send("Invalid JSON");
    await app.finance.repository.saveUserData(session.userId, request.body);
    return reply.code(204).send();
  });

  app.post<{ Body: { fundId?: unknown; email?: unknown; role?: unknown } }>("/api/shared-funds", async (request, reply) => {
    const session = app.finance.sessions.getSession(request);
    if (!session) return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    const memberRole = role(request.body?.role);
    if (typeof request.body?.fundId !== "string" || typeof request.body?.email !== "string" || !memberRole) {
      return reply.code(400).send({ error: "invalid_request", message: "Thông tin chia sẻ không hợp lệ." });
    }
    try {
      return await app.finance.repository.createSharedFund(session.userId, request.body.fundId, request.body.email, memberRole);
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Params: { id: string }; Body: { revision?: unknown; content?: unknown } }>("/api/shared-funds/:id", async (request, reply) => {
    const session = app.finance.sessions.getSession(request);
    if (!session) return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    if (!Number.isInteger(request.body?.revision) || !isObject(request.body?.content)) {
      return reply.code(400).send({ error: "invalid_request", message: "Dữ liệu quỹ không hợp lệ." });
    }
    try {
      return await app.finance.repository.saveSharedFund(session.userId, request.params.id, request.body.revision as number, request.body.content as unknown as SharedFundContent);
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Params: { id: string }; Body: { email?: unknown; role?: unknown } }>("/api/shared-funds/:id/members", async (request, reply) => {
    const session = app.finance.sessions.getSession(request);
    if (!session) return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    const memberRole = role(request.body?.role);
    if (typeof request.body?.email !== "string" || !memberRole) return reply.code(400).send({ error: "invalid_request", message: "Thông tin thành viên không hợp lệ." });
    try {
      return await app.finance.repository.setSharedFundMember(session.userId, request.params.id, request.body.email, memberRole);
    } catch (error) { return sendError(reply, error); }
  });

  app.delete<{ Params: { id: string; memberId: string } }>("/api/shared-funds/:id/members/:memberId", async (request, reply) => {
    const session = app.finance.sessions.getSession(request);
    if (!session) return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    try {
      await app.finance.repository.removeSharedFundMember(session.userId, request.params.id, request.params.memberId);
      return reply.code(204).send();
    } catch (error) { return sendError(reply, error); }
  });

  app.delete<{ Params: { id: string } }>("/api/shared-funds/:id", async (request, reply) => {
    const session = app.finance.sessions.getSession(request);
    if (!session) return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    try {
      await app.finance.repository.deleteSharedFund(session.userId, request.params.id);
      return reply.code(204).send();
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Params: { id: string }; Body: { month?: unknown; amount?: unknown; note?: unknown } }>("/api/shared-funds/:id/contributions", async (request, reply) => {
    const session = app.finance.sessions.getSession(request);
    if (!session) return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    if (typeof request.body?.month !== "string" || typeof request.body?.amount !== "number" || (request.body.note !== undefined && typeof request.body.note !== "string")) {
      return reply.code(400).send({ error: "invalid_request", message: "Khoản đóng góp không hợp lệ." });
    }
    try {
      return await app.finance.repository.addSharedFundContribution(session.userId, request.params.id, request.body.month, request.body.amount, request.body.note ?? "");
    } catch (error) { return sendError(reply, error); }
  });
};
