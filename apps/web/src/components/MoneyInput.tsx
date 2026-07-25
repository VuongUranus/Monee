import { useState } from "react";
import { evaluateMoneyExpression, fmtNumber } from "@/lib/domain";

interface MoneyInputProps {
  value: number;
  onCommit(value: number): void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  allowZero?: boolean;
}

export function MoneyInput({
  value,
  onCommit,
  className = "",
  placeholder,
  ariaLabel,
  allowZero = true,
}: MoneyInputProps) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(value > 0 ? fmtNumber(value) : "");
  const [invalid, setInvalid] = useState(false);

  const commit = (): void => {
    const parsed = text.trim() ? evaluateMoneyExpression(text) : 0;
    if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(parsed);
    setText(parsed > 0 ? fmtNumber(parsed) : "");
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      className={`money ${invalid ? "input-error" : ""} ${className}`.trim()}
      placeholder={placeholder}
      value={focused ? text : value > 0 ? `${fmtNumber(value)} ₫` : ""}
      onFocus={() => {
        setFocused(true);
        setText(value > 0 ? String(value) : "");
      }}
      onChange={(event) => {
        setInvalid(false);
        setText(event.target.value);
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
