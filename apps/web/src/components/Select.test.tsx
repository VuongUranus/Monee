import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Select } from "./Select";

const options = [
  { value: "low", label: "Thấp" },
  { value: "medium", label: "Trung bình" },
  { value: "high", label: "Cao" },
] as const;

function SelectHarness() {
  const [value, setValue] = useState<(typeof options)[number]["value"]>("low");
  return <Select<(typeof options)[number]["value"]> value={value} options={options} onValueChange={setValue} ariaLabel="Mức ưu tiên" />;
}

describe("Select", () => {
  it("mở danh sách có ngữ nghĩa truy cập được và chọn giá trị", () => {
    render(<SelectHarness />);

    const trigger = screen.getByRole("combobox", { name: "Mức ưu tiên" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: "Mức ưu tiên" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Thấp" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("option", { name: "Cao" }));
    expect(trigger).toHaveTextContent("Cao");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("đóng khi tương tác bên ngoài", async () => {
    render(<SelectHarness />);

    fireEvent.click(screen.getByRole("combobox", { name: "Mức ưu tiên" }));
    expect(screen.getByRole("listbox")).toBeVisible();
    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("hỗ trợ bàn phím, Escape và gõ nhanh", async () => {
    render(<SelectHarness />);

    const trigger = screen.getByRole("combobox", { name: "Mức ưu tiên" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const listbox = screen.getByRole("listbox", { name: "Mức ưu tiên" });
    await waitFor(() => expect(screen.getByRole("option", { name: "Trung bình" })).toHaveFocus());

    fireEvent.keyDown(listbox, { key: "End" });
    await waitFor(() => expect(screen.getByRole("option", { name: "Cao" })).toHaveFocus());
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(trigger).toHaveTextContent("Cao");

    fireEvent.keyDown(trigger, { key: "T" });
    await waitFor(() => expect(screen.getByRole("option", { name: "Thấp" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
