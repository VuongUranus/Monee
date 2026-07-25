import type { FinanceCategory, TransactionType } from "@chi-tieu/shared";
import { DonutChart, FinanceBarChart } from "@/components/Charts";
import { Select } from "@/components/Select";
import {
  fmt,
  MONTHS,
  MONTHS_FULL,
  totalFundsForMonth,
  totalIncomeForMonth,
  transactionMonthKey,
  yearToDateFund,
  years,
} from "@/lib/domain";
import { useFinanceStore } from "@/store/finance-store";

interface StatisticsRow {
  year: number;
  month: number;
  income: number;
  spent: number;
  funds: number;
  balance: number;
  byFund: Record<string, number>;
}

export function StatisticsPage() {
  const ledger = useFinanceStore((state) => state.ledger);
  const scope = useFinanceStore((state) => state.statisticsScope);
  const setScope = useFinanceStore((state) => state.setStatisticsScope);
  const availableYears = years(ledger).slice().sort((a, b) => b - a);
  const scopeYears = scope === "all" ? years(ledger) : [scope];
  const allYears = scope === "all";
  const scopeLabel = allYears ? "Toàn bộ các năm" : `Năm ${scope}`;
  const rows: StatisticsRow[] = [];

  for (const year of scopeYears) {
    for (let month = 0; month < 12; month += 1) {
      const income = totalIncomeForMonth(ledger, year, month);
      const spent = ledger.expense.txns
        .filter((transaction) => transaction.type === "expense" && transactionMonthKey(transaction) === `${year}-${String(month + 1).padStart(2, "0")}`)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const funds = totalFundsForMonth(ledger, year, month);
      rows.push({
        year,
        month,
        income,
        spent,
        funds,
        balance: income - spent - funds,
        byFund: Object.fromEntries(ledger.funds.map((fund) => [fund.id, ledger.years[String(year)]?.funds[fund.id]?.[month] ?? 0])),
      });
    }
  }

  const totals = rows.reduce((result, row) => ({
    income: result.income + row.income,
    spent: result.spent + row.spent,
    funds: result.funds + row.funds,
    balance: result.balance + row.balance,
  }), { income: 0, spent: 0, funds: 0, balance: 0 });
  const expenseBreakdown = categoryBreakdown(ledger.expense.cats, "expense", scopeYears);
  const incomeBreakdown = categoryBreakdown(ledger.expense.incomeCats, "income", scopeYears);
  const labels = rows.map((row) => allYears ? `${MONTHS[row.month]}/${row.year}` : MONTHS[row.month]!);
  const trackedRows = rows.filter((row) => row.income || row.spent || row.funds);

  function categoryBreakdown(categories: FinanceCategory[], type: TransactionType, selectedYears: number[]) {
    const yearSet = new Set(selectedYears.map(String));
    return categories.map((category) => ({
      ...category,
      amount: ledger.expense.txns
        .filter((transaction) => transaction.type === type && transaction.cat === category.id && yearSet.has(transaction.date.slice(0, 4)))
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    })).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount);
  }

  return (
    <section className="page-view">
      <div className="statistics-filter">
        <label>Phạm vi
          <Select
            value={scope}
            options={[{ value: "all", label: "Toàn bộ các năm" }, ...availableYears.map((year) => ({ value: year, label: `Năm ${year}` }))]}
            onValueChange={setScope}
            ariaLabel="Phạm vi"
          />
        </label>
        <p className="hint">{allYears ? "Hiển thị riêng từng tháng-năm theo trình tự thời gian." : `Dữ liệu 12 tháng của năm ${scope}.`}</p>
      </div>

      <div className="stat-row">
        <Stat label="Tổng thu" value={fmt(totals.income)} meta={scopeLabel} accent="green" />
        <Stat label="Tổng chi" value={fmt(totals.spent)} meta={scopeLabel} accent="rust" />
        <Stat label="Tổng trích quỹ" value={fmt(totals.funds)} meta={scopeLabel} accent="gold" />
        <Stat label="Số dư" value={fmt(totals.balance)} meta="thu − chi − trích quỹ" accent={totals.balance < 0 ? "rust" : "blue"} />
      </div>

      <div className="grid">
        <CategoryBreakdown title={`Cơ cấu chi — ${scopeLabel}`} entries={expenseBreakdown} empty="Chưa có khoản chi nào trong phạm vi này." />
        <CategoryBreakdown title={`Cơ cấu thu — ${scopeLabel}`} entries={incomeBreakdown} empty="Chưa có khoản thu nào trong phạm vi này." />
      </div>

      <article className="card section-card">
        <h2>Diễn biến tích lũy — {scopeLabel}</h2>
        <p className="hint">Số tiền phân bổ mỗi quỹ theo {allYears ? "từng tháng-năm" : "tháng trong năm"}.</p>
        <div className="chart-wrap">
          <FinanceBarChart
            labels={labels}
            stacked
            datasets={ledger.funds.map((fund) => ({
              label: fund.name,
              values: rows.map((row) => row.byFund[fund.id] ?? 0),
              color: fund.color,
              stack: "funds",
            }))}
          />
        </div>
      </article>

      <article className="card section-card">
        <h2>So sánh tích lũy theo năm</h2>
        <p className="hint">Tổng tiền từng quỹ trong mỗi năm có dữ liệu.</p>
        <div className="chart-wrap">
          <FinanceBarChart
            labels={ledger.funds.map((fund) => fund.name)}
            datasets={years(ledger).map((year, index, list) => ({
              label: String(year),
              values: ledger.funds.map((fund) => yearToDateFund(ledger, year, fund.id)),
              color: `rgba(59,110,165,${0.35 + (index / Math.max(1, list.length - 1)) * 0.65})`,
            }))}
          />
        </div>
      </article>

      <article className="card section-card">
        <h2>Thống kê thu chi — {scopeLabel}</h2>
        <div className="chart-wrap">
          <FinanceBarChart
            labels={labels}
            datasets={[
              { label: "Thu", values: rows.map((row) => row.income), color: "#4C9F70" },
              { label: "Chi", values: rows.map((row) => row.spent), color: "#E4572E" },
              { label: "Trích quỹ", values: rows.map((row) => row.funds), color: "#E6B325" },
              { label: "Số dư", values: rows.map((row) => row.balance), color: "#3D5A80", kind: "line" },
            ]}
          />
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Tháng</th><th>Thu</th><th>Chi</th><th>Trích quỹ</th><th>Số dư</th><th>Chi/thu</th></tr></thead>
            <tbody>
              {trackedRows.map((row) => (
                <tr key={`${row.year}-${row.month}`}>
                  <td>{allYears ? `${MONTHS_FULL[row.month]} / ${row.year}` : MONTHS_FULL[row.month]}</td>
                  <td className="amt-income">{row.income ? fmt(row.income) : "—"}</td>
                  <td className="amt-expense">{row.spent ? fmt(row.spent) : "—"}</td>
                  <td>{row.funds ? fmt(row.funds) : "—"}</td>
                  <td className={row.balance < 0 ? "negative" : "positive"}>{row.income || row.spent || row.funds ? fmt(row.balance) : "—"}</td>
                  <td>{row.income ? `${Math.round(row.spent / row.income * 100)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>{allYears ? "Tổng mọi năm" : "Cả năm"}</td><td>{fmt(totals.income)}</td><td>{fmt(totals.spent)}</td><td>{fmt(totals.funds)}</td><td>{fmt(totals.balance)}</td><td>{totals.income ? `${Math.round(totals.spent / totals.income * 100)}%` : "0%"}</td></tr></tfoot>
          </table>
        </div>
        {!trackedRows.length ? <div className="empty-state">Chưa có khoản thu, chi hoặc trích quỹ trong phạm vi này.</div> : null}
      </article>
    </section>
  );
}

function Stat({ label, value, meta, accent }: { label: string; value: string; meta: string; accent: "gold" | "green" | "rust" | "blue" }) {
  return <div className={`stat accent-${accent}`}><div className="k">{label}</div><div className="v">{value}</div><div className="m">{meta}</div></div>;
}

function CategoryBreakdown({ title, entries, empty }: { title: string; entries: Array<FinanceCategory & { amount: number }>; empty: string }) {
  const total = entries.reduce((sum, item) => sum + item.amount, 0);
  return (
    <article className="card">
      <h2>{title}</h2>
      <div className="chart-wrap donut"><DonutChart labels={entries.map((item) => item.name)} values={entries.map((item) => item.amount)} colors={entries.map((item) => item.color)} /></div>
      <div className="legend">
        {!entries.length ? <div className="goal-cell">{empty}</div> : entries.map((item) => (
          <div className="row" key={item.id}><span className="lbl"><span className="fund-tag" style={{ background: item.color }} />{item.name}</span><span className="pct">{fmt(item.amount)} · {Math.round(item.amount / total * 100)}%</span></div>
        ))}
      </div>
    </article>
  );
}
