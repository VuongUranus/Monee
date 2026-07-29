import type { FastifyPluginAsync } from "fastify";
import type { MarketQuotesRequest, PersistedMarketQuotesResponse } from "@chi-tieu/shared";
import { SharedFundError } from "../lib/repository.js";
import type { MarketServiceError } from "../services/market.js";

export const marketRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { date?: string } }>("/api/market/gold/history", async (request, reply) => {
    const session = app.finance.sessions.getSession(request);
    if (!session) {
      return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    }
    try {
      return await app.finance.marketService.getHistoricalGoldQuote(String(request.query?.date ?? ""));
    } catch (caught) {
      const error = caught as MarketServiceError;
      const status = error.code === "invalid_historical_date" ? 400 : 502;
      return reply.code(status).send({
        error: error.code || "historical_gold_failed",
        message: error.message || "Không lấy được giá vàng tham chiếu theo ngày.",
      });
    }
  });

  app.post<{ Body: Partial<MarketQuotesRequest> & { expectedRevision?: unknown } }>("/api/market/quotes", async (request, reply) => {
    const session = app.finance.sessions.getSession(request);
    if (!session) {
      return reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    }
    if (!Number.isInteger(request.body?.expectedRevision) || Number(request.body.expectedRevision) <= 0) {
      return reply.code(400).send({ error: "invalid_request", message: "Revision không hợp lệ." });
    }
    const { expectedRevision, ...quoteRequest } = request.body ?? {};
    const quotes = await app.finance.marketService.getQuotes(quoteRequest);
    try {
      const persisted = await app.finance.repository.mutatePersonalResource<{
        quotes: typeof quotes;
        affectedPeriods: string[];
      }>(
        session.userId,
        Number(expectedRevision),
        { kind: "market", quotes },
      );
      return {
        quotes,
        workspaceRevision: persisted.workspaceRevision,
        affectedPeriods: persisted.data.affectedPeriods,
      } satisfies PersistedMarketQuotesResponse;
    } catch (error) {
      if (error instanceof SharedFundError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });
};
