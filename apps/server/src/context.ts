import type { UserDataRepository } from "./lib/repository.js";
import type { SessionManager } from "./lib/session.js";
import type { AppConfig } from "./lib/config.js";
import type { FetchLike, MarketService } from "./services/market.js";
import type { AssistantService } from "./services/assistant.js";

export interface FinanceContext {
  config: AppConfig;
  repository: UserDataRepository;
  sessions: SessionManager;
  marketService: MarketService;
  assistantService: AssistantService | null;
  fetchImpl: FetchLike;
}

declare module "fastify" {
  interface FastifyInstance {
    finance: FinanceContext;
  }
}
