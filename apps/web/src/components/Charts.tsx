import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Legend,
  LineController,
  LinearScale,
  LineElement,
  PointElement,
  BarController,
  Tooltip,
} from "chart.js";
import type { ChartData, ChartOptions } from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import { fmt, fmtShort } from "@/lib/domain";

ChartJS.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LineController,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
);

ChartJS.defaults.font.family =
  '"Source Sans 3 Variable", "Avenir Next", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

interface DonutChartProps {
  labels: string[];
  values: number[];
  colors: string[];
}

export function DonutChart({ labels, values, colors }: DonutChartProps) {
  const data: ChartData<"doughnut"> = {
    labels,
    datasets: [{ data: values, backgroundColor: colors, borderColor: "#fffdf8", borderWidth: 2 }],
  };
  const options: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "62%",
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (context) => `${context.label}: ${fmt(Number(context.parsed))}` } },
    },
  };
  return <Doughnut data={data} options={options} />;
}

interface BarDataset {
  label: string;
  values: number[];
  color: string;
  stack?: string;
  kind?: "bar" | "line";
}

interface FinanceBarChartProps {
  labels: string[];
  datasets: BarDataset[];
  stacked?: boolean;
}

export function FinanceBarChart({ labels, datasets, stacked = false }: FinanceBarChartProps) {
  const data: ChartData<"bar" | "line", number[], string> = {
    labels,
    datasets: datasets.map((dataset) => ({
      type: dataset.kind ?? "bar",
      label: dataset.label,
      data: dataset.values,
      backgroundColor: dataset.color,
      borderColor: dataset.color,
      stack: dataset.stack,
      borderRadius: dataset.kind === "line" ? 0 : 3,
      tension: 0.3,
      pointRadius: dataset.kind === "line" ? 3 : 0,
    })),
  };
  const options: ChartOptions<"bar" | "line"> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { stacked, grid: { display: false } },
      y: { stacked, ticks: { callback: (value) => fmtShort(Number(value)) }, grid: { color: "#eee6d5" } },
    },
    plugins: {
      legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${fmt(Number(context.parsed.y))}` } },
    },
  };
  return <Bar data={data as ChartData<"bar", number[], string>} options={options as ChartOptions<"bar">} />;
}
