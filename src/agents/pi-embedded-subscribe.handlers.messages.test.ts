import { describe, expect, it } from "vitest";
import {
  buildAssistantStreamData,
  hasAssistantVisibleReply,
  resolveSilentReplyFallbackText,
} from "./pi-embedded-subscribe.handlers.messages.js";

describe("resolveSilentReplyFallbackText", () => {
  it("preserves NO_REPLY unchanged", () => {
    expect(resolveSilentReplyFallbackText("NO_REPLY")).toBe("NO_REPLY");
  });

  it("passes through normal assistant text unchanged", () => {
    expect(resolveSilentReplyFallbackText("normal assistant reply")).toBe("normal assistant reply");
  });

  it("passes through empty string unchanged", () => {
    expect(resolveSilentReplyFallbackText("")).toBe("");
  });
});

describe("hasAssistantVisibleReply", () => {
  it("treats audio-only payloads as visible", () => {
    expect(hasAssistantVisibleReply({ audioAsVoice: true })).toBe(true);
  });

  it("detects text or media visibility", () => {
    expect(hasAssistantVisibleReply({ text: "hello" })).toBe(true);
    expect(hasAssistantVisibleReply({ mediaUrls: ["https://example.com/a.png"] })).toBe(true);
    expect(hasAssistantVisibleReply({})).toBe(false);
  });
});

describe("buildAssistantStreamData", () => {
  it("normalizes media payloads for assistant stream events", () => {
    expect(
      buildAssistantStreamData({
        text: "hello",
        delta: "he",
        mediaUrl: "https://example.com/a.png",
      }),
    ).toEqual({
      text: "hello",
      delta: "he",
      mediaUrls: ["https://example.com/a.png"],
    });
  });
});
