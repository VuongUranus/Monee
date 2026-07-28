import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

interface AsyncButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children"> {
  children: ReactNode;
  busyLabel?: ReactNode;
  onAction(): void | Promise<void>;
}

export function AsyncButton({ children, busyLabel = "Đang lưu…", disabled, onAction, ...props }: AsyncButtonProps) {
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await onAction();
    } catch {
      // The API feedback layer and the invoking form surface the error.
    } finally {
      setBusy(false);
    }
  };
  return <button {...props} type={props.type ?? "button"} disabled={disabled || busy} aria-busy={busy} onClick={() => void run()}>
    {busy ? <><span className="button-spinner" aria-hidden="true" />{busyLabel}</> : children}
  </button>;
}
