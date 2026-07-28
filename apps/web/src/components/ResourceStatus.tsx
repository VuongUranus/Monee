import type { ResourceState } from "@/store/finance-store";

interface ResourceStatusProps {
  state: ResourceState;
  hasData: boolean;
  label: string;
  onRetry(): void;
}

export function ResourceStatus({ state, hasData, label, onRetry }: ResourceStatusProps) {
  if (state === "loading") {
    return <div className={hasData ? "resource-status inline" : "resource-status empty"} role="status">
      <span className="loading-spinner" aria-hidden="true" />{hasData ? `Đang cập nhật ${label.toLowerCase()}…` : `Đang tải ${label.toLowerCase()}…`}
    </div>;
  }
  if (state === "error") {
    return <div className={hasData ? "resource-status error inline" : "resource-status error empty"} role="alert">
      <span>{hasData ? `Không thể làm mới ${label.toLowerCase()}.` : `Không thể tải ${label.toLowerCase()}.`}</span>
      <button className="btn sm" type="button" onClick={onRetry}>Thử lại</button>
    </div>;
  }
  return null;
}
