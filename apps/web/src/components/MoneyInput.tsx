import { useState } from "react";
import { evaluateMoneyExpression, fmtNumber } from "@/lib/domain";

interface MoneyInputProps {
  value: number;
  onCommit(value: number): void;
  onValueChange?(value: number): void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  allowZero?: boolean;
  disabled?: boolean;
}

export function MoneyInput({
  value,
  onCommit,
  onValueChange,
  className = "",
  placeholder,
  ariaLabel,
  allowZero = true,
  disabled = false,
}: MoneyInputProps) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(value > 0 ? fmtNumber(value) : "");
  const [invalid, setInvalid] = useState(false);

  const parseText = (nextText: string): number | null => {
    if (!nextText.trim()) return 0;
    const parsed = evaluateMoneyExpression(nextText);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  const commit = (): void => {
    const parsed = parseText(text);
    // A blank value is always allowed while editing, including inputs that
    // require a positive amount before their surrounding form can be saved.
    if (parsed === null || (!allowZero && parsed === 0 && text.trim())) {
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
      disabled={disabled}
      value={focused ? text : value > 0 ? `${fmtNumber(value)} ₫` : ""}
      onFocus={() => {
        setFocused(true);
        setText(value > 0 ? String(value) : "");
      }}
      onChange={(event) => {
        const nextText = event.target.value;
        const parsed = parseText(nextText);
        setInvalid(parsed === null || (!allowZero && parsed === 0 && Boolean(nextText.trim())));
        setText(nextText);
        // Keep forms in sync while the user is typing so dependent controls
        // (such as the add button) do not have to wait for blur. Invalid input
        // is reported as zero, which also lets the user clear a prior amount.
        onValueChange?.(parsed ?? 0);
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
