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

  it("báo số tiền ngay khi nhập và cho phép xóa giá trị", () => {
    const onCommit = vi.fn();
    const onValueChange = vi.fn();
    render(<MoneyInput value={0} ariaLabel="Số tiền" allowZero={false} onCommit={onCommit} onValueChange={onValueChange} />);
    const input = screen.getByLabelText("Số tiền");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "150000" } });
    expect(onValueChange).toHaveBeenLastCalledWith(150_000);

    fireEvent.change(input, { target: { value: "" } });
    expect(onValueChange).toHaveBeenLastCalledWith(0);
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(0);
  });
});
