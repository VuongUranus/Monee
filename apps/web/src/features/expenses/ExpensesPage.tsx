import { useEffect, useMemo, useState } from "react";
import type { Account, FinanceCategory, Transaction, TransactionQuery, TransactionType } from "@chi-tieu/shared";
import { AccountExpenseChart } from "@/components/AccountExpenseChart";
import { AsyncButton } from "@/components/AsyncButton";
import { DonutChart } from "@/components/Charts";
import { DateField } from "@/components/DateField";
import { Modal } from "@/components/Modal";
import { MoneyInput } from "@/components/MoneyInput";
import { ResourceStatus } from "@/components/ResourceStatus";
import { Select } from "@/components/Select";
import { api } from "@/lib/api";
import {
  categoriesForType,
  accountForTransaction,
  categoryForTransaction,
  fmt,
  monthKey,
  MONTHS_FULL,
  PALETTE,
  slugId,
} from "@/lib/domain";
import { useFinanceStore } from "@/store/finance-store";

interface HistoryFilters {
  from: string;
  to: string;
  type: "" | TransactionType;
  category: string;
  account: string;
  search: string;
}

const emptyFilters: HistoryFilters = { from: "", to: "", type: "", category: "", account: "", search: "" };
const HISTORY_PAGE_SIZE = 10;

function sameTransactionQuery(left: TransactionQuery | null, right: TransactionQuery): boolean {
  if (!left) return false;
  return left.from === right.from
    && left.to === right.to
    && left.type === right.type
    && left.categoryId === right.categoryId
    && left.accountId === right.accountId
    && left.q === right.q
    && (left.page ?? 1) === (right.page ?? 1)
    && (left.pageSize ?? 10) === (right.pageSize ?? 10);
}

export function ExpensesPage() {
  const ledger = useFinanceStore((state) => state.ledger);
  const year = useFinanceStore((state) => state.selectedYear);
  const month = useFinanceStore((state) => state.selectedMonth);
  const periodReady = useFinanceStore((state) => state.periodReady);
  const expenseSummary = useFinanceStore((state) => state.expenseSummary);
  const transactionPage = useFinanceStore((state) => state.transactionPage);
  const transactionQuery = useFinanceStore((state) => state.transactionQuery);
  const loadExpenses = useFinanceStore((state) => state.loadExpenses);
  const loadTransactions = useFinanceStore((state) => state.loadTransactions);
  const expensesState = useFinanceStore((state) => state.expensesState);
  const createTransaction = useFinanceStore((state) => state.createTransaction);
  const deleteTransaction = useFinanceStore((state) => state.deleteTransaction);
  const [managing, setManaging] = useState(false);
  const [managingAccounts, setManagingAccounts] = useState(false);
  const [type, setType] = useState<TransactionType>("expense");
  const [category, setCategory] = useState(ledger.expense.cats[0]?.id ?? "");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [filters, setFilters] = useState<HistoryFilters>(emptyFilters);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [activeBreakdownTab, setActiveBreakdownTab] = useState<"expense" | "income" | "account">("expense");

  const monthPrefix = monthKey(year, month);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const minDate = `${monthPrefix}-01`;
  const maxDate = `${monthPrefix}-${String(daysInMonth).padStart(2, "0")}`;

  useEffect(() => {
    const today = new Date();
    const day = today.getFullYear() === year && today.getMonth() === month ? today.getDate() : 1;
    setDate(`${monthPrefix}-${String(day).padStart(2, "0")}`);
    setFilters(emptyFilters);
    setEditingId(null);
  }, [month, monthPrefix, year]);

  useEffect(() => {
    setHistoryPage(1);
  }, [filters]);

  useEffect(() => {
    if (periodReady) void loadExpenses();
  }, [loadExpenses, month, periodReady, year]);

  const historyQuery = useMemo(() => ({
    from: filters.from || minDate,
    to: filters.to || maxDate,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.category ? { categoryId: filters.category } : {}),
    ...(filters.account ? { accountId: filters.account } : {}),
    ...(filters.search.trim() ? { q: filters.search.trim() } : {}),
    page: historyPage,
    pageSize: HISTORY_PAGE_SIZE,
  }), [filters.account, filters.category, filters.from, filters.search, filters.to, filters.type, historyPage, maxDate, minDate]);

  useEffect(() => {
    if (!expenseSummary || expenseSummary.year !== year || expenseSummary.month !== month + 1) return;
    if (sameTransactionQuery(transactionQuery, historyQuery)) return;
    const timer = window.setTimeout(() => {
      void loadTransactions(historyQuery);
    }, filters.search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [
    expenseSummary,
    filters.account,
    filters.category,
    filters.from,
    filters.search,
    filters.to,
    filters.type,
    historyPage,
    historyQuery,
    loadTransactions,
    maxDate,
    minDate,
    month,
    transactionQuery,
    year,
  ]);

  const entryCategories = categoriesForType(ledger, type);
  const selectedCategory = entryCategories.some((item) => item.id === category)
    ? category
    : entryCategories[0]?.id ?? "";
  const selectedAccount = ledger.expense.accounts.some((item) => item.id === account) ? account : "";
  const accountOptions = accountSelectOptions(ledger.expense.accounts);

  const transactions = transactionPage?.items ?? [];
  const income = expenseSummary?.income ?? 0;
  const carryOver = expenseSummary?.carryOver ?? 0;
  const availableIncome = income + carryOver;
  const spent = expenseSummary?.spent ?? 0;
  const funds = expenseSummary?.funds ?? 0;
  const balance = expenseSummary?.balance ?? 0;
  const totalBudget = ledger.expense.cats.reduce((sum, item) => sum + (item.budget ?? 0), 0);
  const byExpenseCategory = expenseSummary?.byExpenseCategory ?? {};
  const accountExpenses = expenseSummary?.accountExpenses ?? [];
  const byIncomeCategory = expenseSummary?.byIncomeCategory ?? {};
  const overBudget = ledger.expense.cats.filter((item) => (item.budget ?? 0) > 0 && (byExpenseCategory[item.id] ?? 0) >= (item.budget ?? 0));
  const nearingBudget = ledger.expense.cats.filter((item) => {
    const budget = item.budget ?? 0;
    const spent = byExpenseCategory[item.id] ?? 0;
    return budget > 0 && spent / budget >= 0.8 && spent < budget;
  });
  const totalBudgetUsage = totalBudget > 0 ? spent / totalBudget : 0;
  const totalOverBudget = totalBudget > 0 && totalBudgetUsage >= 1;
  const totalNearBudget = totalBudget > 0 && totalBudgetUsage >= 0.8 && totalBudgetUsage < 1;

  const historyTotal = transactionPage?.total ?? 0;
  const historyPageCount = transactionPage?.pageCount ?? 1;
  const currentHistoryPage = transactionPage?.page ?? historyPage;
  const pagedTransactions = transactionPage?.items ?? [];
  const historyStart = historyTotal ? (currentHistoryPage - 1) * HISTORY_PAGE_SIZE + 1 : 0;
  const historyEnd = Math.min(currentHistoryPage * HISTORY_PAGE_SIZE, historyTotal);

  const addTransaction = async (): Promise<void> => {
    if (!(amount > 0) || !date || !selectedCategory) return;
    const transaction = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      date,
      type,
      cat: selectedCategory,
      ...(selectedAccount ? { accountId: selectedAccount } : {}),
      amount,
      note: note.trim(),
    };
    await createTransaction(transaction);
    setAmount(0);
    setNote("");
  };

  const filterCategories = filters.type ? categoriesForType(ledger, filters.type) : [...ledger.expense.cats, ...ledger.expense.incomeCats];
  const hasExpenseData = Boolean(expenseSummary && transactionPage);

  if (!hasExpenseData && (expensesState === "loading" || expensesState === "error")) {
    return <section className="page-view"><ResourceStatus state={expensesState} hasData={false} label="dữ liệu chi tiêu" onRetry={() => void loadExpenses()} /></section>;
  }

  return (
    <section className="page-view">
      <ResourceStatus state={expensesState} hasData={hasExpenseData} label="dữ liệu chi tiêu" onRetry={() => void loadExpenses()} />
      <div className="toolbar">
        <button className="btn sm" type="button" onClick={() => setManaging(true)}>⚙ Quản lý danh mục</button>
        <button className="btn sm" type="button" onClick={() => setManagingAccounts(true)}>◫ Quản lý tài khoản</button>
      </div>

      <div className="stat-row stat-row-5">
        <Stat label="Thu nhập" value={fmt(availableIncome)} meta={carryOver ? `gồm số dư chuyển sang ${fmt(carryOver)}` : "tổng các khoản thu"} accent="green" />
        <Stat label="Đã chi" value={fmt(spent)} meta={availableIncome ? `${Math.round(spent / availableIncome * 100)}% thu nhập` : "chưa có thu nhập"} accent="rust" />
        <Stat label="Hạn mức" value={fmt(totalBudget)} meta={totalBudget ? (spent <= totalBudget ? `còn ${fmt(totalBudget - spent)}` : `vượt ${fmt(spent - totalBudget)}`) : "chưa đặt hạn mức"} accent="gold" />
        <Stat label="Trích quỹ" value={fmt(funds)} meta="tổng bỏ vào quỹ tháng này" accent="blue" />
        <Stat label="Số dư" value={fmt(balance)} meta="thu − chi − trích quỹ" accent={balance < 0 ? "rust" : "green"} />
      </div>

      {balance < 0 ? <div className="warn-box"><span>⚠</span><div>Sau khi chi và trích quỹ, bạn <b>âm {fmt(-balance)}</b> trong {MONTHS_FULL[month]}.</div></div> : null}
      {overBudget.length || totalOverBudget ? <div className="warn-box"><span>⚠</span><div><b>Đã chạm hoặc vượt hạn mức.</b>{totalOverBudget ? <span> Tổng ngân sách: {fmt(spent)}/{fmt(totalBudget)}. </span> : null}{overBudget.map((item) => <span key={item.id}> <b>{item.name}</b> ({fmt(byExpenseCategory[item.id] ?? 0)}/{fmt(item.budget ?? 0)})</span>)}</div></div> : null}
      {nearingBudget.length || totalNearBudget ? <div className="warn-box budget-warning"><span>⚠</span><div><b>Sắp chạm hạn mức 80%.</b>{totalNearBudget ? <span> Tổng ngân sách đang dùng {Math.round(totalBudgetUsage * 100)}%. </span> : null}{nearingBudget.map((item) => <span key={item.id}> <b>{item.name}</b> {Math.round((byExpenseCategory[item.id] ?? 0) / (item.budget ?? 1) * 100)}%</span>)}</div></div> : null}
      {balance >= 0 && !overBudget.length && !nearingBudget.length && !totalOverBudget && !totalNearBudget && (transactions.length > 0 || funds > 0) ? <div className="warn-box ok"><span>✓</span><div>Trong tầm kiểm soát, vẫn còn dư <b>{fmt(balance)}</b>.</div></div> : null}

      <article className="card">
        <h2>Thêm khoản thu chi</h2>
        <p className="hint">Ghi nhận theo ngày; dữ liệu sẽ xuất hiện ngay trong lịch sử và biểu đồ.</p>
        <div className="entry-form">
            <div className="ef-row">
              <label>Ngày<DateField value={date} min={minDate} max={maxDate} onChange={setDate} /></label>
              <label>Loại
                <Select<TransactionType>
                  value={type}
                  options={[{ value: "expense", label: "Chi" }, { value: "income", label: "Thu" }]}
                  onValueChange={setType}
                  ariaLabel="Loại giao dịch"
                />
              </label>
            </div>
            <div className="ef-row">
              <label>Danh mục
                <Select<string>
                  value={selectedCategory}
                  options={entryCategories.map((item) => ({ value: item.id, label: item.name }))}
                  onValueChange={setCategory}
                  ariaLabel="Danh mục"
                />
              </label>
              <label>Tài khoản
                <Select<string>
                  value={selectedAccount}
                  options={accountOptions}
                  onValueChange={setAccount}
                  ariaLabel="Tài khoản"
                />
              </label>
            </div>
            <label>Số tiền<MoneyInput value={amount} allowZero={false} onCommit={setAmount} onValueChange={setAmount} placeholder="vd: 150000" /></label>
            <label>Ghi chú<input value={note} placeholder="vd: ăn trưa, đổ xăng…" onChange={(event) => setNote(event.target.value)} /></label>
            <AsyncButton className="btn primary full-width" disabled={!amount || !date || !selectedCategory} busyLabel="Đang thêm…" onAction={addTransaction}>+ Thêm khoản</AsyncButton>
        </div>
      </article>

      <div className="expense-statistics-layout">
        <article className="card">
          <h2>Thống kê theo danh mục — {MONTHS_FULL[month]} / {year}</h2>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Danh mục</th><th>Đã chi</th><th>Trung bình/ngày</th><th>% thu nhập</th><th>Hạn mức</th><th>Còn lại</th><th>Sử dụng</th></tr></thead>
              <tbody>
                {ledger.expense.cats.map((item) => {
                  const value = byExpenseCategory[item.id] ?? 0;
                  const budget = item.budget ?? 0;
                  const rawUsage = budget ? value / budget * 100 : 0;
                  const usage = budget ? Math.min(100, rawUsage) : value ? 100 : 0;
                  const danger = budget > 0 && rawUsage >= 100;
                  const warning = budget > 0 && rawUsage >= 80 && rawUsage < 100;
                  return (
                    <tr key={item.id}>
                      <td><span className="fund-tag" style={{ background: item.color }} />{item.name}</td>
                      <td>{fmt(value)}</td><td>{value ? fmt(value / daysInMonth) : "—"}</td>
                      <td>{availableIncome ? `${(value / availableIncome * 100).toFixed(1)}%` : "0%"}</td>
                      <td>{budget ? fmt(budget) : "—"}</td>
                      <td className={danger ? "negative" : warning ? "warning" : ""}>{budget ? fmt(budget - value) : "—"}</td>
                      <td>{budget ? <>{Math.round(rawUsage)}%<div className="bar"><span style={{ width: `${usage}%`, background: danger ? "var(--rust)" : warning ? "var(--gold)" : item.color }} /></div></> : <span className="goal-cell">chưa đặt</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td>Tổng cộng</td><td>{fmt(spent)}</td><td>{fmt(spent / daysInMonth)}</td><td>{availableIncome ? `${Math.round(spent / availableIncome * 100)}%` : "0%"}</td><td>{fmt(totalBudget)}</td><td>{fmt(totalBudget - spent)}</td><td /></tr></tfoot>
            </table>
          </div>
        </article>

        <aside className="expense-statistics-charts" aria-label="Biểu đồ chi tiêu">
          <div className="expense-statistics-tabs" role="tablist" aria-label="Loại biểu đồ">
            <button className={activeBreakdownTab === "expense" ? "active" : ""} id="expense-statistics-expense-tab" type="button" role="tab" aria-selected={activeBreakdownTab === "expense"} aria-controls="expense-statistics-panel" onClick={() => setActiveBreakdownTab("expense")}>Cơ cấu chi</button>
            <button className={activeBreakdownTab === "income" ? "active" : ""} id="expense-statistics-income-tab" type="button" role="tab" aria-selected={activeBreakdownTab === "income"} aria-controls="expense-statistics-panel" onClick={() => setActiveBreakdownTab("income")}>Cơ cấu thu</button>
            <button className={activeBreakdownTab === "account" ? "active" : ""} id="expense-statistics-account-tab" type="button" role="tab" aria-selected={activeBreakdownTab === "account"} aria-controls="expense-statistics-panel" onClick={() => setActiveBreakdownTab("account")}>Theo tài khoản</button>
          </div>

          <article className="card" id="expense-statistics-panel" role="tabpanel" aria-labelledby={`expense-statistics-${activeBreakdownTab}-tab`}>
            {activeBreakdownTab === "expense" ? <>
              <h2>Cơ cấu chi</h2>
              <p className="hint">{MONTHS_FULL[month]} / {year}</p>
              <CategoryDonut categories={ledger.expense.cats} amounts={byExpenseCategory} empty="Chưa có khoản chi nào trong tháng." />
            </> : null}
            {activeBreakdownTab === "income" ? <>
              <h2>Cơ cấu thu</h2>
              <p className="hint">{MONTHS_FULL[month]} / {year}</p>
              <CategoryDonut categories={ledger.expense.incomeCats} amounts={byIncomeCategory} empty="Chưa có khoản thu nào trong tháng." />
            </> : null}
            {activeBreakdownTab === "account" ? <>
              <h2>Chi tiêu theo tài khoản</h2>
              <p className="hint">{MONTHS_FULL[month]} / {year}</p>
              <AccountExpenseChart entries={accountExpenses} empty="Chưa có khoản chi nào trong tháng." />
            </> : null}
          </article>
        </aside>
      </div>

      <article className="card section-card">
        <h2>Lịch sử thu chi — {MONTHS_FULL[month]} / {year}</h2>
        <div className="history-filter">
          <label>Từ ngày<DateField value={filters.from} min={minDate} max={maxDate} onChange={(value) => setFilters((current) => ({ ...current, from: value }))} /></label>
          <label>Đến ngày<DateField value={filters.to} min={minDate} max={maxDate} onChange={(value) => setFilters((current) => ({ ...current, to: value }))} /></label>
          <label>Loại
            <Select
              value={filters.type}
              options={[{ value: "", label: "Tất cả" }, { value: "expense", label: "Chi" }, { value: "income", label: "Thu" }]}
              onValueChange={(nextType) => setFilters((current) => ({ ...current, type: nextType, category: "" }))}
              ariaLabel="Loại giao dịch trong lịch sử"
            />
          </label>
          <label>Danh mục
            <Select
              value={filters.category}
              options={[{ value: "", label: "Tất cả" }, ...filterCategories.map((item) => ({ value: item.id, label: item.name }))]}
              onValueChange={(category) => setFilters((current) => ({ ...current, category }))}
              ariaLabel="Danh mục trong lịch sử"
            />
          </label>
          <label>Tài khoản
            <Select
              value={filters.account}
              options={accountOptions}
              onValueChange={(account) => setFilters((current) => ({ ...current, account }))}
              ariaLabel="Tài khoản trong lịch sử"
            />
          </label>
          <label>Tìm ghi chú<input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></label>
          <button className="btn sm" type="button" disabled={JSON.stringify(filters) === JSON.stringify(emptyFilters)} onClick={() => setFilters(emptyFilters)}>Xóa lọc</button>
          <p className="history-filter-count">Có {historyTotal} khoản{historyTotal ? ` · ${historyStart}–${historyEnd}` : ""}</p>
        </div>
        <div className="table-scroll">
          <table className="history-table">
            <colgroup>
              <col className="history-date-col" /><col className="history-type-col" /><col className="history-category-col" />
              <col className="history-account-col" /><col className="history-note-col" /><col className="history-amount-col" /><col className="history-actions-col" />
            </colgroup>
            <thead><tr><th>Ngày</th><th>Loại</th><th>Danh mục</th><th>Tài khoản</th><th>Ghi chú</th><th>Số tiền</th><th /></tr></thead>
            <tbody>
              {pagedTransactions.map((transaction) => editingId === transaction.id
                ? <EditTransactionRow key={transaction.id} transaction={transaction} onDone={() => setEditingId(null)} />
                : (
                  <tr key={transaction.id}>
                    <td>{transaction.date.slice(8)}/{transaction.date.slice(5, 7)}</td>
                    <td><span className={`tx-type ${transaction.type}`}>{transaction.type === "income" ? "Thu" : "Chi"}</span></td>
                    <td><span className="fund-tag" style={{ background: categoryForTransaction(ledger, transaction)?.color ?? "#b8ad92" }} />{categoryForTransaction(ledger, transaction)?.name ?? "(đã xóa)"}</td>
                    <td>{transaction.accountId ? accountForTransaction(ledger, transaction)?.name ?? "(đã xóa)" : "Chưa xác định"}</td>
                    <td>{transaction.note}</td>
                    <td className={`amt-${transaction.type}`}>{transaction.type === "income" ? "+" : "−"}{fmt(transaction.amount)}</td>
                    <td><button className="tx-edit" type="button" aria-label="Sửa giao dịch" onClick={() => setEditingId(transaction.id)}>✎</button><AsyncButton className="tx-del" aria-label="Xóa giao dịch" busyLabel="Đang xóa…" onAction={() => deleteTransaction(transaction.id)}>×</AsyncButton></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {historyTotal > HISTORY_PAGE_SIZE ? <nav className="history-pagination" aria-label="Phân trang lịch sử">
          <button className="btn sm" type="button" disabled={currentHistoryPage === 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>← Trước</button>
          <span>Trang {currentHistoryPage}/{historyPageCount}</span>
          <button className="btn sm" type="button" disabled={currentHistoryPage === historyPageCount} onClick={() => setHistoryPage((page) => Math.min(historyPageCount, page + 1))}>Sau →</button>
        </nav> : null}
        {!historyTotal ? <div className="empty-state">{JSON.stringify(filters) !== JSON.stringify(emptyFilters) ? "Không tìm thấy giao dịch phù hợp." : "Chưa có khoản nào trong tháng này."}</div> : null}
      </article>

      {managing ? <CategoryManager onClose={() => setManaging(false)} /> : null}
      {managingAccounts ? <AccountManager onClose={() => setManagingAccounts(false)} /> : null}
    </section>
  );
}

function accountSelectOptions(accounts: Account[]): Array<{ value: string; label: string }> {
  return [{ value: "", label: "Chưa xác định" }, ...accounts.map((item) => ({ value: item.id, label: item.name }))];
}

function Stat({ label, value, meta, accent }: { label: string; value: string; meta: string; accent: "gold" | "green" | "rust" | "blue" }) {
  return <div className={`stat accent-${accent}`}><div className="k">{label}</div><div className="v">{value}</div><div className="m">{meta}</div></div>;
}

function CategoryDonut({ categories, amounts, empty, compact = false }: { categories: FinanceCategory[]; amounts: Record<string, number>; empty: string; compact?: boolean }) {
  const used = categories.filter((item) => (amounts[item.id] ?? 0) > 0);
  const total = used.reduce((sum, item) => sum + (amounts[item.id] ?? 0), 0);
  return (
    <div className={compact ? "compact-donut" : ""}>
      <div className="chart-wrap donut"><DonutChart labels={used.map((item) => item.name)} values={used.map((item) => amounts[item.id] ?? 0)} colors={used.map((item) => item.color)} /></div>
      <div className="legend">
        {!used.length ? <div className="goal-cell">{empty}</div> : used.map((item) => (
          <div className="row" key={item.id}><span className="lbl"><span className="fund-tag" style={{ background: item.color }} />{item.name}</span><span className="pct">{fmt(amounts[item.id] ?? 0)} · {Math.round((amounts[item.id] ?? 0) / total * 100)}%</span></div>
        ))}
      </div>
    </div>
  );
}

function EditTransactionRow({ transaction, onDone }: { transaction: Transaction; onDone(): void }) {
  const ledger = useFinanceStore((state) => state.ledger);
  const updateTransaction = useFinanceStore((state) => state.updateTransaction);
  const [draft, setDraft] = useState(structuredClone(transaction));
  const categories = categoriesForType(ledger, draft.type);
  const accountOptions = accountSelectOptions(ledger.expense.accounts);
  if (draft.accountId && !ledger.expense.accounts.some((item) => item.id === draft.accountId)) {
    accountOptions.push({ value: draft.accountId, label: "(đã xóa)" });
  }

  return (
    <tr className="editing-row">
      <td><DateField value={draft.date} onChange={(date) => setDraft({ ...draft, date })} ariaLabel="Ngày đang sửa" /></td>
      <td>
        <Select
          value={draft.type}
          options={[{ value: "expense", label: "Chi" }, { value: "income", label: "Thu" }]}
          onValueChange={(nextType) => setDraft({ ...draft, type: nextType, cat: categoriesForType(ledger, nextType)[0]?.id ?? "" })}
          ariaLabel="Loại giao dịch đang sửa"
          compact
        />
      </td>
      <td>
        <Select
          value={draft.cat}
          options={categories.map((item) => ({ value: item.id, label: item.name }))}
          onValueChange={(cat) => setDraft({ ...draft, cat })}
          ariaLabel="Danh mục đang sửa"
          compact
        />
      </td>
      <td>
        <Select
          value={draft.accountId ?? ""}
          options={accountOptions}
          onValueChange={(accountId) => {
            const next = structuredClone(draft);
            if (accountId) next.accountId = accountId;
            else delete next.accountId;
            setDraft(next);
          }}
          ariaLabel="Tài khoản đang sửa"
          compact
        />
      </td>
      <td><input aria-label="Ghi chú đang sửa" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></td>
      <td><MoneyInput value={draft.amount} allowZero={false} onCommit={(amount) => setDraft({ ...draft, amount })} onValueChange={(amount) => setDraft((current) => ({ ...current, amount }))} /></td>
      <td><AsyncButton className="tx-save" aria-label="Lưu giao dịch" busyLabel="Đang lưu…" onAction={async () => {
        if (!(draft.amount > 0)) return;
        // Keep the existing optimistic row behaviour: the editor closes as
        // soon as the update enters the write queue, while the button guards
        // the request that initiated it against a second click.
        const operation = updateTransaction(draft);
        onDone();
        await operation;
      }}>✓</AsyncButton><button className="tx-cancel" type="button" aria-label="Hủy chỉnh sửa" onClick={onDone}>×</button></td>
    </tr>
  );
}

function CategoryManager({ onClose }: { onClose(): void }) {
  const ledger = useFinanceStore((state) => state.ledger);
  const updateLedger = useFinanceStore((state) => state.updateLedger);
  const mutateExpenseConfig = useFinanceStore((state) => state.mutateExpenseConfig);
  const [tab, setTab] = useState<TransactionType>("expense");
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]!);
  const categories = categoriesForType(ledger, tab);

  const add = async (): Promise<void> => {
    if (!name.trim()) return;
    await mutateExpenseConfig((draft) => {
      const target = tab === "income" ? draft.expense.incomeCats : draft.expense.cats;
      let id = slugId(name);
      let suffix = 2;
      while (target.some((item) => item.id === id)) id = `${slugId(name)}-${suffix++}`;
      target.push({ id, name: name.trim(), color, ...(tab === "expense" ? { budget: 0 } : {}) });
    }, (expectedRevision) => api.createCategory({ type: tab, name: name.trim(), color, ...(tab === "expense" ? { budget: 0 } : {}) }, expectedRevision));
    setName("");
  };

  const move = (index: number, direction: number): void => {
    const next = index + direction;
    if (next < 0 || next >= categories.length) return;
    const ids = categories.map((item) => item.id);
    [ids[index], ids[next]] = [ids[next]!, ids[index]!];
    mutateExpenseConfig((draft) => {
      const target = tab === "income" ? draft.expense.incomeCats : draft.expense.cats;
      const [item] = target.splice(index, 1);
      if (item) target.splice(next, 0, item);
    }, (expectedRevision) => api.reorderCategories(tab, ids, expectedRevision));
  };

  return (
    <Modal title="Quản lý danh mục" onClose={onClose} wide footer={<button className="btn" type="button" onClick={onClose}>Đóng</button>}>
      <div className="manager-tabs">
        <button className={tab === "expense" ? "active" : ""} type="button" onClick={() => setTab("expense")}>Danh mục chi</button>
        <button className={tab === "income" ? "active" : ""} type="button" onClick={() => setTab("income")}>Danh mục thu</button>
      </div>
      <div className="manager-list">
        {categories.map((item, index) => (
          <div className="manager-row category-row" key={item.id}>
            <div className="reorder-actions"><button type="button" disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === categories.length - 1} onClick={() => move(index, 1)}>↓</button></div>
            <input type="color" value={item.color} aria-label={`Màu ${item.name}`} onChange={(event) => {
              const nextColor = event.target.value;
              mutateExpenseConfig((draft) => {
                const target = tab === "income" ? draft.expense.incomeCats : draft.expense.cats;
                target[index]!.color = nextColor;
              }, (expectedRevision) => api.updateCategory(tab, item.id, { color: nextColor }, expectedRevision), { notifySuccess: false });
            }} />
            <input value={item.name} onChange={(event) => updateLedger((draft) => {
              const target = tab === "income" ? draft.expense.incomeCats : draft.expense.cats;
              target[index]!.name = event.target.value;
            })} onBlur={(event) => {
              const nextName = event.currentTarget.value.trim();
              if (nextName) mutateExpenseConfig(() => undefined, (expectedRevision) => api.updateCategory(tab, item.id, { name: nextName }, expectedRevision), { notifySuccess: false });
            }} />
            {tab === "expense" ? <MoneyInput value={item.budget ?? 0} onCommit={(budget) => mutateExpenseConfig((draft) => {
              draft.expense.cats[index]!.budget = budget;
              draft.financialProfile.monthlyBudgets[item.id] = budget;
            }, (expectedRevision) => api.updateCategory(tab, item.id, { budget }, expectedRevision), { notifySuccess: false })} /> : <span />}
            <AsyncButton className="btn sm danger" disabled={categories.length <= 1} busyLabel="Đang xóa…" onAction={() => mutateExpenseConfig((draft) => {
              const target = tab === "income" ? draft.expense.incomeCats : draft.expense.cats;
              target.splice(index, 1);
            }, (expectedRevision) => api.deleteCategory(tab, item.id, expectedRevision))}>Xóa</AsyncButton>
          </div>
        ))}
      </div>
      <div className="manager-add">
        <input type="color" value={color} aria-label="Màu danh mục mới" onChange={(event) => setColor(event.target.value)} />
        <input value={name} placeholder="Tên danh mục mới" onChange={(event) => setName(event.target.value)} />
        <AsyncButton className="btn primary" busyLabel="Đang thêm…" onAction={add}>+ Thêm</AsyncButton>
      </div>
    </Modal>
  );
}

function AccountManager({ onClose }: { onClose(): void }) {
  const ledger = useFinanceStore((state) => state.ledger);
  const updateLedger = useFinanceStore((state) => state.updateLedger);
  const mutateExpenseConfig = useFinanceStore((state) => state.mutateExpenseConfig);
  const [tab, setTab] = useState<"accounts" | "types">("accounts");
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState(ledger.expense.accountTypes[0]?.id ?? "");
  const isAccounts = tab === "accounts";
  const typeOptions = [{ value: "", label: "Không phân loại" }, ...ledger.expense.accountTypes.map((item) => ({ value: item.id, label: item.name }))];
  const selectedTypeId = typeOptions.some((option) => option.value === typeId) ? typeId : "";

  const uniqueId = (label: string, ids: string[]): string => {
    const base = slugId(label);
    let id = base;
    let suffix = 2;
    while (ids.includes(id)) id = `${base}-${suffix++}`;
    return id;
  };

  const add = async (): Promise<void> => {
    if (!name.trim()) return;
    await mutateExpenseConfig((draft) => {
      if (isAccounts) {
        draft.expense.accounts.push({
          id: uniqueId(name, draft.expense.accounts.map((item) => item.id)),
          name: name.trim(),
          ...(selectedTypeId ? { typeId: selectedTypeId } : {}),
        });
      } else {
        draft.expense.accountTypes.push({
          id: uniqueId(name, draft.expense.accountTypes.map((item) => item.id)),
          name: name.trim(),
        });
      }
    }, (expectedRevision) => isAccounts
      ? api.createAccount({ name: name.trim(), ...(selectedTypeId ? { typeId: selectedTypeId } : {}) }, expectedRevision)
      : api.createAccountType(name.trim(), expectedRevision));
    setName("");
  };

  const move = (index: number, direction: number): void => {
    const target = isAccounts ? ledger.expense.accounts : ledger.expense.accountTypes;
    const next = index + direction;
    if (next < 0 || next >= target.length) return;
    const ids = target.map((item) => item.id);
    [ids[index], ids[next]] = [ids[next]!, ids[index]!];
    mutateExpenseConfig((draft) => {
      const collection = isAccounts ? draft.expense.accounts : draft.expense.accountTypes;
      const [item] = collection.splice(index, 1);
      if (item) collection.splice(next, 0, item);
    }, (expectedRevision) => isAccounts
      ? api.reorderAccounts(ids, expectedRevision)
      : api.reorderAccountTypes(ids, expectedRevision));
  };

  return (
    <Modal title="Quản lý tài khoản" onClose={onClose} wide footer={<button className="btn" type="button" onClick={onClose}>Đóng</button>}>
      <div className="manager-tabs">
        <button className={isAccounts ? "active" : ""} type="button" onClick={() => setTab("accounts")}>Tài khoản</button>
        <button className={!isAccounts ? "active" : ""} type="button" onClick={() => setTab("types")}>Loại tài khoản</button>
      </div>
      <div className="manager-list">
        {isAccounts ? ledger.expense.accounts.map((account, index) => (
          <div className="manager-row account-row" key={account.id}>
            <div className="reorder-actions"><button type="button" aria-label={`Đưa ${account.name} lên`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`Đưa ${account.name} xuống`} disabled={index === ledger.expense.accounts.length - 1} onClick={() => move(index, 1)}>↓</button></div>
            <span className="account-manager-icon" aria-hidden="true">◫</span>
            <input aria-label={`Tên ${account.name}`} value={account.name} onChange={(event) => updateLedger((draft) => {
              draft.expense.accounts[index]!.name = event.target.value;
            })} onBlur={(event) => {
              const nextName = event.currentTarget.value.trim();
              if (nextName) mutateExpenseConfig(() => undefined, (expectedRevision) => api.updateAccount(account.id, { name: nextName }, expectedRevision), { notifySuccess: false });
            }} />
            <Select
              value={account.typeId ?? ""}
              options={typeOptions}
              onValueChange={(nextTypeId) => mutateExpenseConfig((draft) => {
                const target = draft.expense.accounts[index]!;
                if (nextTypeId) target.typeId = nextTypeId;
                else delete target.typeId;
              }, (expectedRevision) => api.updateAccount(account.id, { typeId: nextTypeId || null }, expectedRevision), { notifySuccess: false })}
              ariaLabel={`Loại ${account.name}`}
              compact
            />
            <AsyncButton className="btn sm danger" busyLabel="Đang xóa…" onAction={() => mutateExpenseConfig((draft) => {
              draft.expense.accounts.splice(index, 1);
            }, (expectedRevision) => api.deleteAccount(account.id, expectedRevision))}>Xóa</AsyncButton>
          </div>
        )) : ledger.expense.accountTypes.map((type, index) => (
          <div className="manager-row account-type-row" key={type.id}>
            <div className="reorder-actions"><button type="button" aria-label={`Đưa ${type.name} lên`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`Đưa ${type.name} xuống`} disabled={index === ledger.expense.accountTypes.length - 1} onClick={() => move(index, 1)}>↓</button></div>
            <span className="account-manager-icon" aria-hidden="true">▤</span>
            <input aria-label={`Tên loại ${type.name}`} value={type.name} onChange={(event) => updateLedger((draft) => {
              draft.expense.accountTypes[index]!.name = event.target.value;
            })} onBlur={(event) => {
              const nextName = event.currentTarget.value.trim();
              if (nextName) mutateExpenseConfig(() => undefined, (expectedRevision) => api.updateAccountType(type.id, nextName, expectedRevision), { notifySuccess: false });
            }} />
            <span />
            <AsyncButton className="btn sm danger" busyLabel="Đang xóa…" onAction={() => mutateExpenseConfig((draft) => {
              draft.expense.accountTypes.splice(index, 1);
              for (const account of draft.expense.accounts) if (account.typeId === type.id) delete account.typeId;
            }, (expectedRevision) => api.deleteAccountType(type.id, expectedRevision))}>Xóa</AsyncButton>
          </div>
        ))}
      </div>
      <div className="manager-add">
        <input value={name} placeholder={isAccounts ? "Tên tài khoản mới" : "Tên loại tài khoản mới"} onChange={(event) => setName(event.target.value)} />
        {isAccounts ? <Select<string> value={selectedTypeId} options={typeOptions} onValueChange={setTypeId} ariaLabel="Loại tài khoản mới" compact /> : null}
        <AsyncButton className="btn primary" busyLabel="Đang thêm…" onAction={add}>+ Thêm</AsyncButton>
      </div>
    </Modal>
  );
}
