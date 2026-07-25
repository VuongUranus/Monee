import type { FastifyPluginAsync } from "fastify";
import type { MarketQuotesRequest } from "@chi-tieu/shared";

export const marketRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: Partial<MarketQuotesRequest> }>("/api/market/quotes", async (request, reply) => {
    if (!app.finance.sessions.getSession(request)) {
      return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    }
    return app.finance.marketService.getQuotes(request.body ?? {});
  });
};
