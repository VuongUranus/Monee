import { useEffect, useRef } from "react";
import flatpickr from "flatpickr";
import { Vietnamese } from "flatpickr/dist/l10n/vn.js";

interface DateFieldProps {
  value: string;
  onChange(value: string): void;
  min?: string;
  max?: string;
  className?: string;
  ariaLabel?: string;
}

export function DateField({ value, onChange, min, max, className = "", ariaLabel }: DateFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!inputRef.current) return undefined;
    const instance = flatpickr(inputRef.current, {
      locale: Vietnamese,
      dateFormat: "Y-m-d",
      ...(value ? { defaultDate: value } : {}),
      ...(min ? { minDate: min } : {}),
      ...(max ? { maxDate: max } : {}),
      allowInput: true,
      onChange: (_dates, dateString) => onChange(dateString),
    });
    return () => instance.destroy();
  }, [max, min, onChange, value]);

  return (
    <input
      ref={inputRef}
      type="date"
      aria-label={ariaLabel}
      className={`date-picker-input ${className}`.trim()}
      value={value}
      min={min}
      max={max}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
