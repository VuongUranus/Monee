import crypto from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type {
  ExpenseConfigResponse,
  ExpenseMonthSummaryResponse,
  ExpenseTransactionView,
  DebtDetailResponse,
  DebtOverviewResponse,
  FinanceBootstrapResponse,
  FundMonthDetailResponse,
  FundOverviewResponse,
  SharedFundContributionsResponse,
  SharedFundMembersResponse,
  SharedFundRole,
  StatisticsResponse,
  StatisticsScope,
  StoredFinancePayload,
  TransactionPageResponse,
  TransactionQuery,
  TransactionMutationResult,
  UserProfile,
} from "@chi-tieu/shared";
import { createDefaultStore } from "@chi-tieu/shared";
import type { FinanceDatabase } from "../db/client.js";
import {
  assemblePersonalStore,
  replacePersonalStore,
  storeAsPayload,
} from "../db/finance-persistence.js";
import {
  readBootstrap,
  readExpenseConfig,
  readExpenseSummary,
  readFundMonthDetail,
  readFundOverview,
  readSharedFundContributions,
  readSharedFundMembers,
  readStatistics,
  readTransactions,
} from "../db/resource-queries.js";
import { readDebtDetail, readDebtOverview } from "../db/debt-queries.js";
import {
  mutatePersonalResource,
  mutatePersonalResourceWithResult,
  mutateSharedResource,
} from "../db/resource-mutations.js";
import * as schema from "../db/schema.js";
import {
  SharedFundError,
  cleanUserProfile,
  type PersonalMutationCommand,
  type TransactionMutationCommand,
  type SharedMutationCommand,
  type UserDataRepository,
} from "./repository.js";

export class RevisionConflictError extends SharedFundError {
  constructor() {
    super("revision_conflict", 409, "Dữ liệu đã được cập nhật ở nơi khác. Hãy tải lại.");
  }
}

export interface PostgresUserRepositoryOptions {
  db: FinanceDatabase;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
}

export class PostgresUserRepository implements UserDataRepository {
  readonly #db: FinanceDatabase;
  readonly #now: () => number;
  readonly #randomBytes: (size: number) => Buffer;

  constructor({
    db,
    now = () => Date.now(),
    randomBytes = crypto.randomBytes,
  }: PostgresUserRepositoryOptions) {
    this.#db = db;
    this.#now = now;
    this.#randomBytes = randomBytes;
  }

  async #user(userId: string): Promise<typeof schema.users.$inferSelect> {
    const [user] = await this.#db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw new Error("Không tìm thấy dữ liệu tài khoản.");
    return user;
  }

  async provisionUser(profile: UserProfile): Promise<UserProfile> {
    const clean = cleanUserProfile(profile);
    await this.#db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.users).where(eq(schema.users.id, clean.sub));
      if (existing) {
        await tx.update(schema.users).set({
          email: clean.email,
          name: clean.name,
          picture: clean.picture,
          updatedAt: new Date(this.#now()),
        }).where(eq(schema.users.id, clean.sub));
        return;
      }
      await tx.insert(schema.users).values({
        id: clean.sub,
        email: clean.email,
        name: clean.name,
        picture: clean.picture,
        createdAt: new Date(this.#now()),
        updatedAt: new Date(this.#now()),
      });
      const initial = createDefaultStore();
      initial.onboarding = { status: "pending", version: 1 };
      await replacePersonalStore(tx, clean.sub, storeAsPayload(initial));
    });
    return clean;
  }

  getBootstrap(userId: string): Promise<FinanceBootstrapResponse> {
    return readBootstrap(this.#db, userId);
  }

  getExpenseConfig(userId: string): Promise<ExpenseConfigResponse> {
    return readExpenseConfig(this.#db, userId);
  }

  getExpenseSummary(userId: string, year: number, month: number): Promise<ExpenseMonthSummaryResponse> {
    return readExpenseSummary(this.#db, userId, year, month);
  }

  getTransactions(userId: string, query: TransactionQuery): Promise<TransactionPageResponse> {
    return readTransactions(this.#db, userId, query);
  }

  getDebtOverview(userId: string): Promise<DebtOverviewResponse> {
    return readDebtOverview(this.#db, userId);
  }

  getDebtDetail(userId: string, debtId: string): Promise<DebtDetailResponse> {
    return readDebtDetail(this.#db, userId, debtId);
  }

  getFundOverview(userId: string, year: number, month: number): Promise<FundOverviewResponse> {
    return readFundOverview(this.#db, userId, year, month);
  }

  getFundMonthDetail(userId: string, fundId: string, year: number, month: number): Promise<FundMonthDetailResponse> {
    return readFundMonthDetail(this.#db, userId, fundId, year, month);
  }

  getSharedFundMembers(userId: string, fundId: string): Promise<SharedFundMembersResponse> {
    return readSharedFundMembers(this.#db, userId, fundId);
  }

  getSharedFundContributions(
    userId: string,
    fundId: string,
    year: number,
    month: number,
  ): Promise<SharedFundContributionsResponse> {
    return readSharedFundContributions(this.#db, userId, fundId, year, month);
  }

  getStatistics(userId: string, scope: StatisticsScope): Promise<StatisticsResponse> {
    return readStatistics(this.#db, userId, scope);
  }

  mutatePersonalResource<T>(
    userId: string,
    expectedRevision: number,
    command: PersonalMutationCommand,
  ): Promise<import("@chi-tieu/shared").PersonalMutationResponse<T>> {
    return mutatePersonalResource<T>(this.#db, userId, expectedRevision, command);
  }

  mutateTransaction(
    userId: string,
    expectedRevision: number,
    command: TransactionMutationCommand,
    expenseView: ExpenseTransactionView,
  ): Promise<import("@chi-tieu/shared").PersonalMutationResponse<TransactionMutationResult>> {
    return mutatePersonalResourceWithResult<
      import("@chi-tieu/shared").Transaction | import("@chi-tieu/shared").DeleteMutationResult,
      TransactionMutationResult
    >(this.#db, userId, expectedRevision, command, async (tx, mutation) => {
      // Drizzle exposes the transaction as a narrower type than the database,
      // while these read helpers only use the shared query executor surface.
      const executor = tx as unknown as FinanceDatabase;
      const [summary, transactions] = await Promise.all([
        readExpenseSummary(executor, userId, expenseView.year, expenseView.month),
        readTransactions(executor, userId, expenseView.transactions),
      ]);
      return {
        ...("deletedId" in mutation ? { deletedId: mutation.deletedId } : { transaction: mutation }),
        summary,
        transactions,
      };
    });
  }

  mutateSharedResource<T>(
    userId: string,
    fundId: string,
    revision: number,
    command: SharedMutationCommand,
  ): Promise<import("@chi-tieu/shared").SharedMutationResponse<T>> {
    return mutateSharedResource<T>(this.#db, userId, fundId, revision, command);
  }

  async getUserData(userId: string): Promise<StoredFinancePayload> {
    await this.#user(userId);
    return storeAsPayload(await assemblePersonalStore(this.#db, userId));
  }

  async replaceUserData(userId: string, expectedRevision: number, data: StoredFinancePayload): Promise<number> {
    return this.#db.transaction(async (tx) => {
      const lockResult: any = await tx.execute(sql`
        select workspace_revision from users where id = ${userId} for update
      `);
      const locked = lockResult.rows?.[0] ?? lockResult[0];
      const current = Number(locked?.workspace_revision);
      if (!current) throw new Error("Không tìm thấy dữ liệu tài khoản.");
      if (current !== expectedRevision) throw new RevisionConflictError();
      await replacePersonalStore(tx, userId, data);
      const next = current + 1;
      await tx.update(schema.users).set({ workspaceRevision: next, updatedAt: new Date(this.#now()) })
        .where(eq(schema.users.id, userId));
      return next;
    });
  }

  async createSharedFund(
    ownerId: string,
    fundId: string,
    email: string,
    role: SharedFundRole,
    expectedRevision: number,
  ): Promise<{ id: string; revision: number }> {
    const sharedExternalId = `shared-${this.#randomBytes(12).toString("hex")}`;
    await this.#db.transaction(async (tx) => {
      const userLock: any = await tx.execute(sql`select workspace_revision from users where id = ${ownerId} for update`);
      const currentRevision = Number((userLock.rows?.[0] ?? userLock[0])?.workspace_revision);
      if (!currentRevision) throw new Error("Không tìm thấy dữ liệu tài khoản.");
      if (currentRevision !== expectedRevision) throw new RevisionConflictError();
      const [target] = await tx.select().from(schema.users).where(sql`lower(${schema.users.email}) = lower(${email.trim()})`);
      if (!target) throw new SharedFundError("member_not_found", 404, "Email này chưa từng đăng nhập ứng dụng.");
      if (target.id === ownerId) throw new SharedFundError("cannot_share_self", 400, "Không thể chia sẻ quỹ với chính bạn.");
      const [fund] = await tx.select().from(schema.funds)
        .where(and(eq(schema.funds.ownerId, ownerId), eq(schema.funds.externalId, fundId), eq(schema.funds.shared, false)));
      if (!fund) throw new SharedFundError("fund_not_found", 404, "Không tìm thấy quỹ để chia sẻ.");
      await tx.update(schema.funds).set({
        externalId: sharedExternalId,
        shared: true,
        revision: 1,
        updatedAt: new Date(this.#now()),
      }).where(eq(schema.funds.id, fund.id));
      await tx.insert(schema.fundMembers).values({
        fundId: fund.id,
        userId: target.id,
        role,
        addedAt: new Date(this.#now()),
      });
      const targetPositions = await tx.select().from(schema.fundPositions)
        .where(eq(schema.fundPositions.userId, target.id)).orderBy(asc(schema.fundPositions.position));
      await tx.insert(schema.fundPositions).values({
        fundId: fund.id,
        userId: target.id,
        position: (targetPositions.at(-1)?.position ?? -1) + 1,
      });
      await tx.update(schema.users).set({
        workspaceRevision: currentRevision + 1,
        updatedAt: new Date(this.#now()),
      }).where(eq(schema.users.id, ownerId));
    });
    return { id: sharedExternalId, revision: 1 };
  }

}
