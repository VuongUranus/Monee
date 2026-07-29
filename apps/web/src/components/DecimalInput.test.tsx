import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DecimalInput } from "./DecimalInput";

describe("DecimalInput", () => {
  it.each([
    ["0,1", 0.1],
    ["0.1", 0.1],
    ["1,25", 1.25],
  ])("nhận %s và commit %s", (text, expected) => {
    const onCommit = vi.fn();
    render(<DecimalInput value={0} ariaLabel="Số chỉ" onCommit={onCommit} />);
    const input = screen.getByLabelText("Số chỉ");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(expected);
  });

  it("cho phép xóa về 0", () => {
    const onCommit = vi.fn();
    render(<DecimalInput value={1} ariaLabel="Số chỉ" onCommit={onCommit} />);
    const input = screen.getByLabelText("Số chỉ");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it.each(["-1", "0,123", "abc", "1,2.3"])("không commit giá trị không hợp lệ %s", (text) => {
    const onCommit = vi.fn();
    render(<DecimalInput value={0} ariaLabel="Số chỉ" onCommit={onCommit} />);
    const input = screen.getByLabelText("Số chỉ");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveClass("input-error");
  });

  it("gợi ý bàn phím thập phân trên thiết bị di động", () => {
    render(<DecimalInput value={0} ariaLabel="Số chỉ" onCommit={vi.fn()} />);
    expect(screen.getByLabelText("Số chỉ")).toHaveAttribute("inputmode", "decimal");
  });
});
