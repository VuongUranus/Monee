import type { Debt, DebtScheduleItem, DebtSummary } from "./index.js";

const DAY = 86_400_000;

export function debtExpectedInterest(debt: Pick<Debt, "principal" | "paymentAmount" | "termMonths">): number {
  if (debt.termMonths <= 0 || debt.paymentAmount <= 0) return 0;
  return Math.max(0, debt.paymentAmount * debt.termMonths - debt.principal);
}

export function debtSchedule(debt: Pick<Debt, "principal" | "paymentAmount" | "termMonths" | "firstPaymentDate" | "payments">): DebtScheduleItem[] {
  if (!debt.firstPaymentDate || debt.termMonths <= 0 || debt.paymentAmount <= 0) return [];
  const principalBase = Math.floor(debt.principal / debt.termMonths);
  let allocatedPrincipal = 0;
  const payments = new Map(debt.payments.map((payment) => [payment.installment, payment]));
  return Array.from({ length: debt.termMonths }, (_, offset) => {
    const installment = offset + 1;
    const principalAmount = installment === debt.termMonths
      ? debt.principal - allocatedPrincipal
      : principalBase;
    allocatedPrincipal += principalAmount;
    const amount = debt.paymentAmount;
    const payment = payments.get(installment);
    return {
      installment,
      dueDate: addMonths(debt.firstPaymentDate!, offset),
      amount,
      principalAmount,
      interestAmount: Math.max(0, amount - principalAmount),
      ...(payment ? { payment } : {}),
    };
  });
}

export function debtRemainingBalance(debt: Pick<Debt, "principal" | "payments">): number {
  return Math.max(0, debt.principal - debt.payments.reduce((total, payment) => total + payment.principalAmount, 0));
}

export function debtStatus(debt: Pick<Debt, "principal" | "payments" | "firstPaymentDate" | "termMonths" | "paymentAmount">, today = todayIso()): {
  overdue: boolean;
  dueSoon: boolean;
  nextPayment?: DebtScheduleItem;
} {
  const nextPayment = debtSchedule(debt).find((item) => !item.payment);
  if (!nextPayment) return { overdue: false, dueSoon: false };
  const daysUntil = Math.floor((Date.parse(`${nextPayment.dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
  return { nextPayment, overdue: daysUntil < 0, dueSoon: daysUntil >= 0 && daysUntil <= 7 };
}

export function debtSummary(debts: Debt[], today = todayIso()): DebtSummary {
  let liabilities = 0;
  let receivables = 0;
  let overdueCount = 0;
  let dueSoonCount = 0;
  for (const debt of debts) {
    if (debt.status !== "active") continue;
    const balance = debtRemainingBalance(debt);
    if (debt.kind === "lent") receivables += balance;
    else liabilities += balance;
    const status = debtStatus(debt, today);
    if (status.overdue) overdueCount += 1;
    else if (status.dueSoon) dueSoonCount += 1;
  }
  return { liabilities, receivables, netDebt: liabilities - receivables, overdueCount, dueSoonCount };
}

function addMonths(value: string, offset: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(Date.UTC(year!, month! - 1 + offset, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day!, lastDay)).padStart(2, "0")}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
