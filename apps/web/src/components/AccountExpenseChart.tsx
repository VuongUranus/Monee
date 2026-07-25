import { DonutChart } from "@/components/Charts";
import { fmt, type AccountExpenseBreakdown } from "@/lib/domain";

interface AccountExpenseChartProps {
  entries: AccountExpenseBreakdown[];
  empty: string;
  compact?: boolean;
}

export function AccountExpenseChart({ entries, empty, compact = false }: AccountExpenseChartProps) {
  const total = entries.reduce((sum, item) => sum + item.amount, 0);
  return (
    <div className={compact ? "compact-donut" : ""}>
      <div className="chart-wrap donut"><DonutChart labels={entries.map((item) => item.name)} values={entries.map((item) => item.amount)} colors={entries.map((item) => item.color)} /></div>
      <div className="legend">
        {!entries.length ? <div className="goal-cell">{empty}</div> : entries.map((item) => (
          <div className="row" key={item.id}><span className="lbl"><span className="fund-tag" style={{ background: item.color }} />{item.name}</span><span className="pct">{fmt(item.amount)} · {Math.round(item.amount / total * 100)}%</span></div>
        ))}
      </div>
    </div>
  );
}
