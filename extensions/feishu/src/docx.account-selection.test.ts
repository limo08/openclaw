import { describe, expect, test, vi } from "vitest";
import type { OpenClawPluginApi } from "../runtime-api.js";
import { registerFeishuDocTools } from "./docx.js";
import { createToolFactoryHarness } from "./tool-factory-test-harness.js";

const createFeishuClientMock = vi.fn((creds: { appId?: string } | undefined) => ({
  __appId: creds?.appId,
  application: {
    scope: {
      list: vi.fn().mockResolvedValue({
        code: 0,
        data: {
          scopes: [],
        },
      }),
    },
  },
}));

vi.mock("./client.js", () => {
  return {
    createFeishuClient: (creds: { appId?: string } | undefined) => createFeishuClientMock(creds),
  };
});

// Patch SDK import so tool execution can run without network concerns.
vi.mock("@larksuiteoapi/node-sdk", () => {
  return {
    default: {},
  };
});

describe("feishu_doc account selection", () => {
  function createDocEnabledConfig(): OpenClawPluginApi["config"] {
    return {
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            a: { appId: "app-a", appSecret: "sec-a", tools: { doc: true } }, // pragma: allowlist secret
            b: { appId: "app-b", appSecret: "sec-b", tools: { doc: true } }, // pragma: allowlist secret
          },
        },
      },
    } as OpenClawPluginApi["config"];
  }

  test("uses agentAccountId context when params omit accountId", async () => {
    const cfg = createDocEnabledConfig();

    const { api, resolveTool } = createToolFactoryHarness(cfg);
    registerFeishuDocTools(api);

    const docToolA = resolveTool("feishu_doc", { agentAccountId: "a" });
    const docToolB = resolveTool("feishu_doc", { agentAccountId: "b" });

    await docToolA.execute("call-a", { action: "list_blocks", doc_token: "d" });
    await docToolB.execute("call-b", { action: "list_blocks", doc_token: "d" });

    expect(createFeishuClientMock).toHaveBeenCalledTimes(2);
    expect(createFeishuClientMock.mock.calls[0]?.[0]?.appId).toBe("app-a");
    expect(createFeishuClientMock.mock.calls[1]?.[0]?.appId).toBe("app-b");
  });

  test("explicit accountId param overrides agentAccountId context", async () => {
    const cfg = createDocEnabledConfig();

    const { api, resolveTool } = createToolFactoryHarness(cfg);
    registerFeishuDocTools(api);

    const docTool = resolveTool("feishu_doc", { agentAccountId: "b" });
    await docTool.execute("call-override", {
      action: "list_blocks",
      doc_token: "d",
      accountId: "a",
    });

    expect(createFeishuClientMock.mock.calls.at(-1)?.[0]?.appId).toBe("app-a");
  });

  test("blocks execution when configured defaultAccount disables doc", async () => {
    const cfg = {
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: "b",
          accounts: {
            a: { appId: "app-a", appSecret: "sec-a", tools: { doc: true } }, // pragma: allowlist secret
            b: { appId: "app-b", appSecret: "sec-b", tools: { doc: false } }, // pragma: allowlist secret
          },
        },
      },
    } as OpenClawPluginApi["config"];

    const { api, resolveTool } = createToolFactoryHarness(cfg);
    registerFeishuDocTools(api);

    const docTool = resolveTool("feishu_doc", { agentAccountId: "a" });
    const result = await docTool.execute("call-disabled", {
      action: "list_blocks",
      doc_token: "d",
    });

    expect(result).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          error: 'Feishu doc is disabled for account "b".',
        }),
      }),
    );
    expect(createFeishuClientMock).not.toHaveBeenCalled();
  });

  test("feishu_app_scopes allows explicit accountId override when defaultAccount disables scopes", async () => {
    const cfg = {
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: "b",
          accounts: {
            a: { appId: "app-a", appSecret: "sec-a", tools: { scopes: true } }, // pragma: allowlist secret
            b: { appId: "app-b", appSecret: "sec-b", tools: { scopes: false } }, // pragma: allowlist secret
          },
        },
      },
    } as OpenClawPluginApi["config"];

    const { api, resolveTool } = createToolFactoryHarness(cfg);
    registerFeishuDocTools(api);

    const scopesTool = resolveTool("feishu_app_scopes", { agentAccountId: "a" });
    await scopesTool.execute("call-enabled", { accountId: "a" });
    const blocked = await scopesTool.execute("call-blocked", {});

    expect(createFeishuClientMock.mock.calls[0]?.[0]?.appId).toBe("app-a");
    expect(blocked).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          error: 'Feishu scopes are disabled for account "b".',
        }),
      }),
    );
  });
});
