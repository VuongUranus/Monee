import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  dismissToast,
  getApiActivities,
  getToasts,
  subscribeApiActivity,
  subscribeToasts,
} from "@/lib/api-feedback";

export function useApiActivities() {
  return useSyncExternalStore(subscribeApiActivity, getApiActivities, getApiActivities);
}

function useToasts() {
  return useSyncExternalStore(subscribeToasts, getToasts, getToasts);
}

export function ApiProgress() {
  const activities = useApiActivities();
  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState("Đang tải dữ liệu…");
  const visibleSince = useRef(0);
  const hideTimer = useRef<number | null>(null);
  const current = [...activities].sort((left, right) => Number(right.kind === "write") - Number(left.kind === "write"))[0];

  useEffect(() => {
    if (current) {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (!visible) visibleSince.current = Date.now();
      setLabel(current.label);
      setVisible(true);
      return;
    }
    if (!visible) return;
    const remaining = Math.max(0, 300 - (Date.now() - visibleSince.current));
    hideTimer.current = window.setTimeout(() => setVisible(false), remaining);
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [current, visible]);

  if (!visible) return null;
  return <div className="api-progress" role="progressbar" aria-busy="true" aria-label={label} aria-valuetext={label}><span /></div>;
}

export function ToastViewport() {
  const toasts = useToasts();
  return <aside className="toast-viewport" aria-label="Thông báo hệ thống">
    {toasts.map((toast) => <div
      className={`toast ${toast.kind}`}
      key={toast.id}
      role={toast.kind === "error" ? "alert" : undefined}
      aria-live={toast.kind === "success" ? "polite" : undefined}
    >
      <span>{toast.message}</span>
      <button type="button" aria-label="Đóng thông báo" onClick={() => dismissToast(toast.id)}>×</button>
    </div>)}
  </aside>;
}
