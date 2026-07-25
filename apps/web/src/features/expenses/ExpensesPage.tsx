import { useEffect, useState } from "react";
import type { FinanceCategory, Transaction, TransactionType } from "@chi-tieu/shared";
import { DonutChart } from "@/components/Charts";
import { DateField } from "@/components/DateField";
import { Modal } from "@/components/Modal";
import { MoneyInput } from "@/components/MoneyInput";
import { Select } from "@/components/Select";
import {
  categoriesForType,
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
  search: string;
}

const emptyFilters: HistoryFilters = { from: "", to: "", type: "", category: "", search: "" };

export function ExpensesPage() {
  const ledger = useFinanceStore((state) => state.ledger);
  const year = useFinanceStore((state) => state.selectedYear);
  const month = useFinanceStore((state) => state.selectedMonth);
  const updateLedger = useFinanceStore((state) => state.updateLedger);
  const [managing, setManaging] = useState(false);
  const [type, setType] = useState<TransactionType>("expense");
  const [category, setCategory] = useState(ledger.expense.cats[0]?.id ?? "");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [filters, setFilters] = useState<HistoryFilters>(emptyFilters);
  const [editingId, setEditingId] = useState<string | null>(null);

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

  const entryCategories = categoriesForType(ledger, type);
  const selectedCategory = entryCategories.some((item) => item.id === category)
    ? category
    : entryCategories[0]?.id ?? "";

  const transactions = monthTransactions(ledger, year, month);
  const income = totalIncomeForMonth(ledger, year, month);
  const expenseTransactions = transactions.filter((transaction) => transaction.type === "expense");
  const spent = expenseTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const funds = totalFundsForMonth(ledger, year, month);
  const balance = income - spent - funds;
  const totalBudget = ledger.expense.cats.reduce((sum, item) => sum + (item.budget ?? 0), 0);
  const byExpenseCategory = groupByCategory(expenseTransactions);
  const incomeTransactions = transactions.filter((transaction) => transaction.type === "income");
  const byIncomeCategory = groupByCategory(incomeTransactions);
  const overBudget = ledger.expense.cats.filter((item) => (item.budget ?? 0) > 0 && (byExpenseCategory[item.id] ?? 0) > (item.budget ?? 0));

  const filtered = transactions.filter((transaction) => {
    if (filters.from && transaction.date < filters.from) return false;
    if (filters.to && transaction.date > filters.to) return false;
    if (filters.type && transaction.type !== filters.type) return false;
    if (filters.category && transaction.cat !== filters.category) return false;
    if (filters.search && !transaction.note.toLocaleLowerCase("vi").includes(filters.search.toLocaleLowerCase("vi"))) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  const addTransaction = (): void => {
    if (!(amount > 0) || !date || !selectedCategory) return;
    updateLedger((draft) => {
      draft.expense.txns.push({
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        date,
        type,
        cat: selectedCategory,
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

      <div className="grid expense-grid">
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
              <label>Số tiền<MoneyInput value={amount} allowZero={false} onCommit={setAmount} placeholder="vd: 150000" /></label>
            </div>
            <label>Ghi chú<input value={note} placeholder="vd: ăn trưa, đổ xăng…" onChange={(event) => setNote(event.target.value)} /></label>
            <button className="btn primary full-width" type="button" disabled={!amount || !date || !selectedCategory} onClick={addTransaction}>+ Thêm khoản</button>
          </div>
        </article>

        <article className="card">
          <h2>Cơ cấu chi</h2>
          <p className="hint">{MONTHS_FULL[month]} / {year}</p>
          <CategoryDonut categories={ledger.expense.cats} amounts={byExpenseCategory} empty="Chưa có khoản chi nào trong tháng." />
        </article>
      </div>

      <article className="card section-card">
        <h2>Cơ cấu thu</h2>
        <CategoryDonut categories={ledger.expense.incomeCats} amounts={byIncomeCategory} empty="Chưa có khoản thu nào trong tháng." compact />
      </article>

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
          <label>Tìm ghi chú<input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></label>
          <button className="btn sm" type="button" disabled={JSON.stringify(filters) === JSON.stringify(emptyFilters)} onClick={() => setFilters(emptyFilters)}>Xóa lọc</button>
          <p className="history-filter-count">Hiển thị {filtered.length}/{transactions.length} khoản</p>
        </div>
        <div className="table-scroll">
          <table className="history-table">
            <thead><tr><th>Ngày</th><th>Loại</th><th>Danh mục</th><th>Ghi chú</th><th>Số tiền</th><th /></tr></thead>
            <tbody>
              {filtered.map((transaction) => editingId === transaction.id
                ? <EditTransactionRow key={transaction.id} transaction={transaction} onDone={() => setEditingId(null)} />
                : (
                  <tr key={transaction.id}>
                    <td>{transaction.date.slice(8)}/{transaction.date.slice(5, 7)}</td>
                    <td><span className={`tx-type ${transaction.type}`}>{transaction.type === "income" ? "Thu" : "Chi"}</span></td>
                    <td><span className="fund-tag" style={{ background: categoryForTransaction(ledger, transaction)?.color ?? "#b8ad92" }} />{categoryForTransaction(ledger, transaction)?.name ?? "(đã xóa)"}</td>
                    <td>{transaction.note}</td>
                    <td className={`amt-${transaction.type}`}>{transaction.type === "income" ? "+" : "−"}{fmt(transaction.amount)}</td>
                    <td><button className="tx-edit" type="button" aria-label="Sửa giao dịch" onClick={() => setEditingId(transaction.id)}>✎</button><button className="tx-del" type="button" aria-label="Xóa giao dịch" onClick={() => updateLedger((draft) => { draft.expense.txns = draft.expense.txns.filter((item) => item.id !== transaction.id); })}>×</button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!filtered.length ? <div className="empty-state">{transactions.length ? "Không tìm thấy giao dịch phù hợp." : "Chưa có khoản nào trong tháng này."}</div> : null}
      </article>

      {managing ? <CategoryManager onClose={() => setManaging(false)} /> : null}
    </section>
  );
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

  return (
    <tr className="editing-row">
      <td><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></td>
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
      <td><input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></td>
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
