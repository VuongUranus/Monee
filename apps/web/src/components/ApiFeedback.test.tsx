import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AsyncButton } from "./AsyncButton";
import { ResourceStatus } from "./ResourceStatus";

describe("API feedback components", () => {
  it("khóa đúng nút trong lúc thao tác bất đồng bộ đang chạy", async () => {
    let finish: (() => void) | undefined;
    const action = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<AsyncButton className="btn primary" busyLabel="Đang thêm…" onAction={action}>Thêm</AsyncButton>);

    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Đang thêm…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Đang thêm…" }));
    expect(action).toHaveBeenCalledTimes(1);

    finish?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "Thêm" })).toBeEnabled());
  });

  it("hiển thị trạng thái tải và nút thử lại cho resource", () => {
    const retry = vi.fn();
    const { rerender } = render(<ResourceStatus state="loading" hasData={false} label="dữ liệu thống kê" onRetry={retry} />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải dữ liệu thống kê…");

    rerender(<ResourceStatus state="error" hasData={false} label="dữ liệu thống kê" onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
