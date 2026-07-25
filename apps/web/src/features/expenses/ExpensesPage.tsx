import { useEffect, useState } from "react";
import type { Account, FinanceCategory, Transaction, TransactionType } from "@chi-tieu/shared";
import { AccountExpenseChart } from "@/components/AccountExpenseChart";
import { DonutChart } from "@/components/Charts";
import { DateField } from "@/components/DateField";
import { Modal } from "@/components/Modal";
import { MoneyInput } from "@/components/MoneyInput";
import { Select } from "@/components/Select";
import {
  categoriesForType,
  accountForTransaction,
  countsInPersonalReports,
  expenseByAccount,
  categoryForTransaction,
  fmt,
  monthKey,
  monthTransactions,
  MONTHS_FULL,
  PALETTE,
  slugId,
  totalFundsForMonth,
  totalIncomeForMonth,
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

export function ExpensesPage() {
  const ledger = useFinanceStore((state) => state.ledger);
  const year = useFinanceStore((state) => state.selectedYear);
  const month = useFinanceStore((state) => state.selectedMonth);
  const updateLedger = useFinanceStore((state) => state.updateLedger);
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

  const entryCategories = categoriesForType(ledger, type);
  const selectedCategory = entryCategories.some((item) => item.id === category)
    ? category
    : entryCategories[0]?.id ?? "";
  const selectedAccount = ledger.expense.accounts.some((item) => item.id === account) ? account : "";
  const accountOptions = accountSelectOptions(ledger.expense.accounts);

  const transactions = monthTransactions(ledger, year, month);
  const income = totalIncomeForMonth(ledger, year, month);
  const expenseTransactions = transactions.filter((transaction) => transaction.type === "expense");
  const spent = expenseTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const funds = totalFundsForMonth(ledger, year, month, countsInPersonalReports);
  const balance = income - spent - funds;
  const totalBudget = ledger.expense.cats.reduce((sum, item) => sum + (item.budget ?? 0), 0);
  const byExpenseCategory = groupByCategory(expenseTransactions);
  const accountExpenses = expenseByAccount(ledger, expenseTransactions);
  const incomeTransactions = transactions.filter((transaction) => transaction.type === "income");
  const byIncomeCategory = groupByCategory(incomeTransactions);
  const overBudget = ledger.expense.cats.filter((item) => (item.budget ?? 0) > 0 && (byExpenseCategory[item.id] ?? 0) > (item.budget ?? 0));

  const filtered = transactions.filter((transaction) => {
    if (filters.from && transaction.date < filters.from) return false;
    if (filters.to && transaction.date > filters.to) return false;
    if (filters.type && transaction.type !== filters.type) return false;
    if (filters.category && transaction.cat !== filters.category) return false;
    if (filters.account && transaction.accountId !== filters.account) return false;
    if (filters.search && !transaction.note.toLocaleLowerCase("vi").includes(filters.search.toLocaleLowerCase("vi"))) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const historyPageCount = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  const currentHistoryPage = Math.min(historyPage, historyPageCount);
  const pagedTransactions = filtered.slice((currentHistoryPage - 1) * HISTORY_PAGE_SIZE, currentHistoryPage * HISTORY_PAGE_SIZE);
  const historyStart = filtered.length ? (currentHistoryPage - 1) * HISTORY_PAGE_SIZE + 1 : 0;
  const historyEnd = Math.min(currentHistoryPage * HISTORY_PAGE_SIZE, filtered.length);

  const addTransaction = (): void => {
    if (!(amount > 0) || !date || !selectedCategory) return;
    updateLedger((draft) => {
      draft.expense.txns.push({
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        date,
        type,
        cat: selectedCategory,
        ...(selectedAccount ? { accountId: selectedAccount } : {}),
        amount,
        note: note.trim(),
      });
    });
    setAmount(0);
    setNote("");
  };

  const filterCategories = filters.type ? categoriesForType(ledger, filters.type) : [...ledger.expense.cats, ...ledger.expense.incomeCats];

  return (
    <section className="page-view">
      <div className="toolbar">
        <button className="btn sm" type="button" onClick={() => setManaging(true)}>⚙ Quản lý danh mục</button>
        <button className="btn sm" type="button" onClick={() => setManagingAccounts(true)}>◫ Quản lý tài khoản</button>
      </div>

      <div className="stat-row stat-row-5">
        <Stat label="Thu nhập" value={fmt(income)} meta="tổng các khoản thu" accent="green" />
        <Stat label="Đã chi" value={fmt(spent)} meta={income ? `${Math.round(spent / income * 100)}% thu nhập` : "chưa có thu nhập"} accent="rust" />
        <Stat label="Hạn mức" value={fmt(totalBudget)} meta={totalBudget ? (spent <= totalBudget ? `còn ${fmt(totalBudget - spent)}` : `vượt ${fmt(spent - totalBudget)}`) : "chưa đặt hạn mức"} accent="gold" />
        <Stat label="Trích quỹ" value={fmt(funds)} meta="tổng bỏ vào quỹ tháng này" accent="blue" />
        <Stat label="Số dư" value={fmt(balance)} meta="thu − chi − trích quỹ" accent={balance < 0 ? "rust" : "green"} />
      </div>

      {balance < 0 ? <div className="warn-box"><span>⚠</span><div>Sau khi chi và trích quỹ, bạn <b>âm {fmt(-balance)}</b> trong {MONTHS_FULL[month]}.</div></div> : null}
      {overBudget.length ? <div className="warn-box"><span>⚠</span><div>Vượt hạn mức: {overBudget.map((item) => <span key={item.id}><b>{item.name}</b> ({fmt(byExpenseCategory[item.id] ?? 0)}/{fmt(item.budget ?? 0)}) </span>)}</div></div> : null}
      {balance >= 0 && !overBudget.length && (transactions.length > 0 || funds > 0) ? <div className="warn-box ok"><span>✓</span><div>Trong tầm kiểm soát, vẫn còn dư <b>{fmt(balance)}</b>.</div></div> : null}

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
            <label>Số tiền<MoneyInput value={amount} allowZero={false} onCommit={setAmount} placeholder="vd: 150000" /></label>
            <label>Ghi chú<input value={note} placeholder="vd: ăn trưa, đổ xăng…" onChange={(event) => setNote(event.target.value)} /></label>
            <button className="btn primary full-width" type="button" disabled={!amount || !date || !selectedCategory} onClick={addTransaction}>+ Thêm khoản</button>
        </div>
      </article>

      <div className="expense-chart-grid">
        <article className="card">
          <h2>Cơ cấu chi</h2>
          <p className="hint">{MONTHS_FULL[month]} / {year}</p>
          <CategoryDonut categories={ledger.expense.cats} amounts={byExpenseCategory} empty="Chưa có khoản chi nào trong tháng." />
        </article>

        <article className="card">
          <h2>Cơ cấu thu</h2>
          <p className="hint">{MONTHS_FULL[month]} / {year}</p>
          <CategoryDonut categories={ledger.expense.incomeCats} amounts={byIncomeCategory} empty="Chưa có khoản thu nào trong tháng." />
        </article>

        <article className="card">
          <h2>Chi tiêu theo tài khoản</h2>
          <p className="hint">{MONTHS_FULL[month]} / {year}</p>
          <AccountExpenseChart entries={accountExpenses} empty="Chưa có khoản chi nào trong tháng." />
        </article>
      </div>

      <article className="card section-card">
        <h2>Thống kê theo danh mục — {MONTHS_FULL[month]} / {year}</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Danh mục</th><th>Đã chi</th><th>Trung bình/ngày</th><th>% thu nhập</th><th>Hạn mức</th><th>Còn lại</th><th>Sử dụng</th></tr></thead>
            <tbody>
              {ledger.expense.cats.map((item) => {
                const value = byExpenseCategory[item.id] ?? 0;
                const budget = item.budget ?? 0;
                const usage = budget ? Math.min(100, value / budget * 100) : value ? 100 : 0;
                return (
                  <tr key={item.id}>
                    <td><span className="fund-tag" style={{ background: item.color }} />{item.name}</td>
                    <td>{fmt(value)}</td><td>{value ? fmt(value / daysInMonth) : "—"}</td>
                    <td>{income ? `${(value / income * 100).toFixed(1)}%` : "0%"}</td>
                    <td>{budget ? fmt(budget) : "—"}</td>
                    <td className={budget && value > budget ? "negative" : ""}>{budget ? fmt(budget - value) : "—"}</td>
                    <td>{budget ? <>{Math.round(value / budget * 100)}%<div className="bar"><span style={{ width: `${usage}%`, background: value > budget ? "var(--rust)" : item.color }} /></div></> : <span className="goal-cell">chưa đặt</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td>Tổng cộng</td><td>{fmt(spent)}</td><td>{fmt(spent / daysInMonth)}</td><td>{income ? `${Math.round(spent / income * 100)}%` : "0%"}</td><td>{fmt(totalBudget)}</td><td>{fmt(totalBudget - spent)}</td><td /></tr></tfoot>
          </table>
        </div>
      </article>

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
          <p className="history-filter-count">Hiển thị {filtered.length}/{transactions.length} khoản{filtered.length ? ` · ${historyStart}–${historyEnd}` : ""}</p>
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
                    <td><button className="tx-edit" type="button" aria-label="Sửa giao dịch" onClick={() => setEditingId(transaction.id)}>✎</button><button className="tx-del" type="button" aria-label="Xóa giao dịch" onClick={() => updateLedger((draft) => { draft.expense.txns = draft.expense.txns.filter((item) => item.id !== transaction.id); })}>×</button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {filtered.length > HISTORY_PAGE_SIZE ? <nav className="history-pagination" aria-label="Phân trang lịch sử">
          <button className="btn sm" type="button" disabled={currentHistoryPage === 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>← Trước</button>
          <span>Trang {currentHistoryPage}/{historyPageCount}</span>
          <button className="btn sm" type="button" disabled={currentHistoryPage === historyPageCount} onClick={() => setHistoryPage((page) => Math.min(historyPageCount, page + 1))}>Sau →</button>
        </nav> : null}
        {!filtered.length ? <div className="empty-state">{transactions.length ? "Không tìm thấy giao dịch phù hợp." : "Chưa có khoản nào trong tháng này."}</div> : null}
      </article>

      {managing ? <CategoryManager onClose={() => setManaging(false)} /> : null}
      {managingAccounts ? <AccountManager onClose={() => setManagingAccounts(false)} /> : null}
    </section>
  );
}

function accountSelectOptions(accounts: Account[]): Array<{ value: string; label: string }> {
  return [{ value: "", label: "Chưa xác định" }, ...accounts.map((item) => ({ value: item.id, label: item.name }))];
}

function groupByCategory(transactions: Transaction[]): Record<string, number> {
  return transactions.reduce<Record<string, number>>((result, transaction) => {
    result[transaction.cat] = (result[transaction.cat] ?? 0) + transaction.amount;
    return result;
  }, {});
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
  const updateLedger = useFinanceStore((state) => state.updateLedger);
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
      <td><MoneyInput value={draft.amount} allowZero={false} onCommit={(amount) => setDraft({ ...draft, amount })} /></td>
      <td><button className="tx-save" type="button" aria-label="Lưu giao dịch" onClick={() => {
        if (!(draft.amount > 0)) return;
        updateLedger((store) => {
          const index = store.expense.txns.findIndex((item) => item.id === transaction.id);
          if (index >= 0) store.expense.txns[index] = draft;
        });
        onDone();
      }}>✓</button><button className="tx-cancel" type="button" aria-label="Hủy chỉnh sửa" onClick={onDone}>×</button></td>
    </tr>
  );
}

function CategoryManager({ onClose }: { onClose(): void }) {
  const ledger = useFinanceStore((state) => state.ledger);
  const updateLedger = useFinanceStore((state) => state.updateLedger);
  const [tab, setTab] = useState<TransactionType>("expense");
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]!);
  const categories = categoriesForType(ledger, tab);

  const add = (): void => {
    if (!name.trim()) return;
    updateLedger((draft) => {
      const target = tab === "income" ? draft.expense.incomeCats : draft.expense.cats;
      let id = slugId(name);
      let suffix = 2;
      while (target.some((item) => item.id === id)) id = `${slugId(name)}-${suffix++}`;
      target.push({ id, name: name.trim(), color, ...(tab === "expense" ? { budget: 0 } : {}) });
    });
    setName("");
  };

  const move = (index: number, direction: number): void => {
    const next = index + direction;
    if (next < 0 || next >= categories.length) return;
    updateLedger((draft) => {
      const target = tab === "income" ? draft.expense.incomeCats : draft.expense.cats;
      const [item] = target.splice(index, 1);
      if (item) target.splice(next, 0, item);
    });
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
            <input type="color" value={item.color} aria-label={`Màu ${item.name}`} onChange={(event) => updateLedger((draft) => {
              const target = tab === "income" ? draft.expense.incomeCats : draft.expense.cats;
              target[index]!.color = event.target.value;
            })} />
            <input value={item.name} onChange={(event) => updateLedger((draft) => {
              const target = tab === "income" ? draft.expense.incomeCats : draft.expense.cats;
              target[index]!.name = event.target.value;
            }, false)} onBlur={() => updateLedger(() => undefined)} />
            {tab === "expense" ? <MoneyInput value={item.budget ?? 0} onCommit={(budget) => updateLedger((draft) => {
              draft.expense.cats[index]!.budget = budget;
              draft.financialProfile.monthlyBudgets[item.id] = budget;
            })} /> : <span />}
            <button className="btn sm danger" type="button" disabled={categories.length <= 1} onClick={() => updateLedger((draft) => {
              const target = tab === "income" ? draft.expense.incomeCats : draft.expense.cats;
              target.splice(index, 1);
            })}>Xóa</button>
          </div>
        ))}
      </div>
      <div className="manager-add">
        <input type="color" value={color} aria-label="Màu danh mục mới" onChange={(event) => setColor(event.target.value)} />
        <input value={name} placeholder="Tên danh mục mới" onChange={(event) => setName(event.target.value)} />
        <button className="btn primary" type="button" onClick={add}>+ Thêm</button>
      </div>
    </Modal>
  );
}

function AccountManager({ onClose }: { onClose(): void }) {
  const ledger = useFinanceStore((state) => state.ledger);
  const updateLedger = useFinanceStore((state) => state.updateLedger);
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

  const add = (): void => {
    if (!name.trim()) return;
    updateLedger((draft) => {
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
    });
    setName("");
  };

  const move = (index: number, direction: number): void => {
    const target = isAccounts ? ledger.expense.accounts : ledger.expense.accountTypes;
    const next = index + direction;
    if (next < 0 || next >= target.length) return;
    updateLedger((draft) => {
      const collection = isAccounts ? draft.expense.accounts : draft.expense.accountTypes;
      const [item] = collection.splice(index, 1);
      if (item) collection.splice(next, 0, item);
    });
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
            }, false)} onBlur={() => updateLedger(() => undefined)} />
            <Select
              value={account.typeId ?? ""}
              options={typeOptions}
              onValueChange={(nextTypeId) => updateLedger((draft) => {
                const target = draft.expense.accounts[index]!;
                if (nextTypeId) target.typeId = nextTypeId;
                else delete target.typeId;
              })}
              ariaLabel={`Loại ${account.name}`}
              compact
            />
            <button className="btn sm danger" type="button" onClick={() => updateLedger((draft) => {
              draft.expense.accounts.splice(index, 1);
            })}>Xóa</button>
          </div>
        )) : ledger.expense.accountTypes.map((type, index) => (
          <div className="manager-row account-type-row" key={type.id}>
            <div className="reorder-actions"><button type="button" aria-label={`Đưa ${type.name} lên`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`Đưa ${type.name} xuống`} disabled={index === ledger.expense.accountTypes.length - 1} onClick={() => move(index, 1)}>↓</button></div>
            <span className="account-manager-icon" aria-hidden="true">▤</span>
            <input aria-label={`Tên loại ${type.name}`} value={type.name} onChange={(event) => updateLedger((draft) => {
              draft.expense.accountTypes[index]!.name = event.target.value;
            }, false)} onBlur={() => updateLedger(() => undefined)} />
            <span />
            <button className="btn sm danger" type="button" onClick={() => updateLedger((draft) => {
              draft.expense.accountTypes.splice(index, 1);
              for (const account of draft.expense.accounts) if (account.typeId === type.id) delete account.typeId;
            })}>Xóa</button>
          </div>
        ))}
      </div>
      <div className="manager-add">
        <input value={name} placeholder={isAccounts ? "Tên tài khoản mới" : "Tên loại tài khoản mới"} onChange={(event) => setName(event.target.value)} />
        {isAccounts ? <Select<string> value={selectedTypeId} options={typeOptions} onValueChange={setTypeId} ariaLabel="Loại tài khoản mới" compact /> : null}
        <button className="btn primary" type="button" onClick={add}>+ Thêm</button>
      </div>
    </Modal>
  );
}
