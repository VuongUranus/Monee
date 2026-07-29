import { useState } from "react";

interface DecimalInputProps {
  value: number;
  onCommit(value: number): void;
  ariaLabel: string;
  className?: string;
  maxFractionDigits?: number;
  disabled?: boolean;
}

function formatDecimal(value: number, maxFractionDigits: number): string {
  if (!Number.isFinite(value) || value === 0) return "";
  return new Intl.NumberFormat("vi-VN", {
    useGrouping: false,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function decimalPattern(maxFractionDigits: number): RegExp {
  return new RegExp(`^\\d+(?:[.,]\\d{0,${maxFractionDigits}})?$`);
}

function parseDecimal(text: string, maxFractionDigits: number): number | null {
  const normalized = text.trim();
  if (!normalized) return 0;
  if (!decimalPattern(maxFractionDigits).test(normalized)) return null;
  const value = Number(normalized.replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function DecimalInput({
  value,
  onCommit,
  ariaLabel,
  className = "",
  maxFractionDigits = 2,
  disabled = false,
}: DecimalInputProps) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => formatDecimal(value, maxFractionDigits));
  const [invalid, setInvalid] = useState(false);

  const commit = (): void => {
    const parsed = parseDecimal(text, maxFractionDigits);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(parsed);
    setText(formatDecimal(parsed, maxFractionDigits));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      className={`${invalid ? "input-error" : ""} ${className}`.trim()}
      disabled={disabled}
      value={focused || invalid ? text : formatDecimal(value, maxFractionDigits)}
      onFocus={() => {
        setFocused(true);
        if (!invalid) setText(formatDecimal(value, maxFractionDigits));
      }}
      onChange={(event) => {
        const next = event.target.value.replace(/\s/g, "");
        setText(next);
        setInvalid(next !== "" && parseDecimal(next, maxFractionDigits) === null);
      }}
      onBlur={() => {
        commit();
        setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
