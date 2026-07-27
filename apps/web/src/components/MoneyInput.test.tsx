import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MoneyInput } from "./MoneyInput";

describe("MoneyInput", () => {
  it("hiển thị VND và định dạng từng toán hạng ngay khi nhập", () => {
    const onCommit = vi.fn();
    render(<MoneyInput value={1_000_000} ariaLabel="Số tiền" onCommit={onCommit} />);
    const input = screen.getByLabelText("Số tiền");
    expect(input).toHaveValue("1,000,000đ");
    input.focus();
    fireEvent.change(input, { target: { value: "1000000+500000" } });
    expect(input).toHaveValue("1,000,000+500,000đ");
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
    expect(input).toHaveValue("150,000đ");
    expect(onValueChange).toHaveBeenLastCalledWith(150_000);

    fireEvent.change(input, { target: { value: "" } });
    expect(onValueChange).toHaveBeenLastCalledWith(0);
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it("đổi dấu phẩy thập phân sang dấu chấm cho USD và giữ giá trị lẻ", () => {
    const onCommit = vi.fn();
    render(<MoneyInput value={0} currency="USD" ariaLabel="Giá USD" onCommit={onCommit} />);
    const input = screen.getByLabelText("Giá USD");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1,1" } });
    expect(input).toHaveValue("1.1");
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(1.1);
  });

  it("hiển thị phần lẻ VND theo quy ước nhưng không commit", () => {
    const onCommit = vi.fn();
    render(<MoneyInput value={0} ariaLabel="Số tiền" onCommit={onCommit} />);
    const input = screen.getByLabelText("Số tiền");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1,1" } });
    expect(input).toHaveValue("1.1đ");
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveClass("input-error");
  });

  it("giữ con trỏ trước hậu tố và tiếp tục gom hàng nghìn", () => {
    render(<MoneyInput value={0} ariaLabel="Số tiền" onCommit={vi.fn()} />);
    const input = screen.getByLabelText<HTMLInputElement>("Số tiền");

    input.focus();
    fireEvent.change(input, { target: { value: "1000", selectionStart: 4 } });
    expect(input).toHaveValue("1,000đ");
    expect(input.selectionStart).toBe(5);

    fireEvent.change(input, { target: { value: "1,0002đ", selectionStart: 6 } });
    expect(input).toHaveValue("10,002đ");
    expect(input.selectionStart).toBe(6);
  });
});
