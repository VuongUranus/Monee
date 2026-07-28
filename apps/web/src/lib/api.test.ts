import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { getApiActivities } from "./api-feedback";

describe("API read requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gộp các GET giống nhau đang chạy thành một request", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = api.loadData();
    const second = api.loadData();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse?.(new Response(JSON.stringify({ workspaceRevision: 1 }), { status: 200 }));
    await expect(first).resolves.toEqual({ workspaceRevision: 1 });
    await expect(second).resolves.toEqual({ workspaceRevision: 1 });

    const third = api.loadData();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveResponse?.(new Response(JSON.stringify({ workspaceRevision: 2 }), { status: 200 }));
    await expect(third).resolves.toEqual({ workspaceRevision: 2 });
  });

  it("lấy phản hồi mới sau khi dữ liệu quỹ thay đổi", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolvers.push(resolve);
    }));
    vi.stubGlobal("fetch", fetchMock);

    const beforeMutation = api.loadFundOverview(2026, 7);
    const afterMutation = api.loadFundOverview(2026, 7, true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolvers[0]?.(new Response(JSON.stringify({ amount: 2_500_000 }), { status: 200 }));
    resolvers[1]?.(new Response(JSON.stringify({ amount: 5_500_000 }), { status: 200 }));

    await expect(beforeMutation).resolves.toEqual({ amount: 2_500_000 });
    await expect(afterMutation).resolves.toEqual({ amount: 5_500_000 });
  });

  it("theo dõi đúng một activity cho GET được gộp và dọn sau khi hoàn tất", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; })));

    const first = api.loadData();
    const second = api.loadData();
    expect(getApiActivities()).toHaveLength(1);
    expect(getApiActivities()[0]).toMatchObject({ kind: "read", scope: "workspace" });

    resolveResponse?.(new Response(JSON.stringify({ workspaceRevision: 3 }), { status: 200 }));
    await Promise.all([first, second]);
    expect(getApiActivities()).toHaveLength(0);
  });
});
