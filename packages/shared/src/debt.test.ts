import { describe, expect, it } from "vitest";
import { debtExpectedInterest, debtRemainingBalance, debtSchedule, debtStatus, debtSummary } from "./debt.js";
import type { Debt } from "./index.js";

function fixture(): Debt {
  return {
    id: "loan", kind: "borrowed", name: "Khoản vay", counterparty: "Ngân hàng",
    principal: 10_000_000, annualInterestRate: 12, termMonths: 5, paymentAmount: 2_200_000,
    firstPaymentDate: "2026-01-31", paymentCategoryId: "other", note: "", status: "active", payments: [],
  };
}

describe("lịch vay nợ", () => {
  it("dựng lịch hàng tháng, lãi dự kiến và dư nợ còn lại", () => {
    const debt = fixture();
    expect(debtExpectedInterest(debt)).toBe(1_000_000);
    expect(debtSchedule(debt).map((item) => item.dueDate)).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31",
    ]);
    debt.payments.push({ id: "p1", installment: 1, paidAt: "2026-01-31", amount: 2_200_000, principalAmount: 2_000_000, interestAmount: 200_000, note: "" });
    expect(debtRemainingBalance(debt)).toBe(8_000_000);
  });

  it("phân biệt quá hạn, sắp đến hạn và tổng phải thu/phải trả", () => {
    const borrowed = fixture();
    const lent: Debt = { ...fixture(), id: "lent", kind: "lent", principal: 3_000_000, termMonths: 1, paymentAmount: 3_000_000, firstPaymentDate: "2026-08-02" };
    expect(debtStatus(borrowed, "2026-02-01").overdue).toBe(true);
    expect(debtStatus(lent, "2026-07-27").dueSoon).toBe(true);
    expect(debtSummary([borrowed, lent], "2026-07-27")).toMatchObject({ liabilities: 10_000_000, receivables: 3_000_000, netDebt: 7_000_000, dueSoonCount: 1 });
  });
});
