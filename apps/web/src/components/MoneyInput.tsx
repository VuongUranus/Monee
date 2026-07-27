import { useLayoutEffect, useRef, useState } from "react";
import {
  evaluateMoneyExpression,
  formatMoneyInputText,
  formatMoneyInputValue,
  moneyExpressionHasDecimal,
  type MoneyCurrency,
} from "@/lib/domain";

interface MoneyInputProps {
  value: number;
  onCommit(value: number): void;
  onValueChange?(value: number): void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  allowZero?: boolean;
  disabled?: boolean;
  currency?: MoneyCurrency;
}

function inputBody(value: string): string {
  return value.replace(/[₫đ\s]/g, "");
}

function differsByAtMostOneCharacter(left: string, right: string): boolean {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let leftEnd = left.length - 1;
  let rightEnd = right.length - 1;
  while (leftEnd >= prefix && rightEnd >= prefix && left[leftEnd] === right[rightEnd]) {
    leftEnd -= 1;
    rightEnd -= 1;
  }
  return leftEnd - prefix + 1 + rightEnd - prefix + 1 <= 1;
}

function countCharacters(value: string, character: string): number {
  return [...value].filter((item) => item === character).length;
}

function indexAfterOccurrence(value: string, character: string, occurrence: number): number | null {
  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== character) continue;
    seen += 1;
    if (seen === occurrence) return index + 1;
  }
  return null;
}

function indexAfterDigit(value: string, occurrence: number): number | null {
  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (!/\d/.test(value[index] ?? "")) continue;
    seen += 1;
    if (seen === occurrence) return index + 1;
  }
  return null;
}

function caretAfterFormatting(source: string, sourceCaret: number, formatted: string, currency: MoneyCurrency): number {
  const beforeCaret = source.slice(0, sourceCaret).replace(/[₫đ\s]/g, "");
  const formattedBody = currency === "VND" && formatted.endsWith("đ") ? formatted.slice(0, -1) : formatted;
  if (!beforeCaret) return 0;

  const previous = beforeCaret.at(-1) ?? "";
  if (/[+\-*/()]/.test(previous)) {
    const position = indexAfterOccurrence(formattedBody, previous, countCharacters(beforeCaret, previous));
    if (position !== null) return position;
  }
  if (previous === "." || previous === ",") {
    const decimalCount = countCharacters(beforeCaret, previous);
    const position = indexAfterOccurrence(formattedBody, ".", decimalCount);
    if (position !== null) return position;
  }

  const digitCount = (beforeCaret.match(/\d/g) ?? []).length;
  const position = digitCount ? indexAfterDigit(formattedBody, digitCount) : null;
  return position ?? formattedBody.length;
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
  currency = "VND",
}: MoneyInputProps) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => formatMoneyInputValue(value, currency));
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const input = inputRef.current;
    if (caret === null || !input || input !== document.activeElement) return;
    pendingCaret.current = null;
    input.setSelectionRange(caret, caret);
  });

  const parseText = (nextText: string): number | null => {
    if (!inputBody(nextText)) return 0;
    const parsed = evaluateMoneyExpression(nextText);
    const validCurrencyAmount = currency === "USD"
      ? Number.isFinite(parsed) && parsed >= 0
      : Number.isFinite(parsed) && parsed >= 0 && Number.isInteger(parsed) && !moneyExpressionHasDecimal(nextText);
    return validCurrencyAmount ? parsed : null;
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
    setText(formatMoneyInputValue(parsed, currency));
  };

  const clampSelectionBeforeSuffix = (input: HTMLInputElement): void => {
    if (currency !== "VND" || !input.value.endsWith("đ")) return;
    const bodyEnd = input.value.length - 1;
    const start = Math.min(input.selectionStart ?? bodyEnd, bodyEnd);
    const end = Math.min(input.selectionEnd ?? bodyEnd, bodyEnd);
    if (start !== input.selectionStart || end !== input.selectionEnd) input.setSelectionRange(start, end);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      className={`money ${invalid ? "input-error" : ""} ${className}`.trim()}
      placeholder={placeholder}
      disabled={disabled}
      value={focused || invalid ? text : formatMoneyInputValue(value, currency)}
      onFocus={(event) => {
        setFocused(true);
        if (!invalid) setText(formatMoneyInputValue(value, currency));
        clampSelectionBeforeSuffix(event.currentTarget);
      }}
      onChange={(event) => {
        const source = event.target.value;
        const sourceBody = inputBody(source);
        const previousBody = inputBody(text);
        const preferGrouping = previousBody.includes(",") && differsByAtMostOneCharacter(previousBody, sourceBody);
        const nextText = formatMoneyInputText(source, currency, preferGrouping);
        const parsed = parseText(nextText);
        setInvalid(parsed === null || (!allowZero && parsed === 0 && Boolean(inputBody(nextText))));
        pendingCaret.current = caretAfterFormatting(source, event.target.selectionStart ?? source.length, nextText, currency);
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
      onSelect={(event) => clampSelectionBeforeSuffix(event.currentTarget)}
    />
  );
}
