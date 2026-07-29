import { useEffect, useMemo, useState } from "react";
import type { DebtDetailResponse, DebtKind, DebtOverviewItem } from "@chi-tieu/shared";
import { DateField } from "@/components/DateField";
import { AsyncButton } from "@/components/AsyncButton";
import { Modal } from "@/components/Modal";
import { MoneyInput } from "@/components/MoneyInput";
import { ResourceStatus } from "@/components/ResourceStatus";
import { Select } from "@/components/Select";
import { api } from "@/lib/api";
import { fmt } from "@/lib/domain";
import { useFinanceStore } from "@/store/finance-store";

const TYPE_LABEL: Record<DebtKind, string> = {
  borrowed: "Tiền đang vay",
  lent: "Người khác nợ tôi",
  credit_card: "Thẻ tín dụng",
  installment: "Trả góp",
};

const TYPES = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value: value as DebtKind, label }));

export function DebtsPage() {
  const fundOverview = useFinanceStore((state) => state.fundOverview);
  const overview = useFinanceStore((state) => state.debtOverview);
  const details = useFinanceStore((state) => state.debtDetails);
  const loadDebts = useFinanceStore((state) => state.loadDebts);
  const loadDebtDetail = useFinanceStore((state) => state.loadDebtDetail);
  const loadFunds = useFinanceStore((state) => state.loadFunds);
  const debtsState = useFinanceStore((state) => state.debtsState);
  const mutateLedger = useFinanceStore((state) => state.mutateLedger);
  const [filter, setFilter] = useState<"all" | DebtKind>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "overdue" | "dueSoon" | "settled">("all");
  const [dueDate, setDueDate] = useState("");
  const [editing, setEditing] = useState<DebtFormDebt | null | "new">(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => { void loadDebts(); }, [loadDebts]);
  useEffect(() => { void loadFunds(); }, [loadFunds]);
  useEffect(() => {
    if (!selectedId) return;
    setDetailLoading(true);
    void loadDebtDetail(selectedId).finally(() => setDetailLoading(false));
  }, [loadDebtDetail, overview, selectedId]);

  const items = useMemo(() => (overview?.items ?? []).filter((item) => {
    if (filter !== "all" && item.kind !== filter) return false;
    if (statusFilter === "overdue" && !item.overdue) return false;
    if (statusFilter === "dueSoon" && !item.dueSoon) return false;
    if (statusFilter === "settled" && item.status !== "settled") return false;
    return !dueDate || item.nextPayment?.dueDate === dueDate;
  }), [dueDate, filter, overview, statusFilter]);
  const selected = selectedId ? details[selectedId] : null;
  const summary = overview?.summary ?? { liabilities: 0, receivables: 0, netDebt: 0, overdueCount: 0, dueSoonCount: 0 };
  const assets = (fundOverview?.funds ?? []).reduce((total, fund) =>
    total + fund.allTimeCurrentValue + fund.openingBalance, 0);
  const netWorth = assets + summary.receivables - summary.liabilities;

  if (!overview && (debtsState === "loading" || debtsState === "error")) {
    return <section className="page-view"><ResourceStatus state={debtsState} hasData={false} label="dữ liệu vay và nợ" onRetry={() => void loadDebts()} /></section>;
  }

  return (
    <section className="page-view debts-page">
      <ResourceStatus state={debtsState} hasData={Boolean(overview)} label="dữ liệu vay và nợ" onRetry={() => void loadDebts()} />
      <div className="toolbar">
        <button className="btn primary" type="button" onClick={() => setEditing("new")}>+ Thêm khoản vay/nợ</button>
        <Select<"all" | DebtKind>
          value={filter}
          options={[{ value: "all", label: "Tất cả loại" }, ...TYPES]}
          onValueChange={setFilter}
          ariaLabel="Lọc loại khoản vay nợ"
          compact
        />
        <Select<"all" | "overdue" | "dueSoon" | "settled">
          value={statusFilter}
          options={[
            { value: "all", label: "Tất cả trạng thái" },
            { value: "overdue", label: "Quá hạn" },
            { value: "dueSoon", label: "Sắp đến hạn" },
            { value: "settled", label: "Đã hoàn tất" },
          ]}
          onValueChange={setStatusFilter}
          ariaLabel="Lọc trạng thái khoản vay nợ"
          compact
        />
        <label className="debt-filter-date">Ngày đến hạn<DateField value={dueDate} onChange={setDueDate} ariaLabel="Lọc theo ngày đến hạn" /></label>
        {dueDate ? <button className="btn sm" type="button" onClick={() => setDueDate("")}>Xóa ngày lọc</button> : null}
      </div>

      <div className="stat-row stat-row-6">
        <Stat label="Nợ phải trả" value={fmt(summary.liabilities)} accent="rust" />
        <Stat label="Khoản phải thu" value={fmt(summary.receivables)} accent="green" />
        <Stat label="Tổng tài sản" value={fmt(assets)} accent="blue" />
        <Stat label="Tài sản ròng" value={fmt(netWorth)} accent={netWorth < 0 ? "rust" : "green"} />
        <Stat label="Quá hạn" value={String(summary.overdueCount)} accent="rust" />
        <Stat label="Sắp đến hạn" value={String(summary.dueSoonCount)} accent="gold" />
      </div>

      {summary.overdueCount ? <div className="warn-box"><span>⚠</span><div>Có <b>{summary.overdueCount}</b> khoản đã quá hạn thanh toán.</div></div> : null}

      <div className="debts-layout">
        <article className="card section-card">
          <h2>Danh sách khoản vay & nợ</h2>
          {!items.length ? <div className="empty-state">Chưa có khoản nào phù hợp.</div> : <div className="debt-list">
            {items.map((item) => (
              <button type="button" className={`debt-item ${selectedId === item.id ? "active" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)}>
                <span className={`debt-kind ${item.kind}`}>{TYPE_LABEL[item.kind]}</span>
                <strong>{item.name}</strong>
                <span>{item.counterparty || "Chưa ghi đối tác"}</span>
                <b>{fmt(item.remainingBalance)}</b>
                {item.needsSetup ? <small className="negative">Cần hoàn thiện lịch</small>
                  : item.overdue ? <small className="negative">Quá hạn {item.nextPayment?.dueDate}</small>
                    : item.dueSoon ? <small className="warning">Đến hạn {item.nextPayment?.dueDate}</small>
                      : <small>{item.nextPayment ? `Kỳ ${item.nextPayment.installment}: ${item.nextPayment.dueDate}` : "Đã hoàn tất"}</small>}
              </button>
            ))}
          </div>}
        </article>

        <article className="card section-card debt-detail">
          {detailLoading ? <div className="resource-status empty" role="status"><span className="loading-spinner" aria-hidden="true" />Đang tải chi tiết khoản vay/nợ…</div> : !selected ? <div className="empty-state">Chọn một khoản để xem lịch thanh toán.</div> : <>
            <div className="debt-detail-head">
              <div><span className={`debt-kind ${selected.kind}`}>{TYPE_LABEL[selected.kind]}</span><h2>{selected.name}</h2><p className="hint">{selected.counterparty || "Chưa ghi đối tác"}</p></div>
              <div className="debt-detail-actions"><button className="btn sm" type="button" onClick={() => setEditing(selected)}>Sửa</button><AsyncButton className="btn sm danger" busyLabel="Đang xóa…" onAction={async () => {
                if (!window.confirm(`Xóa ${selected.name} và lịch sử giao dịch liên quan?`)) return;
                await mutateLedger(() => undefined, (revision) => api.deleteDebt(selected.id, revision));
                setSelectedId(null);
              }}>Xóa</AsyncButton></div>
            </div>
            <div className="debt-numbers">
              <div><span>Dư nợ còn lại</span><b>{fmt(selected.remainingBalance)}</b></div>
              <div><span>Lãi suất năm</span><b>{selected.annualInterestRate}%</b></div>
              <div><span>Lãi dự kiến</span><b>{fmt(selected.expectedInterest)}</b></div>
            </div>
            {selected.needsSetup ? <div className="warn-box"><span>⚠</span><div>Khoản này chưa có kỳ hạn, ngày đến hạn hoặc danh mục giao dịch. Hãy sửa để hoàn thiện lịch.</div></div> : null}
            <h3>Lịch thanh toán</h3>
            <div className="schedule-list">
              {selected.schedule.map((item) => <div className={`schedule-row ${item.payment ? "paid" : ""}`} key={item.installment}>
                <div><b>Kỳ {item.installment}</b><span>{item.dueDate}</span></div>
                <div><b>{fmt(item.amount)}</b><span>Gốc {fmt(item.principalAmount)} · Lãi {fmt(item.interestAmount)}</span></div>
                {item.payment ? <div><span>Đã {selected.kind === "lent" ? "thu" : "trả"} {item.payment.paidAt}</span><AsyncButton className="btn sm danger" busyLabel="Đang hoàn tác…" onAction={() => {
                  if (!window.confirm("Hoàn tác kỳ thanh toán gần nhất?")) return;
                  return mutateLedger(() => undefined, (revision) => api.deleteDebtPayment(selected.id, item.payment!.id, revision));
                }}>Hoàn tác</AsyncButton></div>
                  : item.installment === selected.nextPayment?.installment ? <AsyncButton className="btn sm primary" busyLabel="Đang ghi nhận…" onAction={() => mutateLedger(() => undefined, (revision) => api.recordDebtPayment(selected.id, new Date().toISOString().slice(0, 10), "", revision))}>{selected.kind === "lent" ? "Xác nhận đã thu" : "Xác nhận đã trả"}</AsyncButton>
                    : <span />}
              </div>)}
            </div>
            <h3>Lịch sử</h3>
            {!selected.payments.length ? <p className="hint">Chưa có kỳ thanh toán nào.</p> : <ul className="debt-history">{selected.payments.map((payment) => <li key={payment.id}>Kỳ {payment.installment} · {payment.paidAt} · {fmt(payment.amount)}</li>)}</ul>}
          </>}
        </article>
      </div>

      {editing === "new" ? <DebtForm key="new" onClose={() => setEditing(null)} /> : null}
      {editing && editing !== "new" ? <DebtForm key={editing.id} debt={editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

type DebtFormDebt = DebtOverviewItem | DebtDetailResponse;

function DebtForm({ debt, onClose }: { debt?: DebtFormDebt; onClose(): void }) {
  const ledger = useFinanceStore((state) => state.ledger);
  const mutateLedger = useFinanceStore((state) => state.mutateLedger);
  const [kind, setKind] = useState<DebtKind>(debt?.kind ?? "borrowed");
  const [name, setName] = useState(debt?.name ?? "");
  const [counterparty, setCounterparty] = useState(debt?.counterparty ?? "");
  const [principal, setPrincipal] = useState(debt?.principal ?? 0);
  const [rate, setRate] = useState(debt?.annualInterestRate ?? 0);
  const [termMonths, setTermMonths] = useState(debt?.termMonths || 1);
  const [paymentAmount, setPaymentAmount] = useState(debt?.paymentAmount ?? 0);
  const [firstPaymentDate, setFirstPaymentDate] = useState(debt?.firstPaymentDate ?? new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState(debt?.paymentCategoryId ?? "");
  const [accountId, setAccountId] = useState(debt?.paymentAccountId ?? "");
  const [note, setNote] = useState(debt?.note ?? "");
  const categories = kind === "lent" ? ledger.expense.incomeCats : ledger.expense.cats;
  const locked = Boolean(debt && "payments" in debt && debt.payments.length);
  const valid = name.trim() && principal > 0 && paymentAmount > 0 && termMonths > 0 && firstPaymentDate && categoryId && paymentAmount * termMonths >= principal;
  const save = async (): Promise<void> => {
    const common = { name: name.trim(), counterparty: counterparty.trim(), paymentCategoryId: categoryId, note: note.trim() };
    if (debt && locked) await mutateLedger(() => undefined, (revision) => api.updateDebt(debt.id, { ...common, paymentAccountId: accountId || "" }, revision));
    else {
      const payload = { kind, ...common, principal, annualInterestRate: rate, termMonths, paymentAmount, firstPaymentDate };
      if (debt) await mutateLedger(() => undefined, (revision) => api.updateDebt(debt.id, { ...payload, paymentAccountId: accountId || "" }, revision));
      else await mutateLedger(() => undefined, (revision) => api.createDebt({ ...payload, ...(accountId ? { paymentAccountId: accountId } : {}) }, revision));
    }
    onClose();
  };

  return <Modal title={debt ? "Sửa khoản vay/nợ" : "Thêm khoản vay/nợ"} onClose={onClose} wide footer={<><button className="btn" type="button" onClick={onClose}>Hủy</button><AsyncButton className="btn primary" disabled={!valid} busyLabel="Đang lưu…" onAction={save}>{debt ? "Lưu thay đổi" : "Tạo khoản"}</AsyncButton></>}>
    {locked ? <div className="warn-box"><span>⚠</span><div>Đã có kỳ thanh toán; các trường lịch trả được khóa. Hoàn tác kỳ gần nhất trước khi sửa lịch.</div></div> : null}
    <div className="entry-form debt-form">
      <label>Loại<Select value={kind} options={TYPES} onValueChange={(value) => { setKind(value); setCategoryId(""); }} ariaLabel="Loại khoản" /></label>
      <label>Tên khoản<input value={name} onChange={(event) => setName(event.target.value)} placeholder="vd: Trả góp điện thoại" /></label>
      <label>Ngân hàng/người liên quan<input value={counterparty} onChange={(event) => setCounterparty(event.target.value)} placeholder="vd: VPBank, Minh" /></label>
      <label>Số tiền gốc<MoneyInput value={principal} allowZero={false} onCommit={setPrincipal} disabled={locked} /></label>
      <label>Lãi suất năm (%)<input type="number" min="0" step="0.1" value={rate} disabled={locked} onChange={(event) => setRate(Math.max(0, Number(event.target.value) || 0))} /></label>
      <label>Kỳ hạn (tháng)<input type="number" min="1" value={termMonths} disabled={locked} onChange={(event) => setTermMonths(Math.max(1, Math.floor(Number(event.target.value) || 1)))} /></label>
      <label>Số tiền trả mỗi kỳ<MoneyInput value={paymentAmount} allowZero={false} disabled={locked} onCommit={setPaymentAmount} /></label>
      <label>Ngày đến hạn kỳ đầu<DateField value={firstPaymentDate} onChange={setFirstPaymentDate} disabled={locked} /></label>
      <label>Danh mục {kind === "lent" ? "thu" : "chi"}<Select<string> value={categoryId} options={[{ value: "", label: "Chọn danh mục" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]} onValueChange={setCategoryId} ariaLabel="Danh mục giao dịch tự động" disabled={locked} /></label>
      <label>Tài khoản nguồn/nhận<Select<string> value={accountId} options={[{ value: "", label: "Chưa xác định" }, ...ledger.expense.accounts.map((account) => ({ value: account.id, label: account.name }))]} onValueChange={setAccountId} ariaLabel="Tài khoản giao dịch tự động" /></label>
      <label className="debt-form-note">Ghi chú<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {paymentAmount * termMonths < principal ? <p className="negative">Tổng các kỳ trả phải ít nhất bằng số tiền gốc.</p> : null}
    </div>
  </Modal>;
}

function Stat({ label, value, accent }: { label: string; value: string; accent: "gold" | "green" | "rust" | "blue" }) {
  return <div className={`stat accent-${accent}`}><div className="k">{label}</div><div className="v">{value}</div></div>;
}
