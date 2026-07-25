import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AuthGate } from "@/components/AuthGate";
import { AppShell } from "@/components/AppShell";
import { ExpensesPage } from "@/features/expenses/ExpensesPage";
import { FundsPage } from "@/features/funds/FundsPage";
import { StatisticsPage } from "@/features/statistics/StatisticsPage";
import { useFinanceStore } from "@/store/finance-store";

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
      <Routes>
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/funds" element={<FundsPage />} />
        <Route path="/statistics" element={<StatisticsPage />} />
        <Route path="*" element={<Navigate to="/expenses" replace />} />
      </Routes>
    </AppShell>
  );
}
