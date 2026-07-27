import { asc, eq } from "drizzle-orm";
import {
  debtExpectedInterest,
  debtRemainingBalance,
  debtSchedule,
  debtStatus,
  debtSummary,
  type Debt,
  type DebtDetailResponse,
  type DebtOverviewItem,
  type DebtOverviewResponse,
  type DebtSummary,
} from "@chi-tieu/shared";
import type { FinanceDatabase } from "./client.js";
import * as schema from "./schema.js";

type Executor = FinanceDatabase;

interface DebtData {
  debts: Debt[];
}

async function readDebtData(db: Executor, userId: string): Promise<DebtData> {
  const [debtRows, paymentRows, categoryRows, accountRows, transactionRows] = await Promise.all([
    db.select().from(schema.debts).where(eq(schema.debts.userId, userId)).orderBy(asc(schema.debts.createdAt)),
    db.select({ payment: schema.debtPayments }).from(schema.debtPayments)
      .innerJoin(schema.debts, eq(schema.debtPayments.debtId, schema.debts.id))
      .where(eq(schema.debts.userId, userId)).orderBy(asc(schema.debtPayments.installment)),
    db.select().from(schema.financeCategories).where(eq(schema.financeCategories.userId, userId)),
    db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId)),
    db.select().from(schema.transactions).where(eq(schema.transactions.userId, userId)),
  ]);
  const categoryById = new Map(categoryRows.map((row) => [row.id, row.externalId]));
  const accountById = new Map(accountRows.map((row) => [row.id, row.externalId]));
  const transactionById = new Map(transactionRows.map((row) => [row.id, row.externalId]));
  const paymentsByDebt = new Map<string, typeof schema.debtPayments.$inferSelect[]>();
  for (const { payment } of paymentRows) {
    const values = paymentsByDebt.get(payment.debtId) ?? [];
    values.push(payment);
    paymentsByDebt.set(payment.debtId, values);
  }
  return {
    debts: debtRows.map((row): Debt => ({
      id: row.externalId,
      kind: row.kind as Debt["kind"],
      name: row.name,
      counterparty: row.counterparty,
      principal: row.principal,
      annualInterestRate: row.annualInterestRate,
      termMonths: row.termMonths,
      paymentAmount: row.paymentAmount,
      ...(row.firstPaymentDate ? { firstPaymentDate: row.firstPaymentDate } : {}),
      ...(row.paymentCategoryId && categoryById.get(row.paymentCategoryId)
        ? { paymentCategoryId: categoryById.get(row.paymentCategoryId)! }
        : {}),
      ...(row.paymentAccountId && accountById.get(row.paymentAccountId)
        ? { paymentAccountId: accountById.get(row.paymentAccountId)! }
        : {}),
      note: row.note,
      status: row.status as Debt["status"],
      payments: (paymentsByDebt.get(row.id) ?? []).map((payment) => ({
        id: payment.externalId,
        installment: payment.installment,
        paidAt: payment.paidAt,
        amount: payment.amount,
        principalAmount: payment.principalAmount,
        interestAmount: payment.interestAmount,
        ...(payment.transactionId && transactionById.get(payment.transactionId)
          ? { transactionId: transactionById.get(payment.transactionId)! }
          : {}),
        note: payment.note,
      })),
    })),
  };
}

function debtOverviewItem(debt: Debt): DebtOverviewItem {
  const current = debtStatus(debt);
  const remainingBalance = debtRemainingBalance(debt);
  const status = remainingBalance === 0 ? "settled" : debt.status;
  const base = { ...debt };
  Reflect.deleteProperty(base, "payments");
  return {
    ...base,
    status,
    remainingBalance,
    expectedInterest: debtExpectedInterest(debt),
    ...(current.nextPayment ? { nextPayment: current.nextPayment } : {}),
    overdue: current.overdue,
    dueSoon: current.dueSoon,
    needsSetup: !debt.firstPaymentDate || debt.termMonths <= 0 || debt.paymentAmount <= 0 || !debt.paymentCategoryId,
  };
}

export async function readDebtSummary(db: Executor, userId: string): Promise<DebtSummary> {
  const { debts } = await readDebtData(db, userId);
  return debtSummary(debts.map((debt) => ({
    ...debt,
    status: debtRemainingBalance(debt) === 0 ? "settled" : debt.status,
  })));
}

export async function readDebtOverview(db: Executor, userId: string): Promise<DebtOverviewResponse> {
  const { debts } = await readDebtData(db, userId);
  const items = debts.map(debtOverviewItem);
  return {
    summary: debtSummary(debts.map((debt) => ({
      ...debt,
      status: debtRemainingBalance(debt) === 0 ? "settled" : debt.status,
    }))),
    items,
  };
}

export async function readDebtDetail(db: Executor, userId: string, externalId: string): Promise<DebtDetailResponse> {
  const { debts } = await readDebtData(db, userId);
  const debt = debts.find((entry) => entry.id === externalId);
  if (!debt) throw new Error("debt_not_found");
  const item = debtOverviewItem(debt);
  return { ...item, payments: debt.payments, schedule: debtSchedule(debt) };
}
