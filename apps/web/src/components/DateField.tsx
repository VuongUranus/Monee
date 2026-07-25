import { useEffect, useRef, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { vi } from "date-fns/locale";
import { DayPicker, type Matcher } from "react-day-picker";
import "react-day-picker/style.css";

interface DateFieldProps {
  value: string;
  onChange(value: string): void;
  min?: string;
  max?: string;
  className?: string;
  ariaLabel?: string;
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = parseISO(value);
  return isValid(date) ? date : undefined;
}

export function DateField({ value, onChange, min, max, className = "", ariaLabel }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = parseDate(value);
  const minDate = parseDate(min);
  const maxDate = parseDate(max);
  const disabledDays: Matcher[] = [];
  if (minDate) disabledDays.push({ before: minDate });
  if (maxDate) disabledDays.push({ after: maxDate });

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`date-field ${className}`.trim()}>
      <button
        className="date-picker-trigger"
        type="button"
        aria-label={ariaLabel ?? "Chọn ngày"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected ? format(selected, "dd/MM/yyyy", { locale: vi }) : "Chọn ngày"}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" /></svg>
      </button>
      {open ? <div className="date-picker-popover">
        <DayPicker
          animate
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(format(date, "yyyy-MM-dd"));
            setOpen(false);
          }}
          disabled={disabledDays}
          locale={vi}
          weekStartsOn={1}
          showOutsideDays
        />
      </div> : null}
    </div>
  );
}
