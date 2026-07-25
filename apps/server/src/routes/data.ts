import type { FastifyPluginAsync } from "fastify";
import type { StoredFinancePayload } from "@chi-tieu/shared";

function isObject(value: unknown): value is StoredFinancePayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const dataRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/data", async (request, reply) => {
    const session = app.finance.sessions.getSession(request);
    if (!session) {
      return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    }
    return app.finance.repository.getUserData(session.userId);
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
};
