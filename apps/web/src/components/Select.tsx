import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

type SelectValue = string | number;

export interface SelectOption<T extends SelectValue> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SelectProps<T extends SelectValue> {
  value: T;
  options: readonly SelectOption<T>[];
  onValueChange(value: T): void;
  ariaLabel: string;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
}

const menuGap = 8;
const viewportInset = 12;
const preferredMenuHeight = 280;
const minimumMenuHeight = 112;

export function Select<T extends SelectValue>({
  value,
  options,
  onValueChange,
  ariaLabel,
  className,
  compact = false,
  disabled = false,
}: SelectProps<T>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef("");
  const typeaheadTimeoutRef = useRef<number | undefined>(undefined);
  const listboxId = `select-listbox-${useId().replace(/:/g, "")}`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => selectedIndex(options, value));
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const currentIndex = selectedIndex(options, value);
  const selectedOption = options[currentIndex] ?? options[0];

  useEffect(() => () => {
    if (typeaheadTimeoutRef.current !== undefined) window.clearTimeout(typeaheadTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (currentIndex >= 0) setActiveIndex(currentIndex);
  }, [currentIndex]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideInteraction = (event: PointerEvent | FocusEvent): void => {
      const target = event.target as Node | null;
      if (!target || triggerRef.current?.contains(target) || listboxRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    document.addEventListener("focusin", closeOnOutsideInteraction);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideInteraction);
      document.removeEventListener("focusin", closeOnOutsideInteraction);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const availableBelow = window.innerHeight - rect.bottom - viewportInset - menuGap;
      const availableAbove = rect.top - viewportInset - menuGap;
      const placeAbove = availableBelow < minimumMenuHeight && availableAbove > availableBelow;
      const availableHeight = placeAbove ? availableAbove : availableBelow;
      const maxHeight = Math.max(minimumMenuHeight, Math.min(preferredMenuHeight, availableHeight));
      const width = Math.min(Math.max(rect.width, 164), window.innerWidth - viewportInset * 2);
      const left = Math.min(Math.max(viewportInset, rect.left), window.innerWidth - viewportInset - width);

      setMenuStyle(placeAbove
        ? { position: "fixed", left, bottom: window.innerHeight - rect.top + menuGap, width, maxHeight }
        : { position: "fixed", left, top: rect.bottom + menuGap, width, maxHeight });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => focusOption(listboxRef.current, activeIndex));
    return () => window.cancelAnimationFrame(frame);
  }, [activeIndex, open]);

  const closeAndRestoreFocus = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const firstEnabledIndex = (): number => options.findIndex((option) => !option.disabled);
  const lastEnabledIndex = (): number => findEnabledIndex(options, options.length - 1, -1);
  const openAt = (index: number): void => {
    setActiveIndex(index >= 0 ? index : firstEnabledIndex());
    setOpen(true);
  };
  const moveActive = (direction: 1 | -1): void => {
    const fallback = direction === 1 ? firstEnabledIndex() : lastEnabledIndex();
    const next = findEnabledIndex(options, activeIndex + direction, direction);
    setActiveIndex(next >= 0 ? next : fallback);
  };
  const selectActiveOption = (): void => {
    const option = options[activeIndex];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    closeAndRestoreFocus();
  };
  const findTypeaheadMatch = (key: string): number => {
    const nextBuffer = `${typeaheadRef.current}${key}`.toLocaleLowerCase("vi");
    const labels = options.map((option) => option.label.toLocaleLowerCase("vi"));
    let match = labels.findIndex((label, index) => !options[index]?.disabled && label.startsWith(nextBuffer));
    if (match < 0) match = labels.findIndex((label, index) => !options[index]?.disabled && label.startsWith(key.toLocaleLowerCase("vi")));
    typeaheadRef.current = match >= 0 && labels[match]?.startsWith(nextBuffer) ? nextBuffer : key;
    if (typeaheadTimeoutRef.current !== undefined) window.clearTimeout(typeaheadTimeoutRef.current);
    typeaheadTimeoutRef.current = window.setTimeout(() => { typeaheadRef.current = ""; }, 500);
    return match;
  };
  const handleTypeahead = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return false;
    const match = findTypeaheadMatch(event.key);
    if (match < 0) return false;
    event.preventDefault();
    openAt(match);
    return true;
  };
  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (handleTypeahead(event)) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        openAt(findEnabledIndex(options, currentIndex + 1, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        openAt(findEnabledIndex(options, currentIndex - 1, -1));
        break;
      case "Home":
        event.preventDefault();
        openAt(firstEnabledIndex());
        break;
      case "End":
        event.preventDefault();
        openAt(lastEnabledIndex());
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) closeAndRestoreFocus();
        else openAt(currentIndex);
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          closeAndRestoreFocus();
        }
        break;
      default:
        break;
    }
  };
  const handleListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (handleTypeahead(event)) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(firstEnabledIndex());
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(lastEnabledIndex());
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectActiveOption();
        break;
      case "Escape":
        event.preventDefault();
        closeAndRestoreFocus();
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className={`custom-select${compact ? " custom-select-compact" : ""}${className ? ` ${className}` : ""}`}>
      <button
        ref={triggerRef}
        className="select-trigger"
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => {
          if (open) closeAndRestoreFocus();
          else openAt(currentIndex);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="select-trigger-value">{selectedOption?.label ?? "—"}</span>
        <svg className="select-trigger-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.25 5.75 4.75 4.75 4.75-4.75" /></svg>
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={listboxRef}
          id={listboxId}
          className="select-menu"
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle}
          onKeyDown={handleListboxKeyDown}
        >
          {options.map((option, index) => (
            <button
              key={String(option.value)}
              className={`select-option${option.value === value ? " selected" : ""}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-select-option-index={index}
              disabled={option.disabled}
              tabIndex={index === activeIndex ? 0 : -1}
              onFocus={() => setActiveIndex(index)}
              onPointerMove={() => {
                if (!option.disabled) setActiveIndex(index);
              }}
              onClick={() => {
                if (option.disabled) return;
                onValueChange(option.value);
                closeAndRestoreFocus();
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <span className="select-option-check" aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function selectedIndex<T extends SelectValue>(options: readonly SelectOption<T>[], value: T): number {
  return options.findIndex((option) => option.value === value);
}

function findEnabledIndex<T extends SelectValue>(options: readonly SelectOption<T>[], start: number, direction: 1 | -1): number {
  for (let index = start; index >= 0 && index < options.length; index += direction) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function focusOption(listbox: HTMLDivElement | null, index: number): void {
  listbox?.querySelector<HTMLButtonElement>(`[data-select-option-index="${index}"]`)?.focus();
}
