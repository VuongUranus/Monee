import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantWidget } from "./AssistantWidget";
import { api } from "@/lib/api";
import { useFinanceStore } from "@/store/finance-store";

const breakfastAction = {
  kind: "create_transaction" as const,
  actionId: "d8b6c3b1-2b96-4b30-84dd-513a838ce02b",
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
const toothpasteAction = {
  kind: "create_transaction" as const,
  actionId: "b58a361d-3c94-4659-8a80-f37cf091c85a",
  transaction: {
    id: "b58a361d-3c94-4659-8a80-f37cf091c85a",
    date: "2026-07-27",
    type: "expense" as const,
    cat: "household",
    amount: 45_000,
    note: "Kem đánh răng",
  },
  categoryName: "Đồ dùng",
};
const proposal = {
  kind: "action_batch" as const,
  batchId: "674e98e5-eaef-4a93-a7e2-0c18435180b6",
  expectedRevision: 1,
  confirmationToken: "signed-token",
  expiresAt: "2026-07-27T10:10:00.000Z",
  actions: [breakfastAction, toothpasteAction],
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
      reply: "Mình đã chuẩn bị 2 khoản chi. Hãy kiểm tra rồi xác nhận.",
      evidence: [{ source: "transactions", label: "Danh mục và tài khoản" }],
      proposal,
    });
    const confirm = vi.spyOn(api, "confirmAssistantAction").mockResolvedValue({
      kind: "action_batch",
      batchId: proposal.batchId,
      results: proposal.actions.map((action) => ({
        kind: "create_transaction" as const,
        actionId: action.actionId,
        transaction: action.transaction,
      })),
      workspaceRevision: 2,
      alreadyApplied: false,
    });

    render(<MemoryRouter initialEntries={["/expenses"]}><AssistantWidget /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Mở trợ lý tài chính" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nhắn cho trợ lý" }), {
      target: { value: "50k ăn sáng và 45k kem đánh răng" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi tin nhắn" }));

    expect(await screen.findByText("Mình đã chuẩn bị 2 khoản chi. Hãy kiểm tra rồi xác nhận.")).toBeVisible();
    expect(screen.getByText("2 thao tác")).toBeVisible();
    expect(screen.getByText("50,000đ")).toBeVisible();
    expect(screen.getByText("45,000đ")).toBeVisible();
    expect(screen.getByText("Danh mục và tài khoản")).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith("signed-token"));
    expect(applyAssistantConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      kind: "action_batch",
      results: expect.arrayContaining([expect.objectContaining({ kind: "create_transaction" })]),
      workspaceRevision: 2,
    }));
    expect(await screen.findByText("Đã ghi 2 thao tác thành công (2 khoản thu/chi, 0 lần trích quỹ).")).toBeVisible();
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

  it("render Markdown trong phản hồi của trợ lý nhưng giữ tin nhắn người dùng dạng văn bản", async () => {
    vi.spyOn(api, "sendAssistantMessage").mockResolvedValue({
      reply: "**Tóm tắt**\n\n- Ăn sáng: 30.000đ\n- Kem đánh răng: 45.000đ\n\n[Xem chi tiết](https://example.com)",
      evidence: [],
    });
    render(<MemoryRouter><AssistantWidget /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Mở trợ lý tài chính" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nhắn cho trợ lý" }), {
      target: { value: "Cho tôi xem tóm tắt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi tin nhắn" }));

    expect((await screen.findByText("Tóm tắt")).tagName).toBe("STRONG");
    expect(screen.getByRole("list")).toHaveTextContent("Ăn sáng: 30.000đ");
    expect(screen.getByRole("link", { name: "Xem chi tiết" })).toHaveAttribute("href", "https://example.com");
    expect(screen.getByText("Cho tôi xem tóm tắt")).toHaveClass("assistant-bubble");
  });
});
