import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AssistantEvidence,
  AssistantHistoryTurn,
  AssistantProposalAction,
  AssistantProposalBatch,
} from "@chi-tieu/shared";
import { useLocation } from "react-router";
import { api, ApiRequestError, UnauthorizedError } from "@/lib/api";
import { fmt, MONTHS_FULL } from "@/lib/domain";
import { useFinanceStore } from "@/store/finance-store";

type ProposalStatus = "pending" | "confirming" | "confirmed" | "cancelled" | "stale";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  evidence?: AssistantEvidence[];
  proposal?: AssistantProposalBatch;
  proposalStatus?: ProposalStatus;
}

function messageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function routeName(pathname: string): "expenses" | "funds" | "statistics" | "debts" {
  const route = pathname.slice(1);
  return route === "funds" || route === "statistics" || route === "debts" ? route : "expenses";
}

function ProposalCard({
  proposal,
  status,
  onConfirm,
  onCancel,
}: {
  proposal: AssistantProposalBatch;
  status: ProposalStatus;
  onConfirm(): void;
  onCancel(): void;
}) {
  const statusLabel = status === "confirmed" ? "Đã xác nhận"
    : status === "cancelled" ? "Đã hủy"
      : status === "stale" ? "Cần tạo lại"
        : status === "confirming" ? "Đang lưu…"
          : "Chờ xác nhận";
  const transactionTotals = proposal.actions.reduce((totals, action) => {
    if (action.kind === "create_transaction") totals[action.transaction.type] += action.transaction.amount;
    return totals;
  }, { income: 0, expense: 0 });
  const actionTitle = (action: AssistantProposalAction): string => action.kind === "create_transaction"
    ? action.transaction.type === "expense" ? "Khoản chi" : "Khoản thu"
    : "Trích quỹ";
  return (
    <section className={`assistant-proposal status-${status}`} aria-label="Bản xem trước hành động">
      <div className="assistant-proposal-head">
        <strong>{proposal.actions.length} thao tác</strong>
        <span>{statusLabel}</span>
      </div>
      {transactionTotals.income || transactionTotals.expense ? (
        <div className="assistant-proposal-summary" aria-label="Tổng thu chi">
          {transactionTotals.income ? <span>Thu <strong>{fmt(transactionTotals.income)}</strong></span> : null}
          {transactionTotals.expense ? <span>Chi <strong>{fmt(transactionTotals.expense)}</strong></span> : null}
        </div>
      ) : null}
      <ol className="assistant-proposal-list">
        {proposal.actions.map((action, index) => (
          <li key={action.actionId}>
            <div className="assistant-proposal-item-head">
              <strong>{index + 1}. {actionTitle(action)}</strong>
              <span>{action.kind === "create_transaction"
                ? fmt(action.transaction.amount)
                : action.operation === "increment" ? `+${fmt(action.amount)}` : fmt(action.amount)}</span>
            </div>
            {action.kind === "create_transaction" ? (
              <dl>
                <div><dt>Ngày</dt><dd>{action.transaction.date}</dd></div>
                <div><dt>Danh mục</dt><dd>{action.categoryName}</dd></div>
                <div><dt>Tài khoản</dt><dd>{action.accountName ?? "Chưa xác định"}</dd></div>
                <div><dt>Ghi chú</dt><dd>{action.transaction.note || "—"}</dd></div>
              </dl>
            ) : (
              <dl>
                <div><dt>Quỹ</dt><dd>{action.fundName}</dd></div>
                <div><dt>Kỳ</dt><dd>{MONTHS_FULL[action.month - 1]} / {action.year}</dd></div>
                <div><dt>Thao tác</dt><dd>{action.operation === "increment" ? `Cộng ${fmt(action.amount)}` : `Đặt thành ${fmt(action.amount)}`}</dd></div>
                <div><dt>Trước → sau</dt><dd>{fmt(action.previousAmount)} → {fmt(action.nextAmount)}</dd></div>
              </dl>
            )}
          </li>
        ))}
      </ol>
      {status === "pending" || status === "confirming" ? (
        <div className="assistant-proposal-actions">
          <button className="btn sm primary" type="button" disabled={status === "confirming"} onClick={onConfirm}>Xác nhận</button>
          <button className="btn sm" type="button" disabled={status === "confirming"} onClick={onCancel}>Hủy</button>
        </div>
      ) : null}
    </section>
  );
}

export function AssistantWidget() {
  const location = useLocation();
  const enabled = useFinanceStore((state) => state.bootstrapData?.features.aiAssistant === true);
  const selectedYear = useFinanceStore((state) => state.selectedYear);
  const selectedMonth = useFinanceStore((state) => state.selectedMonth);
  const applyConfirmation = useFinanceStore((state) => state.applyAssistantConfirmation);
  const reloadAfterConflict = useFinanceStore((state) => state.reloadAfterAssistantConflict);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const pending = messages.some((message) => message.proposal && message.proposalStatus === "pending");

  const context = useMemo(() => ({
    route: routeName(location.pathname),
    selectedYear,
    selectedMonth: selectedMonth + 1,
  }), [location.pathname, selectedMonth, selectedYear]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open && typeof endRef.current?.scrollIntoView === "function") {
      endRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [messages, open, sending]);

  if (!enabled) return null;

  const send = async (): Promise<void> => {
    const message = draft.trim();
    if (!message || sending || pending) return;
    const history: AssistantHistoryTurn[] = messages
      .map(({ role, text }) => ({ role, text }))
      .slice(-12);
    setMessages((current) => [...current, { id: messageId(), role: "user", text: message }]);
    setDraft("");
    setSending(true);
    setError("");
    try {
      const response = await api.sendAssistantMessage({ message, history, context });
      setMessages((current) => [...current, {
        id: messageId(),
        role: "assistant",
        text: response.reply,
        evidence: response.evidence,
        ...(response.proposal ? { proposal: response.proposal, proposalStatus: "pending" as const } : {}),
      }]);
    } catch (caught) {
      if (caught instanceof UnauthorizedError) {
        setError("Phiên đăng nhập đã hết hạn. Vui lòng tải lại trang.");
      } else {
        setError(caught instanceof Error ? caught.message : "Trợ lý chưa thể phản hồi. Hãy thử lại.");
      }
    } finally {
      setSending(false);
    }
  };

  const updateProposalStatus = (id: string, status: ProposalStatus): void => {
    setMessages((current) => current.map((message) => message.id === id
      ? { ...message, proposalStatus: status }
      : message));
  };

  const confirm = async (message: ChatMessage): Promise<void> => {
    if (!message.proposal || message.proposalStatus !== "pending") return;
    updateProposalStatus(message.id, "confirming");
    setError("");
    try {
      const result = await api.confirmAssistantAction(message.proposal.confirmationToken);
      await applyConfirmation(result);
      updateProposalStatus(message.id, "confirmed");
      const transactionResults = result.results.filter((item) => item.kind === "create_transaction");
      const fundResults = result.results.filter((item) => item.kind === "allocate_fund");
      const successText = result.results.length === 1
        ? transactionResults.length ? "Đã ghi khoản thu chi thành công." : "Đã cập nhật quỹ thành công."
        : `Đã ghi ${result.results.length} thao tác thành công (${transactionResults.length} khoản thu/chi, ${fundResults.length} lần trích quỹ).`;
      setMessages((current) => [...current, {
        id: messageId(),
        role: "assistant",
        text: result.alreadyApplied
          ? "Nhóm thao tác này đã được ghi trước đó; dữ liệu hiện tại đã được đồng bộ."
          : successText,
      }]);
    } catch (caught) {
      const stale = caught instanceof ApiRequestError
        && (caught.code === "revision_conflict" || caught.code === "assistant_action_expired");
      updateProposalStatus(message.id, stale ? "stale" : "pending");
      if (stale) await reloadAfterConflict();
      setError(caught instanceof Error ? caught.message : "Chưa thể xác nhận thao tác.");
    }
  };

  return (
    <>
      {open ? <button className="assistant-backdrop" type="button" aria-label="Đóng trợ lý" onClick={() => setOpen(false)} /> : null}
      <button
        className={`assistant-launcher ${open ? "is-open" : ""}`}
        type="button"
        aria-label={open ? "Đóng trợ lý tài chính" : "Mở trợ lý tài chính"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">✦</span>
        <span>Trợ lý</span>
      </button>
      <aside className={`assistant-panel ${open ? "is-open" : ""}`} role="dialog" aria-modal="false" aria-label="Trợ lý tài chính">
        <header className="assistant-head">
          <div>
            <p className="eyebrow">Monee AI</p>
            <h2>Trợ lý tài chính</h2>
          </div>
          <button className="icon-btn" type="button" aria-label="Đóng trợ lý" onClick={() => setOpen(false)}>×</button>
        </header>
        <div className="assistant-messages" aria-live="polite">
          {!messages.length ? (
            <div className="assistant-welcome">
              <strong>Bạn muốn làm gì?</strong>
              <p>Thử “50k ăn sáng”, “trích 2 triệu vào quỹ dự phòng” hoặc “tháng này tôi chi nhiều nhất vào đâu?”.</p>
            </div>
          ) : null}
          {messages.map((message) => (
            <article className={`assistant-message ${message.role}`} key={message.id}>
              <div className="assistant-bubble">{message.text}</div>
              {message.evidence?.length ? (
                <div className="assistant-evidence" aria-label="Nguồn dữ liệu">
                  {message.evidence.map((item) => <span key={`${item.source}-${item.label}`}>{item.label}</span>)}
                </div>
              ) : null}
              {message.proposal && message.proposalStatus ? (
                <ProposalCard
                  proposal={message.proposal}
                  status={message.proposalStatus}
                  onConfirm={() => void confirm(message)}
                  onCancel={() => updateProposalStatus(message.id, "cancelled")}
                />
              ) : null}
            </article>
          ))}
          {sending ? <div className="assistant-typing" role="status"><span /><span /><span /> Đang phân tích…</div> : null}
          <div ref={endRef} />
        </div>
        <form className="assistant-compose" onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}>
          {pending ? <p>Hãy xác nhận hoặc hủy bản xem trước trước khi gửi yêu cầu mới.</p> : null}
          {error ? <p className="assistant-error" role="alert">{error}</p> : null}
          <div>
            <textarea
              ref={inputRef}
              aria-label="Nhắn cho trợ lý"
              rows={2}
              maxLength={2_000}
              placeholder="Nhập khoản chi hoặc đặt câu hỏi…"
              value={draft}
              disabled={sending || pending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn primary" type="submit" disabled={!draft.trim() || sending || pending} aria-label="Gửi tin nhắn">Gửi</button>
          </div>
          <small>AI có thể nhầm. Luôn kiểm tra bản xem trước trước khi xác nhận.</small>
        </form>
      </aside>
    </>
  );
}
