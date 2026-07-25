import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MoneyInput } from "./MoneyInput";

describe("MoneyInput", () => {
  it("hiển thị VND và commit biểu thức khi blur", () => {
    const onCommit = vi.fn();
    render(<MoneyInput value={1_000_000} ariaLabel="Số tiền" onCommit={onCommit} />);
    const input = screen.getByLabelText("Số tiền");
    expect(input).toHaveValue("1.000.000 ₫");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1000000+500000" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(1_500_000);
  });

  it("không commit chuỗi không hợp lệ", () => {
    const onCommit = vi.fn();
    render(<MoneyInput value={0} ariaLabel="Số tiền" onCommit={onCommit} />);
    const input = screen.getByLabelText("Số tiền");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveClass("input-error");
  });
});
