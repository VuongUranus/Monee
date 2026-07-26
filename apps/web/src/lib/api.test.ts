import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

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
});
