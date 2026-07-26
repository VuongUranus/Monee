import { useEffect } from "react";
import type { FinanceCategory } from "@chi-tieu/shared";
import { AccountExpenseChart } from "@/components/AccountExpenseChart";
import { DonutChart, FinanceBarChart } from "@/components/Charts";
import { Select } from "@/components/Select";
import {
  fmt,
  MONTHS,
  MONTHS_FULL,
  savingRate,
  statisticsScopeLabel,
  type StatisticsScope,
} from "@/lib/domain";
import { useFinanceStore } from "@/store/finance-store";

interface StatisticsRow {
  year: number;
  month: number;
  key: string;
  income: number;
  spent: number;
  funds: number;
  balance: number;
  byFund: Record<string, number>;
}

type ScopeMode = StatisticsScope["mode"];

export function StatisticsPage() {
  const statistics = useFinanceStore((state) => state.statistics);
  const loadStatistics = useFinanceStore((state) => state.loadStatistics);
  const scope = useFinanceStore((state) => state.statisticsScope);
  const setScope = useFinanceStore((state) => state.setStatisticsScope);
  const selectedYear = useFinanceStore((state) => state.selectedYear);
  const selectedMonth = useFinanceStore((state) => state.selectedMonth);
  useEffect(() => {
    void loadStatistics(scope);
  }, [loadStatistics, scope]);

  const availableYears = (statistics?.availableYears ?? [selectedYear]).slice().sort((a, b) => b - a);
  const monthOptions = availableYears.flatMap((year) => Array.from({ length: 12 }, (_, month) => {
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    return { value: key, label: `${MONTHS_FULL[month]} / ${year}` };
  }));
  const currentMonth = `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}`;
  const rows: StatisticsRow[] = statistics?.rows ?? [];
  const scopeLabel = statisticsScopeLabel(scope);
  const totals = statistics?.totals ?? { income: 0, spent: 0, funds: 0, balance: 0 };
  const expenseBreakdown = statistics?.expenseBreakdown ?? [];
  const incomeBreakdown = statistics?.incomeBreakdown ?? [];
  const accountExpenses = statistics?.accountExpenses ?? [];
  const showYearInLabels = scope.mode === "all" || scope.mode === "range" || scope.mode === "month";
  const labels = rows.map((row) => showYearInLabels ? `${MONTHS[row.month]}/${row.year}` : MONTHS[row.month]!);
  const trackedRows = rows.filter((row) => row.income || row.spent || row.funds);
  const comparisonYears = [...new Set(rows.map((row) => row.year))];
  const rate = savingRate(totals.income, totals.funds);

  const changeMode = (mode: ScopeMode): void => {
    if (mode === "all") setScope({ mode });
    else if (mode === "year") setScope({ mode, year: scope.mode === "year" ? scope.year : selectedYear });
    else if (mode === "month") setScope({ mode, month: scope.mode === "month" ? scope.month : currentMonth });
    else setScope({ mode, from: scope.mode === "range" ? scope.from : currentMonth, to: scope.mode === "range" ? scope.to : currentMonth });
  };

  return (
    <section className="page-view">
      <div className="statistics-filter">
        <label>Phạm vi
          <Select<ScopeMode>
            value={scope.mode}
            options={[{ value: "all", label: "Toàn bộ các năm" }, { value: "year", label: "Theo năm" }, { value: "month", label: "Tháng cụ thể" }, { value: "range", label: "Khoảng tháng" }]}
            onValueChange={changeMode}
            ariaLabel="Phạm vi"
          />
        </label>
        {scope.mode === "year" ? <label>Năm
          <Select<number> value={scope.year} options={availableYears.map((year) => ({ value: year, label: `Năm ${year}` }))} onValueChange={(year) => setScope({ mode: "year", year })} ariaLabel="Năm thống kê" />
        </label> : null}
        {scope.mode === "month" ? <label>Tháng
          <Select<string> value={scope.month} options={monthOptions} onValueChange={(month) => setScope({ mode: "month", month })} ariaLabel="Tháng thống kê" />
        </label> : null}
        {scope.mode === "range" ? <>
          <label>Từ tháng
            <Select<string> value={scope.from} options={monthOptions} onValueChange={(from) => setScope({ mode: "range", from, to: from > scope.to ? from : scope.to })} ariaLabel="Từ tháng" />
          </label>
          <label>Đến tháng
            <Select<string> value={scope.to} options={monthOptions} onValueChange={(to) => setScope({ mode: "range", from: to < scope.from ? to : scope.from, to })} ariaLabel="Đến tháng" />
          </label>
        </> : null}
        <p className="hint">{scope.mode === "all" ? "Hiển thị riêng từng tháng-năm theo trình tự thời gian." : `Đang xem ${rows.length} tháng dữ liệu.`}</p>
      </div>

      <div className="stat-row stat-row-5">
        <Stat label="Tổng thu" value={fmt(totals.income)} meta={scopeLabel} accent="green" />
        <Stat label="Tổng chi" value={fmt(totals.spent)} meta={scopeLabel} accent="rust" />
        <Stat label="Tổng trích quỹ" value={fmt(totals.funds)} meta={scopeLabel} accent="gold" />
        <Stat label="Tỷ lệ tiết kiệm" value={rate === null ? "—" : `${Math.round(rate * 100)}%`} meta="trích quỹ / thu nhập" accent="green" />
        <Stat label="Số dư" value={fmt(totals.balance)} meta="thu − chi − trích quỹ" accent={totals.balance < 0 ? "rust" : "blue"} />
      </div>

      <div className="statistics-breakdown-grid">
        <CategoryBreakdown title={`Cơ cấu chi — ${scopeLabel}`} entries={expenseBreakdown} empty="Chưa có khoản chi nào trong phạm vi này." />
        <CategoryBreakdown title={`Cơ cấu thu — ${scopeLabel}`} entries={incomeBreakdown} empty="Chưa có khoản thu nào trong phạm vi này." />
        <article className="card">
          <h2>Chi tiêu theo tài khoản — {scopeLabel}</h2>
          <AccountExpenseChart entries={accountExpenses} empty="Chưa có khoản chi nào trong phạm vi này." />
        </article>
      </div>

      <article className="card section-card">
        <h2>Diễn biến tích lũy — {scopeLabel}</h2>
        <p className="hint">Số tiền phân bổ mỗi quỹ theo từng tháng trong phạm vi chọn.</p>
        <div className="chart-wrap">
          <FinanceBarChart
            labels={labels}
            stacked
            datasets={(statistics?.funds ?? []).map((fund) => ({
              label: fund.name,
              values: rows.map((row) => row.byFund[fund.id] ?? 0),
              color: fund.color,
              stack: "funds",
            }))}
          />
        </div>
      </article>

      <article className="card section-card">
        <h2>So sánh tích lũy theo năm — {scopeLabel}</h2>
        <p className="hint">Tổng tiền từng quỹ trong phần dữ liệu đang xem.</p>
        <div className="chart-wrap">
          <FinanceBarChart
            labels={(statistics?.funds ?? []).map((fund) => fund.name)}
            datasets={comparisonYears.map((year, index, list) => ({
              label: String(year),
              values: (statistics?.funds ?? []).map((fund) => rows.filter((row) => row.year === year).reduce((sum, row) => sum + (row.byFund[fund.id] ?? 0), 0)),
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
            <thead><tr><th>Tháng</th><th>Thu</th><th>Chi</th><th>Trích quỹ</th><th>Số dư</th><th>Chi/thu</th><th>Tiết kiệm/thu</th></tr></thead>
            <tbody>
              {trackedRows.map((row) => (
                <tr key={row.key}>
                  <td>{showYearInLabels ? `${MONTHS_FULL[row.month]} / ${row.year}` : MONTHS_FULL[row.month]}</td>
                  <td className="amt-income">{row.income ? fmt(row.income) : "—"}</td>
                  <td className="amt-expense">{row.spent ? fmt(row.spent) : "—"}</td>
                  <td>{row.funds ? fmt(row.funds) : "—"}</td>
                  <td className={row.balance < 0 ? "negative" : "positive"}>{row.income || row.spent || row.funds ? fmt(row.balance) : "—"}</td>
                  <td>{row.income ? `${Math.round(row.spent / row.income * 100)}%` : "—"}</td>
                  <td>{savingRate(row.income, row.funds) === null ? "—" : `${Math.round(savingRate(row.income, row.funds)! * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>{scope.mode === "all" ? "Tổng mọi năm" : scope.mode === "year" ? "Cả năm" : "Tổng phạm vi"}</td><td>{fmt(totals.income)}</td><td>{fmt(totals.spent)}</td><td>{fmt(totals.funds)}</td><td>{fmt(totals.balance)}</td><td>{totals.income ? `${Math.round(totals.spent / totals.income * 100)}%` : "—"}</td><td>{rate === null ? "—" : `${Math.round(rate * 100)}%`}</td></tr></tfoot>
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
