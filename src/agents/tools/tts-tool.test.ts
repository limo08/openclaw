import { describe, expect, it, vi } from "vitest";

vi.mock("../../auto-reply/tokens.js", () => ({
  SILENT_REPLY_TOKEN: "QUIET_TOKEN",
}));

const { createTtsTool } = await import("./tts-tool.js");

describe("createTtsTool", () => {
  it("uses SILENT_REPLY_TOKEN in guidance text", () => {
    const tool = createTtsTool();
    expect(tool.description).toContain("QUIET_TOKEN");
    expect(tool.description).not.toContain("NO_REPLY");
  });

  it("returns error even when channel arg is provided but no agentChannel", async () => {
    const tool = createTtsTool();
    const result = await tool.execute("test-call", { text: "hello world", channel: "telegram" });
    const firstContent = result.content[0] as { type: string; text: string };
    expect(firstContent.text).toContain("requires a bound");
    expect((result.details as Record<string, unknown>).error).toBe("no_channel");
  });
});
