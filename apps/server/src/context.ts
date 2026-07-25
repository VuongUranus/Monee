import type { UserDataRepository } from "./lib/repository.js";
import type { SessionManager } from "./lib/session.js";
import type { AppConfig } from "./lib/config.js";
import type { FetchLike, MarketService } from "./services/market.js";

export interface FinanceContext {
  config: AppConfig;
  repository: UserDataRepository;
  sessions: SessionManager;
  marketService: MarketService;
  fetchImpl: FetchLike;
}

declare module "fastify" {
  interface FastifyInstance {
    finance: FinanceContext;
  }
}
