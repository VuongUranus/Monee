import { useCallback, useEffect, useState } from "react";
import type {
  CryptoMatch,
  Fund,
  FundCategory,
  FundDetail,
  FundMonthDetailResponse,
  GoldDetail,
  GoldLot,
  HoldingDetail,
  HoldingLot,
  MarketAssetRequest,
  FundOverviewItem,
  SharedFundContributionsResponse,
  SharedFundMembersResponse,
  SharedFundRole,
} from "@chi-tieu/shared";
import { api } from "@/lib/api";
import { DonutChart } from "@/components/Charts";
import { Modal } from "@/components/Modal";
import { MoneyInput } from "@/components/MoneyInput";
import { Select } from "@/components/Select";
import {
  cryptoQuote,
  currentLotPriceVnd,
  fmt,
  fmtNumber,
  fmtShort,
  FUND_CATEGORIES,
  fundCategory,
  goldLotCostVnd,
  goldLotPriceVnd,
  holdingCostVnd,
  getGoal,
  MONTHS_FULL,
  PALETTE,
  slugId,
} from "@/lib/domain";
import { useFinanceStore } from "@/store/finance-store";

function sumFundAmounts(amounts: number[] | undefined): number {
  return (amounts ?? []).reduce((total, amount) => total + amount, 0);
}

function liveAllTimeTotal(overview: FundOverviewItem | undefined, yearTotal: number): number {
  if (!overview) return yearTotal;
  return overview.allTimeTotal + yearTotal - overview.yearTotal;
}

function addMarketAssetsFromDetail(state: any, fundId: string, detail: FundDetail): void {
  if (!detail || !state.fundOverview) return;
  const category = state.ledger.funds.find((fund: Fund) => fund.id === fundId)?.cat;
  if (category !== "gold" && category !== "stock" && category !== "crypto") return;
  const assets = new Map<string, MarketAssetRequest>(state.fundOverview.marketAssets.map((asset: MarketAssetRequest) => [JSON.stringify(asset), asset]));
  if (category === "gold") {
    assets.set("gold", { type: "gold" });
  } else if (detail.type === "hold") {
    for (const lot of detail.lots) {
      const symbol = lot.ticker.trim().toUpperCase();
      if (!symbol) continue;
      const asset: MarketAssetRequest = category === "stock"
        ? { type: "stock", symbol, ...(lot.exchange ? { exchange: lot.exchange } : {}) }
        : { type: "crypto", symbol, ...(lot.providerId ? { providerId: lot.providerId } : {}) };
      assets.set(JSON.stringify(asset), asset);
    }
  }
  state.fundOverview.marketAssets = [...assets.values()];
}

function reconcileFundMonth(
  state: any,
  result: FundMonthDetailResponse,
  includeDetail: boolean,
): void {
  const overview = state.fundOverview;
  if (overview?.year === result.year) {
    const fund = overview.funds.find((item: FundOverviewItem) => item.id === result.fundId);
    const monthIndex = result.month - 1;
    if (fund) {
      const previous = fund.yearAmounts[monthIndex] ?? 0;
      const beforePeriodTotal = overview.funds.reduce((sum: number, item: FundOverviewItem) =>
        sum + (item.yearAmounts[monthIndex] ?? 0), 0);
      fund.yearAmounts[monthIndex] = result.amount;
      if (overview.month === result.month) fund.monthAmount = result.amount;
      fund.yearTotal += result.amount - previous;
      fund.allTimeTotal += result.amount - previous;
      const afterPeriodTotal = beforePeriodTotal - previous + result.amount;
      if (beforePeriodTotal === 0 && afterPeriodTotal > 0) {
        overview.yearActiveMonths += 1;
        overview.allTimeActiveMonths += 1;
      } else if (beforePeriodTotal > 0 && afterPeriodTotal === 0) {
        overview.yearActiveMonths -= 1;
        overview.allTimeActiveMonths -= 1;
      }
    }
  }
  const shared = state.sharedFunds[result.fundId];
  if (shared) {
    const sharedYear = shared.content.years[String(result.year)] ?? {
      funds: new Array<number>(12).fill(0),
      details: new Array<FundDetail>(12).fill(null),
    };
    sharedYear.funds[result.month - 1] = result.amount;
    if (includeDetail) sharedYear.details[result.month - 1] = structuredClone(result.detail);
    shared.content.years[String(result.year)] = sharedYear;
  }
  if (!includeDetail) return;
  state.fundDetails[`${result.fundId}:${result.year}:${result.month}`] = structuredClone(result);
  addMarketAssetsFromDetail(state, result.fundId, result.detail);
}

export function FundsPage() {
  const ledger = useFinanceStore((state) => state.ledger);
  const fundOverview = useFinanceStore((state) => state.fundOverview);
  const loadFunds = useFinanceStore((state) => state.loadFunds);
  const loadFundDetail = useFinanceStore((state) => state.loadFundDetail);
  const year = useFinanceStore((state) => state.selectedYear);
  const month = useFinanceStore((state) => state.selectedMonth);
  const periodReady = useFinanceStore((state) => state.periodReady);
  const marketState = useFinanceStore((state) => state.marketState);
  const marketMessage = useFinanceStore((state) => state.marketMessage);
  const updateLedger = useFinanceStore((state) => state.updateLedger);
  const mutateLedger = useFinanceStore((state) => state.mutateLedger);
  const mutateSharedLedger = useFinanceStore((state) => state.mutateSharedLedger);
  const refreshMarket = useFinanceStore((state) => state.refreshMarket);
  const [scope, setScope] = useState<"year" | "all">("year");
  const [managing, setManaging] = useState(false);
  const [detailFundId, setDetailFundId] = useState<string | null>(null);
  const [shareFundId, setShareFundId] = useState<string | null>(null);
  const [contributionFundId, setContributionFundId] = useState<string | null>(null);
  const contributionMonth = `${year}-${String(month + 1).padStart(2, "0")}`;

  useEffect(() => {
    if (periodReady) void loadFunds();
  }, [loadFunds, month, periodReady, year]);

  const yearData = ledger.years[String(year)] ?? {
    income: new Array<number>(12).fill(0),
    funds: {},
    details: {},
    notes: new Array<string>(12).fill(""),
  };
  const income = fundOverview?.income ?? 0;
  const total = ledger.funds.reduce((sum, fund) => sum + (yearData.funds[fund.id]?.[month] ?? 0), 0);
  const totalYtd = ledger.funds.reduce((sum, fund) => sum + sumFundAmounts(yearData.funds[fund.id]), 0);
  const activeYearMonths = Array.from({ length: 12 }, (_, monthIndex) =>
    ledger.funds.reduce((sum, fund) => sum + (yearData.funds[fund.id]?.[monthIndex] ?? 0), 0) > 0,
  ).filter(Boolean).length;
  const scopeTotal = scope === "all"
    ? ledger.funds.reduce((sum, fund) => {
      const overview = fundOverview?.funds.find((item) => item.id === fund.id);
      return sum + liveAllTimeTotal(overview, sumFundAmounts(yearData.funds[fund.id]));
    }, 0)
    : totalYtd;
  const scopeMonths = scope === "all"
    ? fundOverview?.allTimeActiveMonths ?? 0
    : activeYearMonths;
  const accumulatedAssets = ledger.funds.reduce((sum, fund) => {
    const overview = fundOverview?.funds.find((item) => item.id === fund.id);
    return sum + liveAllTimeTotal(overview, sumFundAmounts(yearData.funds[fund.id]));
  }, 0);
  const openingAssets = ledger.funds.reduce((sum, fund) => sum + (ledger.financialProfile.openingBalances[fund.id] ?? 0), 0);
  const assets = accumulatedAssets + openingAssets;
  const debt = fundOverview?.debtSummary?.liabilities ?? ledger.financialProfile.debt.balance;
  const receivables = fundOverview?.debtSummary?.receivables ?? 0;

  const resetMonth = (): void => {
    if (!window.confirm(`Xóa toàn bộ phân bổ quỹ và ghi chú của ${MONTHS_FULL[month]} / ${year}?`)) return;
    mutateLedger((draft) => {
      const target = draft.years[String(year)]!;
      for (const fund of draft.funds.filter((item) => item.sharing?.role !== "viewer")) {
        target.funds[fund.id]![month] = 0;
        target.details[fund.id]![month] = null;
      }
      target.notes[month] = "";
    }, async (expectedRevision) => {
      for (const fund of ledger.funds.filter((item) => item.sharing && item.sharing.role !== "viewer")) {
        const shared = useFinanceStore.getState().sharedFunds[fund.id];
        if (shared) await api.updateSharedFundMonth(fund.id, year, month + 1, shared.revision, { amount: 0, detail: null });
      }
      return api.resetMonth(year, month + 1, expectedRevision);
    });
  };

  return (
    <section className="page-view">
      <div className="toolbar">
        <button className="btn sm" type="button" onClick={() => setManaging(true)}>⚙ Quản lý quỹ</button>
        <button className="btn sm" type="button" disabled={marketState === "loading"} onClick={() => void refreshMarket(true)}>↻ Cập nhật giá</button>
        <span className={`market-status ${marketState === "error" ? "error" : ""}`}>{marketMessage}</span>
        <span className="spacer" />
        <button className="btn sm danger" type="button" onClick={resetMonth}>Xóa tháng này</button>
      </div>

      {ledger.market.errors.length ? (
        <div className="warn-box">
          <span>⚠</span>
          <div>
            <b>Chưa cập nhật được một số giá thị trường.</b>
            {ledger.market.errors.map((error) => <div key={`${error.key}-${error.code}`}>{error.message}</div>)}
          </div>
        </div>
      ) : null}

      <div className="stat-row stat-row-6">
        <Stat label="Phân bổ tháng này" value={fmt(total)} meta={income ? `${Math.round(total / income * 100)}% thu nhập` : "chưa có thu nhập"} accent="gold" />
        <div className="stat accent-green">
          <div className="k">{scope === "all" ? "Lũy kế toàn bộ" : `Lũy kế năm ${year}`}</div>
          <div className="v">{fmt(scopeTotal)}</div>
          <Select<"year" | "all">
            value={scope}
            options={[{ value: "year", label: "Năm đang xem" }, { value: "all", label: "Toàn bộ" }]}
            onValueChange={setScope}
            ariaLabel="Phạm vi tích lũy"
            className="scope-sel"
            compact
          />
        </div>
        <Stat label="Trung bình" value={fmt(scopeMonths ? scopeTotal / scopeMonths : 0)} meta={`${scopeMonths} tháng có nhập`} />
        <Stat label="Tổng tài sản" value={fmt(assets)} meta="lũy kế + số dư ban đầu" accent="blue" />
        <Stat label="Nợ phải trả" value={fmt(debt)} meta={receivables ? `phải thu ${fmt(receivables)}` : "xem chi tiết ở Vay & nợ"} accent="rust" />
        <Stat label="Tài sản ròng" value={fmt(assets + receivables - debt)} meta="tài sản + phải thu − nợ" accent="green" />
      </div>

      <div className="grid">
        <article className="card">
          <h2>Phân bổ theo quỹ — {MONTHS_FULL[month]} / {year}</h2>
          <p className="hint">Có thể nhập phép tính như <code>5tr+500k</code> bằng số đầy đủ, ví dụ <code>5000000+500000</code>.</p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Quỹ</th><th>Tháng này</th><th>Thành viên gửi</th><th>% thu</th><th>Lũy kế năm</th></tr></thead>
              <tbody>
                {ledger.funds.map((fund) => {
                  const value = yearData.funds[fund.id]?.[month] ?? 0;
                  const category = fundCategory(fund);
                  const overview = fundOverview?.funds.find((item) => item.id === fund.id);
                  const contributed = overview?.contributionAmount ?? 0;
                  const contributionCount = overview?.contributionCount ?? 0;
                  const yearTotal = sumFundAmounts(yearData.funds[fund.id]);
                  return (
                    <tr key={fund.id}>
                      <td><span className="fund-tag" style={{ background: fund.color }} />{fund.name}<small className="table-meta">{FUND_CATEGORIES[category].short}</small></td>
                      <td>
                        {category === "saving" && fund.sharing?.role !== "viewer" ? (
                          <MoneyInput
                            value={value}
                            ariaLabel={`Số tiền ${fund.name}`}
                            onCommit={(amount) => {
                              if (amount === value) return;
                              const mutate = (draft: any): void => { draft.years[String(year)]!.funds[fund.id]![month] = amount; };
                              if (fund.sharing) {
                                void mutateSharedLedger(fund.id, mutate, (revision) =>
                                  api.updateSharedFundMonth(fund.id, year, month + 1, revision, { amount }), {
                                  refresh: "none",
                                  reconcile: (state, result) => reconcileFundMonth(state, result, false),
                                })
                                  .catch(() => undefined);
                              } else {
                                mutateLedger(mutate, (expectedRevision) => api.updateFundMonth(fund.id, year, month + 1, { amount }, expectedRevision), {
                                  refresh: "none",
                                  reconcile: (state, result) => reconcileFundMonth(state, result, false),
                                });
                              }
                            }}
                          />
                        ) : category === "saving" ? <strong>{fmt(value)}</strong> : (
                          <button className="computed-button" type="button" onClick={() => {
                            void loadFundDetail(fund.id).then((detail) => {
                              if (detail) setDetailFundId(fund.id);
                            });
                          }}>
                            <strong>{fmt(value)}</strong><small>Chỉnh chi tiết</small>
                          </button>
                        )}
                      </td>
                      <td>{fund.sharing ? <button className="computed-button" type="button" onClick={() => setContributionFundId(fund.id)}><strong>{fmt(contributed)}</strong><small>{contributionCount ? `${contributionCount} khoản` : "Ghi nhận"}</small></button> : "—"}</td>
                      <td>{income ? `${(value / income * 100).toFixed(1)}%` : "0%"}</td>
                      <td>{fmt(yearTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td>Tổng cộng</td><td>{fmt(total)}</td><td>—</td><td>{income ? `${Math.round(total / income * 100)}%` : "0%"}</td><td>{fmt(totalYtd)}</td></tr></tfoot>
            </table>
          </div>
          <label className="field-block">
            <span>Ghi chú tháng</span>
            <input
              className="note-input"
              value={yearData.notes[month] ?? ""}
              placeholder="Ví dụ: thưởng Tết, rút crypto…"
              onChange={(event) => updateLedger((draft) => {
                draft.years[String(year)]!.notes[month] = event.target.value;
              })}
              onBlur={() => mutateLedger(
                () => undefined,
                (expectedRevision) => api.updateMonthNote(year, month + 1, useFinanceStore.getState().ledger.years[String(year)]!.notes[month] ?? "", expectedRevision),
                {
                  refresh: "none",
                  reconcile: (state, result) => {
                    if (state.fundOverview?.year === result.year && state.fundOverview.month === result.month) {
                      state.fundOverview.note = result.note;
                    }
                  },
                },
              )}
            />
          </label>
        </article>

        <article className="card">
          <h2>Cơ cấu tháng này</h2>
          <p className="hint">Tỷ trọng từng quỹ trong tổng số tiền phân bổ.</p>
          <div className="chart-wrap donut">
            <DonutChart
              labels={ledger.funds.map((fund) => fund.name)}
              values={ledger.funds.map((fund) => yearData.funds[fund.id]?.[month] ?? 0)}
              colors={ledger.funds.map((fund) => fund.color)}
            />
          </div>
          <div className="legend">
            {ledger.funds.map((fund) => {
              const value = yearData.funds[fund.id]?.[month] ?? 0;
              return (
                <div className="row" key={fund.id}>
                  <span className="lbl"><span className="fund-tag" style={{ background: fund.color }} />{fund.name}</span>
                  <span className="pct">{fmt(value)} · {total ? Math.round(value / total * 100) : 0}%</span>
                </div>
              );
            })}
          </div>
        </article>
      </div>

      <div className="section-head">
        <div>
          <h2>Mục tiêu tích lũy</h2>
          <p className="hint">Mục tiêu năm áp dụng riêng cho {year}; mục tiêu toàn bộ tính trên mọi năm.</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={ledger.showGoals}
            onChange={(event) => {
              const showGoals = event.target.checked;
              mutateLedger((draft) => { draft.showGoals = showGoals; }, (expectedRevision) => api.updatePreferences(expectedRevision, { showGoals }), {
                refresh: "none",
                reconcile: (state, result) => {
                  if (state.fundOverview) state.fundOverview.showGoals = result.showGoals;
                },
              });
            }}
          />
          Hiện mục tiêu
        </label>
      </div>

      {ledger.showGoals ? <GoalsTable /> : null}
      {managing ? <FundManager onClose={() => setManaging(false)} onShare={setShareFundId} /> : null}
      {detailFundId ? <FundDetailEditor fundId={detailFundId} onClose={() => setDetailFundId(null)} /> : null}
      {shareFundId ? <ShareFundModal fundId={shareFundId} onClose={() => setShareFundId(null)} /> : null}
      {contributionFundId ? <ContributionModal fundId={contributionFundId} month={contributionMonth} onClose={() => setContributionFundId(null)} /> : null}
    </section>
  );
}

function Stat({ label, value, meta, accent }: { label: string; value: string; meta: string; accent?: "gold" | "green" | "rust" | "blue" }) {
  return (
    <div className={`stat ${accent ? `accent-${accent}` : ""}`}>
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="m">{meta}</div>
    </div>
  );
}

function GoalsTable() {
  const ledger = useFinanceStore((state) => state.ledger);
  const fundOverview = useFinanceStore((state) => state.fundOverview);
  const year = useFinanceStore((state) => state.selectedYear);
  const month = useFinanceStore((state) => state.selectedMonth);
  const mutateLedger = useFinanceStore((state) => state.mutateLedger);
  const mutateSharedLedger = useFinanceStore((state) => state.mutateSharedLedger);
  const yearData = ledger.years[String(year)];
  const saveGoal = (fund: Fund, goalYear: number | null, value: number, recipe: (draft: any) => void): void => {
    const reconcile = (state: any, result: { fundId: string; year: number | null; amount: number }): void => {
      const overview = state.fundOverview?.funds.find((item: FundOverviewItem) => item.id === result.fundId);
      const shared = state.sharedFunds[result.fundId];
      if (shared) {
        if (result.year === null) shared.content.goal.all = result.amount;
        else if (result.amount > 0) shared.content.goal.years[String(result.year)] = result.amount;
        else delete shared.content.goal.years[String(result.year)];
      }
      if (!overview) return;
      if (result.year === null) overview.allGoal = result.amount;
      else if (state.fundOverview?.year === result.year) overview.yearGoal = result.amount;
    };
    if (fund.sharing) {
      void mutateSharedLedger(fund.id, recipe, (revision) =>
        api.updateSharedFundGoal(fund.id, revision, goalYear, value), { refresh: "none", reconcile })
        .catch(() => undefined);
    } else {
      mutateLedger(recipe, (expectedRevision) => api.updateFundGoal(fund.id, goalYear, value, expectedRevision), {
        refresh: "none",
        reconcile,
      });
    }
  };
  const totals = ledger.funds.reduce((result, fund) => {
    const overview = fundOverview?.funds.find((item) => item.id === fund.id);
    const goal = ledger.goals[fund.id] ?? { years: {}, all: 0 };
    const ytd = sumFundAmounts(yearData?.funds[fund.id]);
    result.yearGoal += goal.years[String(year)] ?? 0;
    result.allGoal += goal.all;
    result.ytd += ytd;
    result.all += liveAllTimeTotal(overview, ytd);
    return result;
  }, { yearGoal: 0, allGoal: 0, ytd: 0, all: 0 });

  return (
    <article className="card goal-card">
      <div className="table-scroll">
        <table>
          <thead><tr><th>Quỹ</th><th>Mục tiêu {year}</th><th>Đã tích lũy</th><th>Tiến độ</th><th>Cần/tháng</th><th>Mục tiêu toàn bộ</th><th>Tích lũy toàn bộ</th><th>Tiến độ</th></tr></thead>
          <tbody>
            {ledger.funds.map((fund) => {
              const overview = fundOverview?.funds.find((item) => item.id === fund.id);
              const goal = ledger.goals[fund.id] ?? { years: {}, all: 0 };
              const yearGoal = goal.years[String(year)] ?? 0;
              const allGoal = goal.all;
              const ytd = sumFundAmounts(yearData?.funds[fund.id]);
              const all = liveAllTimeTotal(overview, ytd);
              const remaining = Math.max(0, yearGoal - ytd);
              const need = remaining > 0 ? Math.ceil(remaining / (12 - month)) : 0;
              return (
                <tr key={fund.id}>
                  <td><span className="fund-tag" style={{ background: fund.color }} />{fund.name}</td>
                  <td>{fund.sharing?.role === "viewer" ? (yearGoal ? fmt(yearGoal) : "—") : <MoneyInput value={yearGoal} onCommit={(value) => saveGoal(fund, year, value, (draft) => {
                    const target = getGoal(draft as any, fund.id);
                    if (value > 0) target.years[String(year)] = value;
                    else delete target.years[String(year)];
                  })} />}</td>
                  <td>{fmt(ytd)}</td>
                  <td><Progress value={ytd} goal={yearGoal} color={fund.color} /></td>
                  <td className="need-cell">{yearGoal ? (remaining ? <>{fmt(need)}<small>còn thiếu {fmtShort(remaining)}</small></> : <span className="ok">✓ đã đạt</span>) : <span className="goal-cell">chưa đặt</span>}</td>
                  <td>{fund.sharing?.role === "viewer" ? (allGoal ? fmt(allGoal) : "—") : <MoneyInput value={allGoal} onCommit={(value) => saveGoal(fund, null, value, (draft) => { getGoal(draft as any, fund.id).all = value; })} />}</td>
                  <td>{fmt(all)}</td>
                  <td><Progress value={all} goal={allGoal} color={fund.color} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Tổng cộng</td><td>{totals.yearGoal ? fmt(totals.yearGoal) : "—"}</td><td>{fmt(totals.ytd)}</td>
              <td><Progress value={totals.ytd} goal={totals.yearGoal} color="#3b6ea5" /></td><td />
              <td>{totals.allGoal ? fmt(totals.allGoal) : "—"}</td><td>{fmt(totals.all)}</td>
              <td><Progress value={totals.all} goal={totals.allGoal} color="#3b6ea5" /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </article>
  );
}

function Progress({ value, goal, color }: { value: number; goal: number; color: string }) {
  if (!goal) return <span className="goal-cell">chưa đặt</span>;
  const progress = Math.min(100, value / goal * 100);
  return <>{progress.toFixed(0)}%<div className="bar"><span style={{ width: `${progress}%`, background: color }} /></div></>;
}

function FundManager({ onClose, onShare }: { onClose(): void; onShare(fundId: string): void }) {
  const ledger = useFinanceStore((state) => state.ledger);
  const updateLedger = useFinanceStore((state) => state.updateLedger);
  const mutateLedger = useFinanceStore((state) => state.mutateLedger);
  const mutateSharedLedger = useFinanceStore((state) => state.mutateSharedLedger);
  const deleteSharedFund = useFinanceStore((state) => state.deleteSharedFund);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]!);
  const [category, setCategory] = useState<FundCategory>("saving");

  const add = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    mutateLedger((draft) => {
      let id = slugId(trimmed);
      let suffix = 2;
      while (draft.funds.some((fund) => fund.id === id)) id = `${slugId(trimmed)}-${suffix++}`;
      draft.funds.push({ id, name: trimmed, color, cat: category });
      for (const data of Object.values(draft.years)) {
        data.funds[id] = new Array<number>(12).fill(0);
        data.details[id] = new Array<FundDetail>(12).fill(null);
      }
      draft.financialProfile.fundPlan[id] = 0;
      draft.financialProfile.openingBalances[id] = 0;
    }, (expectedRevision) => api.createFund({ name: trimmed, color, category }, expectedRevision));
    setName("");
  };

  const remove = async (fund: Fund): Promise<void> => {
    if (ledger.funds.length <= 1 || !window.confirm(`Xóa quỹ “${fund.name}” cùng toàn bộ dữ liệu của quỹ?`)) return;
    if (fund.sharing) {
      if (fund.sharing.role !== "owner") return;
      try {
        await deleteSharedFund(fund.id);
      } catch {
        // The store reloads the fund overview and surfaces the error status.
      }
      return;
    }
    mutateLedger((draft) => {
      draft.funds = draft.funds.filter((item) => item.id !== fund.id);
      for (const data of Object.values(draft.years)) {
        delete data.funds[fund.id];
        delete data.details[fund.id];
      }
      delete draft.goals[fund.id];
      delete draft.financialProfile.fundPlan[fund.id];
      delete draft.financialProfile.openingBalances[fund.id];
    }, (expectedRevision) => api.deleteFund(fund.id, expectedRevision));
  };

  const move = (index: number, direction: number): void => {
    const target = index + direction;
    if (target < 0 || target >= ledger.funds.length) return;
    if (ledger.funds[index]?.sharing) return;
    const ids = ledger.funds.filter((fund) => !fund.sharing).map((fund) => fund.id);
    const privateIndex = ids.indexOf(ledger.funds[index]!.id);
    const privateTarget = privateIndex + direction;
    if (privateIndex < 0 || privateTarget < 0 || privateTarget >= ids.length) return;
    [ids[privateIndex], ids[privateTarget]] = [ids[privateTarget]!, ids[privateIndex]!];
    mutateLedger((draft) => {
      const [fund] = draft.funds.splice(index, 1);
      if (fund) draft.funds.splice(target, 0, fund);
    }, (expectedRevision) => api.reorderFunds(ids, expectedRevision));
  };

  const updateFund = (fund: Fund, patch: Record<string, unknown>, recipe: (draft: any) => void): void => {
    const reconcile = (state: any): void => {
      const current = state.ledger.funds.find((item: Fund) => item.id === fund.id);
      const overview = state.fundOverview?.funds.find((item: FundOverviewItem) => item.id === fund.id);
      if (!current || !overview) return;
      overview.name = current.name;
      overview.color = current.color;
      overview.cat = current.cat;
      overview.fundPlan = state.ledger.financialProfile.fundPlan[fund.id] ?? overview.fundPlan;
      overview.openingBalance = state.ledger.financialProfile.openingBalances[fund.id] ?? overview.openingBalance;
      const shared = state.sharedFunds[fund.id];
      if (shared) {
        shared.content.fund = { ...shared.content.fund, name: current.name, color: current.color, cat: current.cat };
        shared.content.fundPlan = overview.fundPlan;
        shared.content.openingBalance = overview.openingBalance;
      }
    };
    if (fund.sharing) {
      void mutateSharedLedger(fund.id, recipe, (revision) => api.updateSharedFund(fund.id, revision, patch), {
        refresh: "none",
        reconcile,
      })
        .catch(() => undefined);
    } else {
      mutateLedger(recipe, (expectedRevision) => api.updateFund(fund.id, patch, expectedRevision), {
        refresh: "none",
        reconcile,
      });
    }
  };

  return (
    <Modal title="Quản lý quỹ" onClose={onClose} wide footer={<button className="btn" type="button" onClick={onClose}>Đóng</button>}>
      <div className="manager-list">
        {ledger.funds.map((fund, index) => (
          <div className="manager-row" key={fund.id}>
            <div className="reorder-actions">
              <button type="button" aria-label={`Đưa ${fund.name} lên`} disabled={index === 0 || Boolean(fund.sharing)} onClick={() => move(index, -1)}>↑</button>
              <button type="button" aria-label={`Đưa ${fund.name} xuống`} disabled={index === ledger.funds.length - 1 || Boolean(fund.sharing)} onClick={() => move(index, 1)}>↓</button>
            </div>
            <input disabled={fund.sharing?.role === "viewer"} type="color" value={fund.color} aria-label={`Màu ${fund.name}`} onChange={(event) => {
              const next = event.target.value;
              updateFund(fund, { color: next }, (draft) => { draft.funds[index]!.color = next; });
            }} />
            <input disabled={fund.sharing?.role === "viewer"} value={fund.name} aria-label={`Tên ${fund.name}`} onChange={(event) => updateLedger((draft) => { draft.funds[index]!.name = event.target.value; })} onBlur={(event) => {
              const next = event.currentTarget.value.trim();
              if (next) updateFund(fund, { name: next }, (draft) => { draft.funds[index]!.name = next; });
            }} />
            <Select<FundCategory>
              value={fund.cat}
              options={Object.entries(FUND_CATEGORIES).map(([id, item]) => ({ value: id as FundCategory, label: item.short }))}
              onValueChange={(cat) => { if (fund.sharing?.role !== "viewer") updateFund(fund, { category: cat }, (draft) => { draft.funds[index]!.cat = cat; }); }}
              ariaLabel={`Loại quỹ ${fund.name}`}
            />
            <small>{fund.sharing ? (fund.sharing.role === "owner" ? "Đang chia sẻ" : `Chia sẻ bởi ${fund.sharing.ownerName}`) : "Cá nhân"}</small>
            {(!fund.sharing || fund.sharing.role === "owner") ? <button className="btn sm" type="button" onClick={() => onShare(fund.id)}>{fund.sharing ? "Thành viên" : "Chia sẻ"}</button> : null}
            <button className="btn sm danger" type="button" disabled={ledger.funds.length <= 1 || (fund.sharing?.role !== undefined && fund.sharing.role !== "owner")} onClick={() => void remove(fund)}>Xóa</button>
          </div>
        ))}
      </div>
      <div className="manager-add">
        <input type="color" value={color} aria-label="Màu quỹ mới" onChange={(event) => setColor(event.target.value)} />
        <input value={name} placeholder="Tên quỹ mới" onChange={(event) => setName(event.target.value)} />
        <Select<FundCategory>
          value={category}
          options={Object.entries(FUND_CATEGORIES).map(([id, item]) => ({ value: id as FundCategory, label: item.short }))}
          onValueChange={setCategory}
          ariaLabel="Loại quỹ mới"
        />
        <button className="btn primary" type="button" onClick={add}>+ Thêm</button>
      </div>
    </Modal>
  );
}

function ShareFundModal({ fundId, onClose }: { fundId: string; onClose(): void }) {
  const ledger = useFinanceStore((state) => state.ledger);
  const sharedFunds = useFinanceStore((state) => state.sharedFunds);
  const mutateSharedLedger = useFinanceStore((state) => state.mutateSharedLedger);
  const shareFund = useFinanceStore((state) => state.shareFund);
  const unshareFund = useFinanceStore((state) => state.unshareFund);
  const fund = ledger.funds.find((item) => item.id === fundId)!;
  const shared = sharedFunds[fundId];
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SharedFundRole>("viewer");
  const [message, setMessage] = useState("");
  const [members, setMembers] = useState<SharedFundMembersResponse["members"]>([]);

  const refreshMembers = useCallback(async (): Promise<void> => {
    if (!shared) return;
    try {
      const response = await api.loadSharedFundMembers(fundId);
      setMembers(response.members);
    } catch {
      setMessage("Không tải được danh sách thành viên.");
    }
  }, [fundId, shared]);

  useEffect(() => {
    void refreshMembers();
  }, [refreshMembers]);

  const addMember = async (): Promise<void> => {
    if (!email.trim()) return;
    setMessage("Đang cập nhật…");
    try {
      if (shared) {
        await mutateSharedLedger(fundId, () => undefined, (revision) =>
          api.setSharedFundMember(fundId, email, role, revision), { refresh: "none" });
      } else await shareFund(fundId, email, role);
      if (!shared) { onClose(); return; }
      setEmail("");
      setMessage("Đã cấp quyền truy cập.");
      await refreshMembers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể cấp quyền.");
    }
  };

  const removeMember = async (memberId: string): Promise<void> => {
    if (!shared || !window.confirm("Thu hồi quyền của thành viên này?")) return;
    try {
      await mutateSharedLedger(fundId, () => undefined, async (revision) => {
        return api.removeSharedFundMember(fundId, memberId, revision);
      }, { refresh: "none" });
      setMessage("Đã thu hồi quyền truy cập.");
      await refreshMembers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể thu hồi quyền.");
    }
  };

  const stopSharing = async (): Promise<void> => {
    if (!shared || members.length > 0 || !window.confirm("Ngừng chia sẻ quỹ này? Quỹ sẽ trở lại là quỹ cá nhân.")) return;
    setMessage("Đang chuyển quỹ về cá nhân…");
    try {
      await unshareFund(fundId);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể ngừng chia sẻ quỹ.");
    }
  };

  return (
    <Modal title={`Chia sẻ quỹ — ${fund.name}`} onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Đóng</button>{shared && members.length === 0 ? <button className="btn danger" type="button" onClick={() => void stopSharing()}>Ngừng chia sẻ</button> : null}</>}>
      <p className="hint">Chỉ mời được email Google đã từng đăng nhập ứng dụng. Thành viên xem được toàn bộ dữ liệu của quỹ, không xem thu chi cá nhân.</p>
      <div className="manager-add">
        <input type="email" value={email} placeholder="email@example.com" aria-label="Email thành viên" onChange={(event) => setEmail(event.target.value)} />
        <Select<SharedFundRole> value={role} options={[{ value: "viewer", label: "Chỉ xem" }, { value: "editor", label: "Chỉnh sửa" }]} onValueChange={setRole} ariaLabel="Quyền thành viên" />
        <button className="btn primary" type="button" disabled={!email.trim()} onClick={() => void addMember()}>{shared ? "Cấp quyền" : "Bắt đầu chia sẻ"}</button>
      </div>
      {message ? <p className="hint">{message}</p> : null}
      {members.length ? <div className="manager-list">
        {members.map((member) => <div className="manager-row" key={member.user.sub}>
          <span>{member.user.name || member.user.email}<small>{member.user.email}</small></span>
          <span>{member.role === "editor" ? "Chỉnh sửa" : "Chỉ xem"}</span>
          <button className="btn sm danger" type="button" onClick={() => void removeMember(member.user.sub)}>Thu hồi</button>
        </div>)}
      </div> : shared ? <p className="hint">Chưa có thành viên nào.</p> : null}
    </Modal>
  );
}

function ContributionModal({ fundId, month, onClose }: { fundId: string; month: string; onClose(): void }) {
  const ledger = useFinanceStore((state) => state.ledger);
  const user = useFinanceStore((state) => state.user);
  const sharedFunds = useFinanceStore((state) => state.sharedFunds);
  const mutateSharedLedger = useFinanceStore((state) => state.mutateSharedLedger);
  const fund = ledger.funds.find((item) => item.id === fundId)!;
  const shared = sharedFunds[fundId]!;
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [contributions, setContributions] = useState<SharedFundContributionsResponse | null>(null);
  const entries = contributions?.items ?? [];
  const canContribute = shared.role !== "viewer";
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];

  const refreshContributions = useCallback(async (): Promise<void> => {
    try {
      setContributions(await api.loadSharedFundContributions(fundId, year, monthNumber));
    } catch {
      setMessage("Không tải được các khoản đóng góp.");
    }
  }, [fundId, monthNumber, year]);

  useEffect(() => {
    void refreshContributions();
  }, [refreshContributions]);

  const add = async (): Promise<void> => {
    if (!(amount > 0)) return;
    try {
      await mutateSharedLedger(fundId, () => undefined, (revision) =>
        api.addSharedFundContribution(fundId, month, amount, note, revision), {
        refresh: "none",
        reconcile: (state, result: any) => {
          const shared = state.sharedFunds[fundId];
          if (shared) {
            shared.content.contributions ??= {};
            const key = `${year}-${String(monthNumber).padStart(2, "0")}`;
            shared.content.contributions[key] ??= [];
            shared.content.contributions[key].push(structuredClone(result));
          }
          const overview = state.fundOverview?.funds.find((item: FundOverviewItem) => item.id === fundId);
          if (!overview || state.fundOverview?.year !== year || state.fundOverview.month !== monthNumber) return;
          overview.contributionAmount += result.amount;
          overview.contributionCount += 1;
        },
      });
      setAmount(0);
      setNote("");
      setMessage("Đã ghi nhận khoản gửi của bạn.");
      await refreshContributions();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không thể ghi nhận khoản gửi."); }
  };

  return <Modal title={`Thành viên gửi vào ${fund.name} — ${month}`} onClose={onClose} footer={<button className="btn" type="button" onClick={onClose}>Đóng</button>}>
    <p className="hint">Tổng thành viên gửi: <b>{fmt(entries.reduce((sum, entry) => sum + entry.amount, 0))}</b></p>
    {entries.length ? <div className="manager-list">{entries.map((entry) => {
      const profile = contributions?.contributors[entry.memberId];
      return <div className="manager-row" key={entry.id}><span>{profile?.name || profile?.email || "Thành viên"}{entry.memberId === user?.sub ? " (bạn)" : ""}<small>{new Date(entry.createdAt).toLocaleString("vi-VN")}{entry.note ? ` · ${entry.note}` : ""}</small></span><strong>{fmt(entry.amount)}</strong></div>;
    })}</div> : <p className="hint">Chưa có khoản gửi nào trong tháng này.</p>}
    {canContribute ? <div className="manager-add"><MoneyInput value={amount} allowZero={false} ariaLabel="Số tiền gửi vào quỹ" onCommit={setAmount} /><input value={note} placeholder="Ghi chú (không bắt buộc)" aria-label="Ghi chú khoản gửi" onChange={(event) => setNote(event.target.value)} /><button className="btn primary" type="button" disabled={!amount} onClick={() => void add()}>+ Ghi nhận tiền gửi</button></div> : <p className="hint">Bạn có quyền xem nên không thể ghi nhận khoản gửi.</p>}
    {message ? <p className="hint">{message}</p> : null}
  </Modal>;
}

function FundDetailEditor({ fundId, onClose }: { fundId: string; onClose(): void }) {
  const ledger = useFinanceStore((state) => state.ledger);
  const year = useFinanceStore((state) => state.selectedYear);
  const month = useFinanceStore((state) => state.selectedMonth);
  const persistMarketQuotes = useFinanceStore((state) => state.persistMarketQuotes);
  const mutateLedger = useFinanceStore((state) => state.mutateLedger);
  const mutateSharedLedger = useFinanceStore((state) => state.mutateSharedLedger);
  const fund = ledger.funds.find((item) => item.id === fundId)!;
  const readOnly = fund.sharing?.role === "viewer";
  const category = fundCategory(fund);
  const existing = ledger.years[String(year)]!.details[fundId]?.[month] ?? null;
  const [detail, setDetail] = useState<FundDetail>(() => {
    if (existing) return structuredClone(existing);
    if (category === "gold") return { type: "gold", lots: [] };
    return { type: "hold", lots: [] };
  });
  const [cryptoMatches, setCryptoMatches] = useState<Record<number, CryptoMatch[]>>({});
  const [lookupMessage, setLookupMessage] = useState<Record<number, string>>({});

  const defaultHoldingLot = (): HoldingLot => ({
    ticker: "",
    qty: 0,
    manualPrice: null,
    purchasePrice: null,
    purchaseFxVnd: category === "crypto" ? ledger.market.fx?.usdVnd ?? null : null,
    feeVnd: null,
    ...(category === "stock" ? { exchange: "HOSE" } : {}),
  });
  const defaultGoldLot = (): GoldLot => ({ chi: 0, manualPrice: null, purchasePrice: null, feeVnd: null });

  const save = (): void => {
    let savedAmount = 0;
    let savedDetail: FundDetail = null;
    const recipe = (draft: any): void => {
      const target = draft.years[String(year)]!;
      if (detail?.type === "gold") {
        const lots = detail.lots.filter((lot) => lot.chi > 0 || lot.purchasePrice || lot.manualPrice || lot.feeVnd || lot.note?.trim());
        const next: GoldDetail = { type: "gold", lots: structuredClone(lots) };
        target.details[fundId]![month] = next;
        target.funds[fundId]![month] = Math.round(lots.reduce((sum, lot) => sum + lot.chi * goldLotPriceVnd(draft as any, lot), 0));
        savedDetail = next;
        savedAmount = target.funds[fundId]![month];
      } else if (detail?.type === "hold") {
        const lots = detail.lots.filter((lot) => lot.ticker.trim() || lot.qty > 0 || lot.purchasePrice || lot.manualPrice || lot.feeVnd || lot.note?.trim());
        const next: HoldingDetail = { type: "hold", lots: structuredClone(lots) };
        target.details[fundId]![month] = next;
        const value = lots.reduce((sum, lot) => sum + lot.qty * currentLotPriceVnd(draft as any, lot, category), 0);
        target.funds[fundId]![month] = Math.round(value);
        savedDetail = next;
        savedAmount = target.funds[fundId]![month];
      }
    };
    recipe(structuredClone(ledger));
    const currentAmount = ledger.years[String(year)]!.funds[fundId]?.[month] ?? 0;
    if (savedAmount === currentAmount && JSON.stringify(savedDetail) === JSON.stringify(existing)) {
      onClose();
      return;
    }
    if (fund.sharing) {
      void mutateSharedLedger(fund.id, recipe, (revision) =>
        api.updateSharedFundMonth(fund.id, year, month + 1, revision, { amount: savedAmount, detail: savedDetail }), {
        refresh: "none",
        reconcile: (state, result) => reconcileFundMonth(state, result, true),
      })
        .catch(() => undefined);
    } else {
      mutateLedger(recipe, (expectedRevision) => api.updateFundMonth(fund.id, year, month + 1, { amount: savedAmount, detail: savedDetail }, expectedRevision), {
        refresh: "none",
        reconcile: (state, result) => reconcileFundMonth(state, result, true),
      });
    }
    onClose();
  };

  const holding = detail?.type === "hold" ? detail : null;
  const updateLot = (index: number, patch: Partial<HoldingLot>): void => {
    if (!holding) return;
    const lots = holding.lots.map((lot, itemIndex) => {
      if (itemIndex !== index) return lot;
      const next = { ...lot, ...patch };
      if (patch.ticker !== undefined && patch.ticker !== lot.ticker) delete next.providerId;
      return next;
    });
    setDetail({ ...holding, lots });
  };

  const lookupCrypto = async (index: number, providerId?: string): Promise<void> => {
    if (!holding) return;
    const lot = holding.lots[index];
    const symbol = lot?.ticker.trim().toUpperCase();
    if (!symbol) {
      setLookupMessage((current) => ({ ...current, [index]: "Nhập mã crypto trước khi tra cứu giá." }));
      return;
    }
    setLookupMessage((current) => ({ ...current, [index]: "Đang tra cứu CoinPaprika…" }));
    try {
      const persisted = await persistMarketQuotes({
        assets: [{ type: "crypto", symbol, ...(providerId ? { providerId } : {}) }],
      });
      const response = persisted.quotes;
      const quote = response.crypto[0];
      if (quote) {
        updateLot(index, { ticker: quote.symbol, providerId: quote.providerId });
        setCryptoMatches((current) => ({ ...current, [index]: [] }));
        setLookupMessage((current) => ({ ...current, [index]: `${quote.name} · ${quote.source}` }));
        return;
      }
      const matches = response.matches[`crypto:${symbol}`] ?? [];
      if (matches.length) {
        setCryptoMatches((current) => ({ ...current, [index]: matches }));
        setLookupMessage((current) => ({ ...current, [index]: "Chọn đúng crypto trùng mã để lấy giá tự động." }));
        return;
      }
      setLookupMessage((current) => ({ ...current, [index]: response.errors[0]?.message ?? "Chưa có giá tự động; có thể dùng giá thủ công." }));
    } catch {
      setLookupMessage((current) => ({ ...current, [index]: "Không tra cứu được giá; có thể dùng giá thủ công." }));
    }
  };

  const gold = detail?.type === "gold" ? detail : null;
  const total = gold
    ? gold.lots.reduce((sum, lot) => sum + lot.chi * goldLotPriceVnd(ledger, lot), 0)
    : holding?.lots.reduce((sum, lot) => sum + lot.qty * currentLotPriceVnd(ledger, lot, category), 0) ?? 0;
  const invested = gold
    ? gold.lots.reduce((sum, lot) => sum + goldLotCostVnd(lot), 0)
    : holding?.lots.reduce((sum, lot) => sum + holdingCostVnd(lot, category as "stock" | "crypto"), 0) ?? 0;
  const quoteLabel = category === "gold"
    ? ledger.market.gold ? `${ledger.market.gold.source} · ${fmt(ledger.market.gold.vndPerChi)}/chỉ` : "Chưa có giá vàng tự động"
    : category === "stock"
      ? "Cổ phiếu tự động lấy giá đóng cửa HOSE khi cập nhật giá"
      : ledger.market.fx ? `Crypto quy đổi theo USD/VND ${fmtNumber(ledger.market.fx.usdVnd)}` : "Chưa có tỷ giá USD/VND";

  const updateGoldLot = (index: number, patch: Partial<GoldLot>): void => {
    if (!gold) return;
    setDetail({ ...gold, lots: gold.lots.map((lot, lotIndex) => lotIndex === index ? { ...lot, ...patch } : lot) });
  };
  const removeGoldLot = (index: number): void => {
    if (gold) setDetail({ ...gold, lots: gold.lots.filter((_, lotIndex) => lotIndex !== index) });
  };

  return (
    <Modal title={`${fund.name} — ${MONTHS_FULL[month]} / ${year}`} onClose={onClose} wide footer={<><button className="btn" type="button" onClick={onClose}>Đóng</button>{!readOnly ? <button className="btn primary" type="button" onClick={save}>Lưu</button> : null}</>}>
      <fieldset disabled={readOnly} className={`asset-editor asset-editor-${category}`}>
        <div className="asset-editor-intro">
          <span className="asset-kind">{category === "gold" ? "Vàng" : category === "stock" ? "Cổ phiếu" : "Crypto"}</span>
          <div><b>Giá thị trường</b><span>{quoteLabel}</span></div>
        </div>
        <div className="asset-summary" aria-label="Tổng quan tài sản">
          <div><span>Giá trị hiện tại</span><b>{fmt(total)}</b></div>
          <div><span>Vốn đầu tư</span><b>{fmt(invested)}</b></div>
          <div className={total - invested >= 0 ? "gain" : "loss"}><span>Lãi / lỗ</span><b>{invested ? `${total - invested >= 0 ? "+" : ""}${fmt(total - invested)}` : "—"}</b></div>
        </div>

        <div className="asset-lot-list">
          {gold?.lots.map((lot, index) => {
            const value = lot.chi * goldLotPriceVnd(ledger, lot);
            const cost = goldLotCostVnd(lot);
            return <article className="asset-lot-card" key={index}>
              <div className="asset-lot-heading"><b>Giao dịch vàng #{index + 1}</b><button className="tx-del" type="button" aria-label={`Xóa giao dịch vàng ${index + 1}`} onClick={() => removeGoldLot(index)}>×</button></div>
              <div className="asset-fields">
                <label>Số chỉ<input type="number" min="0" step="0.01" value={lot.chi || ""} onChange={(event) => updateGoldLot(index, { chi: Number(event.target.value) || 0 })} /></label>
                <label>Giá mua (VND/chỉ)<MoneyInput value={lot.purchasePrice ?? 0} ariaLabel={`Giá mua vàng ${index + 1}`} onCommit={(value) => updateGoldLot(index, { purchasePrice: value })} /></label>
                <label>Giá thị trường thủ công (VND/chỉ)<MoneyInput value={lot.manualPrice ?? 0} ariaLabel={`Giá thủ công vàng ${index + 1}`} onCommit={(value) => updateGoldLot(index, { manualPrice: value })} /></label>
                <label>Phí (VND)<MoneyInput value={lot.feeVnd ?? 0} ariaLabel={`Phí vàng ${index + 1}`} onCommit={(value) => updateGoldLot(index, { feeVnd: value })} /></label>
                <label>Ngày mua<input type="date" value={lot.purchasedAt ?? ""} onChange={(event) => updateGoldLot(index, { purchasedAt: event.target.value })} /></label>
                <label className="asset-note">Ghi chú<input value={lot.note ?? ""} onChange={(event) => updateGoldLot(index, { note: event.target.value })} /></label>
              </div>
              <LotMetrics value={value} cost={cost} />
            </article>;
          })}
          {holding?.lots.map((lot, index) => {
            const value = lot.qty * currentLotPriceVnd(ledger, lot, category);
            const cost = holdingCostVnd(lot, category as "stock" | "crypto");
            const crypto = category === "crypto" ? cryptoQuote(ledger, lot) : undefined;
            return <article className="asset-lot-card" key={`${index}-${lot.providerId ?? ""}`}>
              <div className="asset-lot-heading"><b>{category === "stock" ? "Mã cổ phiếu" : "Crypto"} #{index + 1}</b><button className="tx-del" type="button" aria-label={`Xóa dòng ${index + 1}`} onClick={() => setDetail({ ...holding, lots: holding.lots.filter((_, lotIndex) => lotIndex !== index) })}>×</button></div>
              <div className="asset-fields">
                <label>Mã {category === "stock" ? "cổ phiếu" : "crypto"}<input value={lot.ticker} aria-label={`Mã tài sản ${index + 1}`} placeholder={category === "stock" ? "VNM" : "BTC"} onChange={(event) => updateLot(index, { ticker: event.target.value.toUpperCase() })} /></label>
                {category === "stock" ? <label>Sàn giao dịch<input value={lot.exchange ?? "HOSE"} aria-label={`Sàn cổ phiếu ${index + 1}`} onChange={(event) => updateLot(index, { exchange: event.target.value.toUpperCase() })} /></label> : <label>Định danh nguồn giá<input value={crypto ? `${crypto.name} · ${lot.providerId}` : lot.providerId ?? "Chưa khớp"} readOnly /></label>}
                <label>Số lượng<input type="number" min="0" step="any" value={lot.qty || ""} onChange={(event) => updateLot(index, { qty: Number(event.target.value) || 0 })} /></label>
                <label>Giá mua ({category === "crypto" ? "USD" : "VND"})<MoneyInput value={lot.purchasePrice ?? 0} currency={category === "crypto" ? "USD" : "VND"} ariaLabel={`Giá mua ${index + 1}`} onCommit={(value) => updateLot(index, { purchasePrice: value })} /></label>
                {category === "crypto" ? <label>Tỷ giá lúc mua (VND/USD)<MoneyInput value={lot.purchaseFxVnd ?? 0} ariaLabel={`Tỷ giá mua ${index + 1}`} onCommit={(value) => updateLot(index, { purchaseFxVnd: value })} /></label> : null}
                <label>Giá thị trường thủ công ({category === "crypto" ? "USD" : "VND"})<MoneyInput value={lot.manualPrice ?? 0} currency={category === "crypto" ? "USD" : "VND"} ariaLabel={`Giá thủ công ${index + 1}`} onCommit={(value) => updateLot(index, { manualPrice: value })} /></label>
                <label>Phí (VND)<MoneyInput value={lot.feeVnd ?? 0} ariaLabel={`Phí ${index + 1}`} onCommit={(value) => updateLot(index, { feeVnd: value })} /></label>
                <label>Ngày mua<input type="date" value={lot.purchasedAt ?? ""} onChange={(event) => updateLot(index, { purchasedAt: event.target.value })} /></label>
                <label className="asset-note">Ghi chú<input value={lot.note ?? ""} onChange={(event) => updateLot(index, { note: event.target.value })} /></label>
              </div>
              {category === "stock" && lot.exchange && lot.exchange !== "HOSE" ? <p className="asset-quote-warning">Sàn {lot.exchange} chưa có giá tự động; hãy nhập giá thị trường thủ công.</p> : null}
              {category === "crypto" ? <div className="crypto-lookup"><button className="btn sm" type="button" onClick={() => void lookupCrypto(index)}>Tìm giá crypto</button>{lookupMessage[index] ? <span>{lookupMessage[index]}</span> : null}{cryptoMatches[index]?.length ? <div className="crypto-match-list">{cryptoMatches[index].map((match) => <button key={match.id} type="button" onClick={() => void lookupCrypto(index, match.id)}>{match.name} <small>{match.symbol} · #{match.rank ?? "—"}</small></button>)}</div> : null}</div> : null}
              <LotMetrics value={value} cost={cost} />
            </article>;
          })}
        </div>
        <button className="btn sm asset-add" type="button" onClick={() => gold ? setDetail({ ...gold, lots: [...gold.lots, defaultGoldLot()] }) : holding ? setDetail({ ...holding, lots: [...holding.lots, defaultHoldingLot()] }) : undefined}>+ Thêm giao dịch</button>
        <p className="hint">Giá tự động được ưu tiên; giá thị trường thủ công là phương án dự phòng khi nguồn chưa có dữ liệu. Phí chỉ dùng để tính vốn và lãi/lỗ.</p>
      </fieldset>
    </Modal>
  );
}

function LotMetrics({ value, cost }: { value: number; cost: number }) {
  const change = value - cost;
  return <div className="asset-lot-metrics"><span>Giá trị hiện tại <b>{fmt(value)}</b></span><span>Vốn <b>{fmt(cost)}</b></span><span className={change >= 0 ? "gain" : "loss"}>Lãi / lỗ <b>{cost ? `${change >= 0 ? "+" : ""}${fmt(change)}` : "—"}</b></span></div>;
}
