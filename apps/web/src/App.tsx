import { lazy, Suspense, useEffect, useRef } from "react";
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

export const MARKET_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export function MarketAutoRefresh() {
  const auth = useFinanceStore((state) => state.auth);
  const loaded = useFinanceStore((state) => state.loaded);
  const enabled = auth === "authenticated" && loaded;
  const mounted = useRef(false);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mounted.current = enabled;
    if (!enabled) return;

    const refresh = (): void => {
      if (refreshInFlight.current) return;
      const task = (async () => {
        const state = useFinanceStore.getState();
        if (!state.fundOverview) await state.loadFunds();
        if (!mounted.current) return;
        await useFinanceStore.getState().refreshMarket({ force: true, notifySuccess: false });
      })();
      refreshInFlight.current = task;
      void task.then(
        () => {
          if (refreshInFlight.current === task) refreshInFlight.current = null;
        },
        () => {
          if (refreshInFlight.current === task) refreshInFlight.current = null;
        },
      );
    };

    refresh();
    const interval = window.setInterval(refresh, MARKET_REFRESH_INTERVAL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
    };
  }, [enabled]);

  return null;
}

export default function App() {
  const auth = useFinanceStore((state) => state.auth);
  const loaded = useFinanceStore((state) => state.loaded);
  const bootstrap = useFinanceStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (auth !== "authenticated" || !loaded) return <AuthGate />;

  return (
    <>
      <MarketAutoRefresh />
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
    </>
  );
}
