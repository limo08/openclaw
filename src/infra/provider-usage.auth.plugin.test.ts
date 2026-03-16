import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveProviderUsageAuthWithPluginMock = vi.fn();

vi.mock("../plugins/provider-runtime.js", () => ({
  resolveProviderUsageAuthWithPlugin: (...args: unknown[]) =>
    resolveProviderUsageAuthWithPluginMock(...args),
}));

let resolveProviderAuths: typeof import("./provider-usage.auth.js").resolveProviderAuths;

describe("resolveProviderAuths plugin boundary", () => {
  beforeEach(async () => {
    vi.resetModules();
    resolveProviderUsageAuthWithPluginMock.mockReset();
    resolveProviderUsageAuthWithPluginMock.mockResolvedValue(null);
    ({ resolveProviderAuths } = await import("./provider-usage.auth.js"));
  });

  it("skips plugin resolution when built-in auth is unavailable", async () => {
    await expect(
      resolveProviderAuths({
        providers: ["zai"],
      }),
    ).resolves.toEqual([]);

    expect(resolveProviderUsageAuthWithPluginMock).not.toHaveBeenCalled();
  });

  it("skips plugin resolution when built-in auth can be resolved directly", async () => {
    const prev = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "minimax-test-key";

    try {
      await expect(
        resolveProviderAuths({
          providers: ["minimax"],
        }),
      ).resolves.toEqual([
        {
          provider: "minimax",
          token: "minimax-test-key",
        },
      ]);
    } finally {
      if (prev === undefined) {
        delete process.env.MINIMAX_API_KEY;
      } else {
        process.env.MINIMAX_API_KEY = prev;
      }
    }

    expect(resolveProviderUsageAuthWithPluginMock).not.toHaveBeenCalled();
  });
});
