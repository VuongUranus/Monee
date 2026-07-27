import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AuthGate } from "@/components/AuthGate";
import { AppShell } from "@/components/AppShell";
import { useFinanceStore } from "@/store/finance-store";

const ExpensesPage = lazy(async () => {
  const module = await import("@/features/expenses/ExpensesPage");
  return { default: module.ExpensesPage };
});
const FundsPage = lazy(async () => {
  const module = await import("@/features/funds/FundsPage");
  return { default: module.FundsPage };
});
const StatisticsPage = lazy(async () => {
  const module = await import("@/features/statistics/StatisticsPage");
  return { default: module.StatisticsPage };
});
const DebtsPage = lazy(async () => {
  const module = await import("@/features/debts/DebtsPage");
  return { default: module.DebtsPage };
});

export default function App() {
  const auth = useFinanceStore((state) => state.auth);
  const loaded = useFinanceStore((state) => state.loaded);
  const bootstrap = useFinanceStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (auth !== "authenticated" || !loaded) return <AuthGate />;

  return (
    <AppShell>
      <Suspense fallback={<div className="empty-state">Đang tải màn hình…</div>}>
        <Routes>
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/funds" element={<FundsPage />} />
          <Route path="/statistics" element={<StatisticsPage />} />
          <Route path="/debts" element={<DebtsPage />} />
          <Route path="*" element={<Navigate to="/expenses" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
