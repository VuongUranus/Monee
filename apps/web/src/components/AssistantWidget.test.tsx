import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantWidget } from "./AssistantWidget";
import { api } from "@/lib/api";
import { useFinanceStore } from "@/store/finance-store";

const proposal = {
  kind: "create_transaction" as const,
  actionId: "d8b6c3b1-2b96-4b30-84dd-513a838ce02b",
  expectedRevision: 1,
  confirmationToken: "signed-token",
  expiresAt: "2026-07-27T10:10:00.000Z",
  transaction: {
    id: "d8b6c3b1-2b96-4b30-84dd-513a838ce02b",
    date: "2026-07-27",
    type: "expense" as const,
    cat: "food",
    amount: 50_000,
    note: "Ăn sáng",
  },
  categoryName: "Ăn uống",
};

describe("AssistantWidget", () => {
  const applyAssistantConfirmation = vi.fn(async () => undefined);
  const reloadAfterAssistantConflict = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.restoreAllMocks();
    applyAssistantConfirmation.mockClear();
    reloadAfterAssistantConflict.mockClear();
    useFinanceStore.setState({
      selectedYear: 2026,
      selectedMonth: 6,
      bootstrapData: {
        user: { sub: "test", email: "test@example.com", name: "Test", picture: "" },
        workspaceRevision: 1,
        availableYears: [2026],
        features: { aiAssistant: true },
        preferences: {
          showGoals: false,
          onboarding: { status: "completed", version: 1 },
          financialProfile: {
            monthlyIncome: 20_000_000,
            emergencyFundGoal: 60_000_000,
            debt: { balance: 0, monthlyPayment: 0 },
          },
          incomeMigrationVersion: 1,
          futureIncomeResetVersion: 1,
        },
      },
      applyAssistantConfirmation,
      reloadAfterAssistantConflict,
    });
  });

  it("chỉ gửi mutation sau khi người dùng xác nhận bản xem trước", async () => {
    vi.spyOn(api, "sendAssistantMessage").mockResolvedValue({
      reply: "Mình đã chuẩn bị khoản chi. Hãy kiểm tra rồi xác nhận.",
      evidence: [{ source: "transactions", label: "Danh mục và tài khoản" }],
      proposal,
    });
    const confirm = vi.spyOn(api, "confirmAssistantAction").mockResolvedValue({
      kind: "create_transaction",
      transaction: proposal.transaction,
      workspaceRevision: 2,
      alreadyApplied: false,
    });

    render(<MemoryRouter initialEntries={["/expenses"]}><AssistantWidget /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Mở trợ lý tài chính" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nhắn cho trợ lý" }), {
      target: { value: "50k ăn sáng" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi tin nhắn" }));

    expect(await screen.findByText("Mình đã chuẩn bị khoản chi. Hãy kiểm tra rồi xác nhận.")).toBeVisible();
    expect(screen.getByText("50,000đ")).toBeVisible();
    expect(screen.getByText("Danh mục và tài khoản")).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith("signed-token"));
    expect(applyAssistantConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      kind: "create_transaction",
      workspaceRevision: 2,
    }));
    expect(await screen.findByText("Đã ghi khoản thu chi thành công.")).toBeVisible();
    expect(screen.getByText("Đã xác nhận")).toBeVisible();
  });

  it("hủy proposal không gọi API xác nhận và lịch sử mất khi component được tạo lại", async () => {
    vi.spyOn(api, "sendAssistantMessage").mockResolvedValue({
      reply: "Bản xem trước đã sẵn sàng.",
      evidence: [],
      proposal,
    });
    const confirm = vi.spyOn(api, "confirmAssistantAction");
    const view = render(<MemoryRouter><AssistantWidget /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Mở trợ lý tài chính" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nhắn cho trợ lý" }), {
      target: { value: "50k ăn sáng" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi tin nhắn" }));
    await screen.findByText("Bản xem trước đã sẵn sàng.");
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText("Đã hủy")).toBeVisible();

    view.unmount();
    render(<MemoryRouter><AssistantWidget /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Mở trợ lý tài chính" }));
    expect(screen.getByText("Bạn muốn làm gì?")).toBeVisible();
    expect(screen.queryByText("Bản xem trước đã sẵn sàng.")).not.toBeInTheDocument();
  });
});
