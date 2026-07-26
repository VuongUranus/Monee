import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { NavLink, useLocation } from "react-router";
import { BackupModal } from "./BackupModal";
import { Select } from "./Select";
import { api } from "@/lib/api";
import { downloadBackup, ensureYear, mergeSharedFunds, MONTHS_FULL, normalizeStore, years } from "@/lib/domain";
import { useFinanceStore } from "@/store/finance-store";

const pageCopy = {
  funds: {
    title: "Theo dõi quỹ dự phòng & đầu tư",
    subtitle: "Nhập số tiền phân bổ cho từng quỹ theo từng tháng, kèm ghi chú và mục tiêu.",
  },
  expenses: {
    title: "Theo dõi chi tiêu",
    subtitle: "Ghi nhận thu chi theo ngày, theo dõi hạn mức và số dư sau khi trích vào các quỹ.",
  },
  statistics: {
    title: "Thống kê tài chính",
    subtitle: "Tổng hợp thu, chi và tích lũy theo năm để theo dõi xu hướng tài chính cá nhân.",
  },
};

export function AppShell({ children }: PropsWithChildren) {
  const location = useLocation();
  const page = location.pathname.slice(1) as keyof typeof pageCopy;
  const copy = pageCopy[page] ?? pageCopy.expenses;
  const user = useFinanceStore((state) => state.user);
  const ledger = useFinanceStore((state) => state.ledger);
  const sharedFunds = useFinanceStore((state) => state.sharedFunds);
  const year = useFinanceStore((state) => state.selectedYear);
  const month = useFinanceStore((state) => state.selectedMonth);
  const saveState = useFinanceStore((state) => state.saveState);
  const saveMessage = useFinanceStore((state) => state.saveMessage);
  const setPeriod = useFinanceStore((state) => state.setPeriod);
  const replaceLedger = useFinanceStore((state) => state.replaceLedger);
  const logout = useFinanceStore((state) => state.logout);
  const inputRef = useRef<HTMLInputElement>(null);
  const periodPickerRef = useRef<HTMLDivElement>(null);
  const [backup, setBackup] = useState<ReturnType<typeof downloadBackup> | null>(null);
  const [periodOpen, setPeriodOpen] = useState(false);
  const savedYears = years(ledger);
  const currentYear = new Date().getFullYear();
  const firstPickerYear = Math.min(...savedYears, year, currentYear) - 10;
  const lastPickerYear = Math.max(...savedYears, year, currentYear) + 10;
  const availableYears = Array.from({ length: lastPickerYear - firstPickerYear + 1 }, (_, index) => firstPickerYear + index);

  useEffect(() => {
    if (!periodOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!periodPickerRef.current?.contains(target) && !document.querySelector(".select-menu")?.contains(target)) setPeriodOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setPeriodOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [periodOpen]);

  const moveMonth = (direction: number): void => {
    const date = new Date(year, month + direction, 1);
    setPeriod(date.getFullYear(), date.getMonth());
  };

  const importBackup = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      const normalized = normalizeStore(parsed);
      if (!window.confirm("Nhập dữ liệu này sẽ THAY THẾ toàn bộ số liệu hiện tại. Tiếp tục?")) return;
      const now = new Date();
      mergeSharedFunds(normalized.store, Object.values(sharedFunds));
      ensureYear(normalized.store, now.getFullYear());
      replaceLedger(normalized.store);
      setPeriod(now.getFullYear(), now.getMonth());
      window.alert("Đã nhập dữ liệu thành công.");
    } catch {
      window.alert("Tệp không hợp lệ. Hãy chọn bản sao lưu đã xuất từ ứng dụng.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const exportBackup = async (): Promise<void> => {
    try {
      const payload = await api.exportBackup();
      setBackup(downloadBackup(normalizeStore(payload).store));
    } catch {
      window.alert("Không thể xuất sao lưu. Hãy thử lại.");
    }
  };

  return (
    <>
      <header className="masthead">
        <div>
          <p className="eyebrow">Sổ tài chính cá nhân</p>
          <h1>{copy.title}</h1>
          <p className="sub">{copy.subtitle}</p>
        </div>
        <div className="account-menu">
          {user?.picture ? <img className="account-avatar" src={user.picture} alt="" /> : null}
          <span>{user?.name || user?.email}</span>
          <button className="btn sm" type="button" onClick={() => void logout()}>Đăng xuất</button>
        </div>
      </header>

      <main className="container">
        <section className="toolbar top-toolbar">
          {page !== "statistics" ? (
            <div className="period-main">
              <button className="btn period-nav-btn" type="button" aria-label="Tháng trước" onClick={() => moveMonth(-1)}>
                <svg className="period-nav-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m9.75 3.25-4.5 4.5 4.5 4.5" /></svg>
              </button>
              <div
                ref={periodPickerRef}
                className="period-picker"
                onBlur={(event) => {
                  const nextFocus = event.relatedTarget as Node | null;
                  if (!event.currentTarget.contains(nextFocus) && !document.querySelector(".select-menu")?.contains(nextFocus)) setPeriodOpen(false);
                }}
              >
                <button
                  className="btn period-picker-trigger"
                  type="button"
                  aria-expanded={periodOpen}
                  aria-controls="period-picker-popover"
                  onClick={() => setPeriodOpen((open) => !open)}
                >
                  <span>{MONTHS_FULL[month]}, {year}</span>
                  <svg className="period-trigger-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.25 5.75 4.75 4.75 4.75-4.75" /></svg>
                </button>
                {periodOpen ? (
                  <div id="period-picker-popover" className="period-popover" role="dialog" aria-label="Chọn tháng và năm">
                    <p className="period-popover-label">Năm</p>
                    <Select
                      value={year}
                      options={availableYears.map((item) => ({ value: item, label: String(item) }))}
                      onValueChange={(nextYear) => setPeriod(nextYear, month)}
                      ariaLabel="Năm"
                      className="period-year-select"
                    />
                    <p className="period-popover-label">Tháng</p>
                    <div className="month-grid">
                      {MONTHS_FULL.map((label, index) => (
                        <button
                          type="button"
                          key={label}
                          className={index === month ? "active" : ""}
                          onClick={() => {
                            setPeriod(year, index);
                            setPeriodOpen(false);
                          }}
                        >
                          {index + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <button className="btn period-nav-btn" type="button" aria-label="Tháng sau" onClick={() => moveMonth(1)}>
                <svg className="period-nav-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m6.25 3.25 4.5 4.5-4.5 4.5" /></svg>
              </button>
            </div>
          ) : null}
          <span className="spacer" />
          <button className="btn sm" type="button" onClick={() => void exportBackup()}>⬇ Xuất sao lưu</button>
          <button className="btn sm" type="button" onClick={() => inputRef.current?.click()}>⬆ Nhập sao lưu</button>
          <input
            ref={inputRef}
            hidden
            type="file"
            accept="application/json"
            onChange={(event) => void importBackup(event.target.files?.[0])}
          />
          <span className={`save-status ${saveState === "error" ? "error" : ""}`} role="status">{saveMessage}</span>
        </section>

        <nav className="page-nav" aria-label="Điều hướng">
          <NavLink className={({ isActive }) => `page-link ${isActive ? "active" : ""}`} to="/expenses">Chi tiêu</NavLink>
          <NavLink className={({ isActive }) => `page-link ${isActive ? "active" : ""}`} to="/funds">Quỹ</NavLink>
          <NavLink className={({ isActive }) => `page-link ${isActive ? "active" : ""}`} to="/statistics">Thống kê</NavLink>
        </nav>

        {children}
      </main>

      <footer className="site-footer">
        Sao lưu chỉ gồm dữ liệu cá nhân; quỹ chung được quản lý riêng.
      </footer>

      {backup ? <BackupModal {...backup} onClose={() => setBackup(null)} /> : null}
    </>
  );
}
