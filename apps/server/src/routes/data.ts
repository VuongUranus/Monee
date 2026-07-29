import type { FastifyPluginAsync } from "fastify";
import type {
  DebtCreateRequest,
  DebtPatchRequest,
  ExpenseTransactionView,
  FundDetail,
  TransactionType,
} from "@chi-tieu/shared";
import { z } from "zod";
import { SharedFundError, type PersonalMutationCommand, type TransactionMutationCommand } from "../lib/repository.js";

const revision = z.number().int().positive();
const money = z.number().finite().nonnegative();
const positiveMoney = z.number().finite().positive();
const yearSchema = z.coerce.number().int().min(1900).max(9999);
const monthSchema = z.coerce.number().int().min(1).max(12);
const roleSchema = z.enum(["viewer", "editor"]);
const fundCategorySchema = z.enum(["saving", "stock", "gold", "crypto"]);
const transactionTypeSchema = z.enum(["income", "expense"]);
const debtKindSchema = z.enum(["borrowed", "lent", "credit_card", "installment"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const goldCostBasisSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("unit_price"), vndPerChi: positiveMoney }),
  z.object({ type: z.literal("total_paid"), totalVnd: positiveMoney }),
  z.object({
    type: z.literal("historical"),
    vndPerChi: positiveMoney,
    quoteDate: dateSchema,
    source: z.string().trim().min(1).max(200),
  }),
]);
const goldDetailSchema = z.object({
  type: z.literal("gold"),
  lots: z.array(z.object({
    chi: money,
    manualPrice: money.nullish(),
    costBasis: goldCostBasisSchema.nullish(),
    purchasedAt: dateSchema.optional(),
    note: z.string().max(2_000).optional(),
  })),
}).superRefine((detail, context) => {
  detail.lots.forEach((lot, index) => {
    if (lot.costBasis?.type !== "historical") return;
    if (lot.purchasedAt !== lot.costBasis.quoteDate) {
      context.addIssue({
        code: "custom",
        path: ["lots", index, "costBasis", "quoteDate"],
        message: "Ngày của giá tham chiếu phải trùng ngày mua.",
      });
    }
  });
});
const holdingDetailSchema = z.custom<FundDetail>((value) =>
  typeof value === "object" && value !== null && "type" in value && value.type === "hold");
const fundDetailSchema = z.union([
  z.null(),
  goldDetailSchema,
  holdingDetailSchema,
]) as z.ZodType<FundDetail>;
const transactionQuerySchema = z.object({
  from: dateSchema,
  to: dateSchema,
  type: transactionTypeSchema.optional(),
  categoryId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  q: z.string().max(500).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
const expenseTransactionViewSchema = z.object({
  year: yearSchema,
  month: monthSchema,
  transactions: transactionQuerySchema,
});

function sendError(reply: any, error: unknown): any {
  if (error instanceof SharedFundError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  throw error;
}

function body<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SharedFundError("invalid_request", 400, "Dữ liệu gửi lên không hợp lệ.");
  return parsed.data;
}

function sessionUser(app: any, request: any, reply: any): string | null {
  const session = app.finance.sessions.getSession(request);
  if (!session) {
    void reply.code(401).send({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
    return null;
  }
  return session.userId;
}

function sendReadError(reply: any, error: unknown): any {
  if (error instanceof SharedFundError) return sendError(reply, error);
  if (error instanceof Error && error.message === "fund_not_found") {
    return reply.code(404).send({ error: "fund_not_found", message: "Không tìm thấy quỹ." });
  }
  if (error instanceof Error && error.message === "debt_not_found") {
    return reply.code(404).send({ error: "debt_not_found", message: "Không tìm thấy khoản vay/nợ." });
  }
  if (error instanceof Error && error.message === "forbidden") {
    return reply.code(403).send({ error: "forbidden", message: "Bạn không có quyền thực hiện thao tác này." });
  }
  throw error;
}

async function personal(
  app: any,
  userId: string,
  expectedRevision: number,
  command: PersonalMutationCommand,
): Promise<unknown> {
  return app.finance.repository.mutatePersonalResource(userId, expectedRevision, command);
}

async function transactionMutation(
  app: any,
  userId: string,
  expectedRevision: number,
  command: TransactionMutationCommand,
  expenseView?: ExpenseTransactionView,
): Promise<unknown> {
  // Keep direct API consumers working during the frontend/backend rollout. The
  // optimized screen always sends expenseView and receives the fresh snapshot.
  if (!expenseView) return personal(app, userId, expectedRevision, command);
  return app.finance.repository.mutateTransaction(userId, expectedRevision, command, expenseView);
}

function normalizeExpenseTransactionView(value: z.infer<typeof expenseTransactionViewSchema> | undefined): ExpenseTransactionView | undefined {
  if (!value) return undefined;
  const query = value.transactions;
  return {
    year: value.year,
    month: value.month,
    transactions: {
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
      ...(query.type ? { type: query.type } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.q ? { q: query.q } : {}),
    },
  };
}

export const dataRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/data", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const bootstrap = await app.finance.repository.getBootstrap(userId);
    return {
      ...bootstrap,
      features: {
        aiAssistant: app.finance.config.aiAssistantEnabled && Boolean(app.finance.assistantService),
      },
    };
  });

  app.get("/api/backup/export", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    return app.finance.repository.getUserData(userId);
  });

  app.get("/api/expenses/config", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    return app.finance.repository.getExpenseConfig(userId);
  });

  app.get<{ Querystring: unknown }>("/api/expenses/summary", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ year: yearSchema, month: monthSchema }), request.query);
    return app.finance.repository.getExpenseSummary(userId, parsed.year, parsed.month);
  });

  app.get<{ Querystring: unknown }>("/api/transactions", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      from: dateSchema,
      to: dateSchema,
      type: transactionTypeSchema.optional(),
      categoryId: z.string().min(1).optional(),
      accountId: z.string().min(1).optional(),
      q: z.string().max(500).optional(),
      page: z.coerce.number().int().positive().default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(10),
    }), request.query);
    return app.finance.repository.getTransactions(userId, {
      from: parsed.from,
      to: parsed.to,
      page: parsed.page,
      pageSize: parsed.pageSize,
      ...(parsed.type ? { type: parsed.type } : {}),
      ...(parsed.categoryId ? { categoryId: parsed.categoryId } : {}),
      ...(parsed.accountId ? { accountId: parsed.accountId } : {}),
      ...(parsed.q ? { q: parsed.q } : {}),
    });
  });

  app.get("/api/debts", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    return app.finance.repository.getDebtOverview(userId);
  });

  app.get<{ Params: { id: string } }>("/api/debts/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    try {
      return await app.finance.repository.getDebtDetail(userId, request.params.id);
    } catch (error) { return sendReadError(reply, error); }
  });

  app.get<{ Querystring: unknown }>("/api/funds/overview", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ year: yearSchema, month: monthSchema }), request.query);
    return app.finance.repository.getFundOverview(userId, parsed.year, parsed.month);
  });

  app.get<{ Params: { id: string; year: string; month: string } }>(
    "/api/funds/:id/months/:year/:month",
    async (request, reply) => {
      const userId = sessionUser(app, request, reply);
      if (!userId) return reply;
      const targetYear = body(yearSchema, request.params.year);
      const targetMonth = body(monthSchema, request.params.month);
      try {
        return await app.finance.repository.getFundMonthDetail(
          userId,
          request.params.id,
          targetYear,
          targetMonth,
        );
      } catch (error) {
        return sendReadError(reply, error);
      }
    },
  );

  app.get<{ Params: { id: string } }>("/api/shared-funds/:id/members", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    try {
      return await app.finance.repository.getSharedFundMembers(userId, request.params.id);
    } catch (error) {
      return sendReadError(reply, error);
    }
  });

  app.get<{ Params: { id: string }; Querystring: unknown }>(
    "/api/shared-funds/:id/contributions",
    async (request, reply) => {
      const userId = sessionUser(app, request, reply);
      if (!userId) return reply;
      const parsed = body(z.object({ year: yearSchema, month: monthSchema }), request.query);
      try {
        return await app.finance.repository.getSharedFundContributions(
          userId,
          request.params.id,
          parsed.year,
          parsed.month,
        );
      } catch (error) {
        return sendReadError(reply, error);
      }
    },
  );

  app.get<{ Querystring: unknown }>("/api/statistics", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("all") }),
      z.object({ mode: z.literal("year"), year: yearSchema }),
      z.object({ mode: z.literal("month"), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
      z.object({
        mode: z.literal("range"),
        from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        to: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      }),
    ]), request.query);
    if (parsed.mode === "range" && parsed.from > parsed.to) {
      return reply.code(400).send({ error: "invalid_range", message: "Khoảng thời gian không hợp lệ." });
    }
    return app.finance.repository.getStatistics(userId, parsed);
  });

  app.put<{ Body: unknown }>("/api/data/import", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision, data: z.record(z.string(), z.unknown()) }), request.body);
    await app.finance.repository.replaceUserData(userId, parsed.expectedRevision, parsed.data);
    const bootstrap = await app.finance.repository.getBootstrap(userId);
    return {
      ...bootstrap,
      features: {
        aiAssistant: app.finance.config.aiAssistantEnabled && Boolean(app.finance.assistantService),
      },
    };
  });

  app.patch<{ Body: unknown }>("/api/preferences", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      expectedRevision: revision,
      showGoals: z.boolean().optional(),
      financialProfile: z.object({
        monthlyIncome: money.optional(),
        emergencyFundGoal: money.optional(),
        debtBalance: money.optional(),
        debtMonthlyPayment: money.optional(),
      }).optional(),
      onboarding: z.object({
        status: z.enum(["pending", "completed", "skipped"]),
        version: z.number().int().positive(),
        skippedAt: z.string().datetime().optional(),
      }).optional(),
    }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "preferences",
        patch: {
          ...(parsed.showGoals !== undefined ? { showGoals: parsed.showGoals } : {}),
          ...(parsed.financialProfile ? {
            financialProfile: {
              ...(parsed.financialProfile.monthlyIncome !== undefined
                ? { monthlyIncome: parsed.financialProfile.monthlyIncome }
                : {}),
              ...(parsed.financialProfile.emergencyFundGoal !== undefined
                ? { emergencyFundGoal: parsed.financialProfile.emergencyFundGoal }
                : {}),
              ...(parsed.financialProfile.debtBalance !== undefined
                ? { debtBalance: parsed.financialProfile.debtBalance }
                : {}),
              ...(parsed.financialProfile.debtMonthlyPayment !== undefined
                ? { debtMonthlyPayment: parsed.financialProfile.debtMonthlyPayment }
                : {}),
            },
          } : {}),
          ...(parsed.onboarding ? {
            onboarding: {
              status: parsed.onboarding.status,
              version: parsed.onboarding.version,
              ...(parsed.onboarding.skippedAt ? { skippedAt: parsed.onboarding.skippedAt } : {}),
            },
          } : {}),
        },
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Params: { year: string }; Body: unknown }>("/api/years/:year", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const targetYear = body(yearSchema, request.params.year);
    const parsed = body(z.object({ expectedRevision: revision }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, { kind: "ensureYear", year: targetYear });
    } catch (error) { return sendError(reply, error); }
  });

  app.patch<{ Params: { year: string; month: string }; Body: unknown }>("/api/years/:year/months/:month", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const targetYear = body(yearSchema, request.params.year);
    const targetMonth = body(monthSchema, request.params.month);
    const parsed = body(z.object({ expectedRevision: revision, note: z.string().max(10_000) }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "monthNote",
        year: targetYear,
        month: targetMonth,
        note: parsed.note,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Params: { year: string; month: string }; Body: unknown }>("/api/years/:year/months/:month/reset", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const targetYear = body(yearSchema, request.params.year);
    const targetMonth = body(monthSchema, request.params.month);
    const parsed = body(z.object({ expectedRevision: revision }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "resetMonth",
        year: targetYear,
        month: targetMonth,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Body: unknown }>("/api/funds", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      expectedRevision: revision,
      name: z.string().trim().min(1).max(200),
      color: z.string().min(1).max(32),
      category: fundCategorySchema,
    }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "createFund",
        input: { name: parsed.name, color: parsed.color, category: parsed.category },
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/funds/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      expectedRevision: revision,
      name: z.string().trim().min(1).max(200).optional(),
      color: z.string().min(1).max(32).optional(),
      category: fundCategorySchema.optional(),
      fundPlan: money.optional(),
      openingBalance: money.optional(),
    }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "updateFund",
        id: request.params.id,
        patch: {
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.color !== undefined ? { color: parsed.color } : {}),
          ...(parsed.category !== undefined ? { category: parsed.category } : {}),
          ...(parsed.fundPlan !== undefined ? { fundPlan: parsed.fundPlan } : {}),
          ...(parsed.openingBalance !== undefined ? { openingBalance: parsed.openingBalance } : {}),
        },
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.delete<{ Params: { id: string }; Body: unknown }>("/api/funds/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "deleteFund",
        id: request.params.id,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Body: unknown }>("/api/funds/order", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision, ids: z.array(z.string()).min(1) }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "reorderFunds",
        ids: parsed.ids,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Params: { id: string; year: string; month: string }; Body: unknown }>("/api/funds/:id/months/:year/:month", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const targetYear = body(yearSchema, request.params.year);
    const targetMonth = body(monthSchema, request.params.month);
    const parsed = body(z.object({
      expectedRevision: revision,
      amount: money,
      detail: fundDetailSchema.optional(),
    }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "fundMonth",
        id: request.params.id,
        year: targetYear,
        month: targetMonth,
        patch: {
          amount: Math.round(parsed.amount),
          ...(parsed.detail !== undefined ? { detail: parsed.detail } : {}),
        },
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/funds/:id/goals", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision, year: z.number().int().positive().nullable(), amount: money }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "fundGoal",
        id: request.params.id,
        input: { year: parsed.year, amount: parsed.amount },
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Body: unknown }>("/api/transactions", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      expectedRevision: revision,
      transaction: z.object({
        id: z.string().optional(),
        date: z.string().date(),
        type: transactionTypeSchema,
        cat: z.string().min(1),
        accountId: z.string().optional(),
        amount: positiveMoney,
        note: z.string().max(10_000),
      }),
      expenseView: expenseTransactionViewSchema.optional(),
    }), request.body);
    try {
      return await transactionMutation(app, userId, parsed.expectedRevision, {
        kind: "createTransaction",
        transaction: {
          ...(parsed.transaction.id ? { id: parsed.transaction.id } : {}),
          date: parsed.transaction.date,
          type: parsed.transaction.type,
          cat: parsed.transaction.cat,
          ...(parsed.transaction.accountId ? { accountId: parsed.transaction.accountId } : {}),
          amount: parsed.transaction.amount,
          note: parsed.transaction.note,
        },
      }, normalizeExpenseTransactionView(parsed.expenseView));
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Body: unknown }>("/api/debts", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      expectedRevision: revision,
      debt: z.object({
        kind: debtKindSchema,
        name: z.string().trim().min(1).max(200),
        counterparty: z.string().trim().max(200).default(""),
        principal: positiveMoney,
        annualInterestRate: z.number().finite().nonnegative().default(0),
        termMonths: z.number().int().positive(),
        paymentAmount: positiveMoney,
        firstPaymentDate: z.string().date(),
        paymentCategoryId: z.string().min(1),
        paymentAccountId: z.string().min(1).optional(),
        note: z.string().max(10_000).default(""),
      }),
    }), request.body);
    try {
      const input: Omit<DebtCreateRequest, "expectedRevision">["debt"] = {
        kind: parsed.debt.kind,
        name: parsed.debt.name,
        counterparty: parsed.debt.counterparty,
        principal: parsed.debt.principal,
        annualInterestRate: parsed.debt.annualInterestRate,
        termMonths: parsed.debt.termMonths,
        paymentAmount: parsed.debt.paymentAmount,
        firstPaymentDate: parsed.debt.firstPaymentDate,
        paymentCategoryId: parsed.debt.paymentCategoryId,
        ...(parsed.debt.paymentAccountId ? { paymentAccountId: parsed.debt.paymentAccountId } : {}),
        note: parsed.debt.note,
      };
      return await personal(app, userId, parsed.expectedRevision, { kind: "createDebt", input });
    } catch (error) { return sendError(reply, error); }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/debts/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      expectedRevision: revision,
      debt: z.object({
        kind: debtKindSchema.optional(),
        name: z.string().trim().min(1).max(200).optional(),
        counterparty: z.string().trim().max(200).optional(),
        principal: positiveMoney.optional(),
        annualInterestRate: z.number().finite().nonnegative().optional(),
        termMonths: z.number().int().positive().optional(),
        paymentAmount: positiveMoney.optional(),
        firstPaymentDate: z.string().date().nullable().optional(),
        paymentCategoryId: z.string().min(1).optional(),
        paymentAccountId: z.string().min(1).or(z.literal("")).nullable().optional(),
        note: z.string().max(10_000).optional(),
      }).refine((value) => Object.keys(value).length > 0),
    }), request.body);
    try {
      const { firstPaymentDate, paymentAccountId, ...fields } = parsed.debt;
      const debt = {
        ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
        ...(firstPaymentDate !== undefined ? { firstPaymentDate: firstPaymentDate ?? "" } : {}),
        ...(paymentAccountId !== undefined ? { paymentAccountId: paymentAccountId ?? "" } : {}),
      } as Omit<DebtPatchRequest, "expectedRevision">["debt"];
      return await personal(app, userId, parsed.expectedRevision, { kind: "updateDebt", id: request.params.id, patch: debt });
    } catch (error) { return sendError(reply, error); }
  });

  app.delete<{ Params: { id: string }; Body: unknown }>("/api/debts/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, { kind: "deleteDebt", id: request.params.id });
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/debts/:id/payments", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      expectedRevision: revision,
      paidAt: z.string().date(),
      note: z.string().max(10_000).optional(),
    }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "recordDebtPayment",
        id: request.params.id,
        paidAt: parsed.paidAt,
        note: parsed.note ?? "",
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.delete<{ Params: { id: string; paymentId: string }; Body: unknown }>("/api/debts/:id/payments/:paymentId", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "deleteDebtPayment",
        id: request.params.id,
        paymentId: request.params.paymentId,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/transactions/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      expectedRevision: revision,
      transaction: z.object({
        date: z.string().date(),
        type: transactionTypeSchema,
        cat: z.string().min(1),
        accountId: z.string().optional(),
        amount: positiveMoney,
        note: z.string().max(10_000),
      }),
      expenseView: expenseTransactionViewSchema.optional(),
    }), request.body);
    try {
      return await transactionMutation(app, userId, parsed.expectedRevision, {
        kind: "updateTransaction",
        id: request.params.id,
        transaction: {
          date: parsed.transaction.date,
          type: parsed.transaction.type,
          cat: parsed.transaction.cat,
          ...(parsed.transaction.accountId ? { accountId: parsed.transaction.accountId } : {}),
          amount: parsed.transaction.amount,
          note: parsed.transaction.note,
        },
      }, normalizeExpenseTransactionView(parsed.expenseView));
    } catch (error) { return sendError(reply, error); }
  });

  app.delete<{ Params: { id: string }; Body: unknown }>("/api/transactions/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision, expenseView: expenseTransactionViewSchema.optional() }), request.body);
    try {
      return await transactionMutation(app, userId, parsed.expectedRevision, {
        kind: "deleteTransaction",
        id: request.params.id,
      }, normalizeExpenseTransactionView(parsed.expenseView));
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Body: unknown }>("/api/categories", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      expectedRevision: revision,
      type: transactionTypeSchema,
      name: z.string().trim().min(1).max(200),
      color: z.string().min(1).max(32),
      budget: money.optional(),
    }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "createCategory",
        input: {
          type: parsed.type,
          name: parsed.name,
          color: parsed.color,
          ...(parsed.type === "expense" ? { budget: parsed.budget ?? 0 } : {}),
        },
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.patch<{ Params: { type: TransactionType; id: string }; Body: unknown }>("/api/categories/:type/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const type = body(transactionTypeSchema, request.params.type);
    const parsed = body(z.object({
      expectedRevision: revision,
      name: z.string().trim().min(1).max(200).optional(),
      color: z.string().min(1).max(32).optional(),
      budget: money.optional(),
    }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "updateCategory",
        type,
        id: request.params.id,
        patch: {
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.color !== undefined ? { color: parsed.color } : {}),
          ...(parsed.budget !== undefined && type === "expense" ? { budget: parsed.budget } : {}),
        },
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.delete<{ Params: { type: TransactionType; id: string }; Body: unknown }>("/api/categories/:type/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const type = body(transactionTypeSchema, request.params.type);
    const parsed = body(z.object({ expectedRevision: revision }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "deleteCategory",
        type,
        id: request.params.id,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Params: { type: TransactionType }; Body: unknown }>("/api/categories/:type/order", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const type = body(transactionTypeSchema, request.params.type);
    const parsed = body(z.object({ expectedRevision: revision, ids: z.array(z.string()).min(1) }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "reorderCategories",
        type,
        ids: parsed.ids,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Body: unknown }>("/api/account-types", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision, name: z.string().trim().min(1).max(200) }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "createAccountType",
        name: parsed.name,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/account-types/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision, name: z.string().trim().min(1).max(200) }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "updateAccountType",
        id: request.params.id,
        name: parsed.name,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.delete<{ Params: { id: string }; Body: unknown }>("/api/account-types/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "deleteAccountType",
        id: request.params.id,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Body: unknown }>("/api/account-types/order", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision, ids: z.array(z.string()) }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "reorderAccountTypes",
        ids: parsed.ids,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Body: unknown }>("/api/accounts", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      expectedRevision: revision,
      name: z.string().trim().min(1).max(200),
      typeId: z.string().optional(),
    }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "createAccount",
        input: {
          name: parsed.name,
          ...(parsed.typeId ? { typeId: parsed.typeId } : {}),
        },
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/accounts/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      expectedRevision: revision,
      name: z.string().trim().min(1).max(200).optional(),
      typeId: z.string().nullable().optional(),
    }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "updateAccount",
        id: request.params.id,
        patch: {
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.typeId !== undefined ? { typeId: parsed.typeId } : {}),
        },
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.delete<{ Params: { id: string }; Body: unknown }>("/api/accounts/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "deleteAccount",
        id: request.params.id,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Body: unknown }>("/api/accounts/order", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ expectedRevision: revision, ids: z.array(z.string()) }), request.body);
    try {
      return await personal(app, userId, parsed.expectedRevision, {
        kind: "reorderAccounts",
        ids: parsed.ids,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Body: unknown }>("/api/shared-funds", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      expectedRevision: revision,
      fundId: z.string(),
      email: z.string().email(),
      role: roleSchema,
    }), request.body);
    try {
      const data = await app.finance.repository.createSharedFund(
        userId,
        parsed.fundId,
        parsed.email,
        parsed.role,
        parsed.expectedRevision,
      );
      return { data, workspaceRevision: (await app.finance.repository.getBootstrap(userId)).workspaceRevision };
    } catch (error) { return sendError(reply, error); }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/shared-funds/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      revision,
      name: z.string().trim().min(1).max(200).optional(),
      color: z.string().min(1).max(32).optional(),
      category: fundCategorySchema.optional(),
      fundPlan: money.optional(),
      openingBalance: money.optional(),
    }), request.body);
    try {
      return await app.finance.repository.mutateSharedResource(
        userId,
        request.params.id,
        parsed.revision,
        {
          kind: "metadata",
          patch: {
            ...(parsed.name !== undefined ? { name: parsed.name } : {}),
            ...(parsed.color !== undefined ? { color: parsed.color } : {}),
            ...(parsed.category !== undefined ? { category: parsed.category } : {}),
            ...(parsed.fundPlan !== undefined ? { fundPlan: parsed.fundPlan } : {}),
            ...(parsed.openingBalance !== undefined ? { openingBalance: parsed.openingBalance } : {}),
          },
        },
      );
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Params: { id: string; year: string; month: string }; Body: unknown }>("/api/shared-funds/:id/months/:year/:month", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const targetYear = body(yearSchema, request.params.year);
    const targetMonth = body(monthSchema, request.params.month);
    const parsed = body(z.object({
      revision,
      amount: money,
      detail: fundDetailSchema.optional(),
    }), request.body);
    try {
      return await app.finance.repository.mutateSharedResource(
        userId,
        request.params.id,
        parsed.revision,
        {
          kind: "month",
          year: targetYear,
          month: targetMonth,
          amount: parsed.amount,
          ...(parsed.detail !== undefined ? { detail: parsed.detail } : {}),
        },
      );
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/shared-funds/:id/goals", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ revision, year: z.number().int().positive().nullable(), amount: money }), request.body);
    try {
      return await app.finance.repository.mutateSharedResource(
        userId,
        request.params.id,
        parsed.revision,
        { kind: "goal", year: parsed.year, amount: parsed.amount },
      );
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/shared-funds/:id/members", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ revision, email: z.string().email(), role: roleSchema }), request.body);
    try {
      return await app.finance.repository.mutateSharedResource(
        userId,
        request.params.id,
        parsed.revision,
        { kind: "setMember", email: parsed.email, role: parsed.role },
      );
    } catch (error) { return sendError(reply, error); }
  });

  app.delete<{ Params: { id: string; memberId: string }; Body: unknown }>("/api/shared-funds/:id/members/:memberId", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ revision }), request.body);
    try {
      return await app.finance.repository.mutateSharedResource(
        userId,
        request.params.id,
        parsed.revision,
        { kind: "removeMember", memberId: request.params.memberId },
      );
    } catch (error) { return sendError(reply, error); }
  });

  app.delete<{ Params: { id: string }; Body: unknown }>("/api/shared-funds/:id", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ revision }), request.body);
    try {
      return await app.finance.repository.mutateSharedResource(
        userId,
        request.params.id,
        parsed.revision,
        { kind: "delete" },
      );
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/shared-funds/:id/unshare", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({ revision }), request.body);
    try {
      return await app.finance.repository.unshareFund(userId, request.params.id, parsed.revision);
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/shared-funds/:id/contributions", async (request, reply) => {
    const userId = sessionUser(app, request, reply);
    if (!userId) return reply;
    const parsed = body(z.object({
      revision,
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      amount: positiveMoney,
      note: z.string().max(10_000).default(""),
    }), request.body);
    try {
      const [year, month] = parsed.month.split("-").map(Number) as [number, number];
      return await app.finance.repository.mutateSharedResource(
        userId,
        request.params.id,
        parsed.revision,
        { kind: "contribution", year, month, amount: parsed.amount, note: parsed.note },
      );
    } catch (error) { return sendError(reply, error); }
  });
};
