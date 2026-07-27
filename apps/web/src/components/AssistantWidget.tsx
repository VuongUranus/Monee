import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AssistantEvidence,
  AssistantHistoryTurn,
  AssistantProposal,
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
  proposal?: AssistantProposal;
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
  proposal: AssistantProposal;
  status: ProposalStatus;
  onConfirm(): void;
  onCancel(): void;
}) {
  const statusLabel = status === "confirmed" ? "Đã xác nhận"
    : status === "cancelled" ? "Đã hủy"
      : status === "stale" ? "Cần tạo lại"
        : status === "confirming" ? "Đang lưu…"
          : "Chờ xác nhận";
  return (
    <section className={`assistant-proposal status-${status}`} aria-label="Bản xem trước hành động">
      <div className="assistant-proposal-head">
        <strong>{proposal.kind === "create_transaction" ? "Ghi khoản thu chi" : "Trích quỹ"}</strong>
        <span>{statusLabel}</span>
      </div>
      {proposal.kind === "create_transaction" ? (
        <dl>
          <div><dt>Ngày</dt><dd>{proposal.transaction.date}</dd></div>
          <div><dt>Loại</dt><dd>{proposal.transaction.type === "expense" ? "Chi" : "Thu"}</dd></div>
          <div><dt>Danh mục</dt><dd>{proposal.categoryName}</dd></div>
          <div><dt>Tài khoản</dt><dd>{proposal.accountName ?? "Chưa xác định"}</dd></div>
          <div><dt>Số tiền</dt><dd>{fmt(proposal.transaction.amount)}</dd></div>
          <div><dt>Ghi chú</dt><dd>{proposal.transaction.note || "—"}</dd></div>
        </dl>
      ) : (
        <dl>
          <div><dt>Quỹ</dt><dd>{proposal.fundName}</dd></div>
          <div><dt>Kỳ</dt><dd>{MONTHS_FULL[proposal.month - 1]} / {proposal.year}</dd></div>
          <div><dt>Thao tác</dt><dd>{proposal.operation === "increment" ? `Cộng ${fmt(proposal.amount)}` : `Đặt thành ${fmt(proposal.amount)}`}</dd></div>
          <div><dt>Trước → sau</dt><dd>{fmt(proposal.previousAmount)} → {fmt(proposal.nextAmount)}</dd></div>
        </dl>
      )}
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
      setMessages((current) => [...current, {
        id: messageId(),
        role: "assistant",
        text: result.alreadyApplied
          ? "Thao tác này đã được ghi trước đó; dữ liệu hiện tại đã được đồng bộ."
          : result.kind === "create_transaction"
            ? "Đã ghi khoản thu chi thành công."
            : "Đã cập nhật quỹ thành công.",
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
            <p className="eyebrow">Gemini AI</p>
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
