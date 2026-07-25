import { useEffect, type PropsWithChildren, type ReactNode } from "react";

interface ModalProps extends PropsWithChildren {
  title: string;
  onClose(): void;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, footer, wide = false, children }: ModalProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="manager-head">
          <h3>{title}</h3>
          <button className="icon-btn" type="button" aria-label="Đóng" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="manager-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
