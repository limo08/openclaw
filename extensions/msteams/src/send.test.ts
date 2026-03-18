import type { OpenClawConfig } from "openclaw/plugin-sdk/msteams";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteMessageMSTeams, editMessageMSTeams, sendMessageMSTeams } from "./send.js";

const mockState = vi.hoisted(() => ({
  loadOutboundMediaFromUrl: vi.fn(),
  resolveMSTeamsSendContext: vi.fn(),
  requiresFileConsent: vi.fn(),
  prepareFileConsentActivity: vi.fn(),
  extractFilename: vi.fn(async () => "fallback.bin"),
  sendMSTeamsMessages: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/msteams", () => ({
  loadOutboundMediaFromUrl: mockState.loadOutboundMediaFromUrl,
}));

vi.mock("./send-context.js", () => ({
  resolveMSTeamsSendContext: mockState.resolveMSTeamsSendContext,
}));

vi.mock("./file-consent-helpers.js", () => ({
  requiresFileConsent: mockState.requiresFileConsent,
  prepareFileConsentActivity: mockState.prepareFileConsentActivity,
}));

vi.mock("./media-helpers.js", () => ({
  extractFilename: mockState.extractFilename,
  extractMessageId: () => "message-1",
}));

vi.mock("./messenger.js", () => ({
  sendMSTeamsMessages: mockState.sendMSTeamsMessages,
  buildConversationReference: () => ({}),
}));

vi.mock("./runtime.js", () => ({
  getMSTeamsRuntime: () => ({
    channel: {
      text: {
        resolveMarkdownTableMode: () => "off",
        convertMarkdownTables: (text: string) => text,
      },
    },
  }),
}));

describe("sendMessageMSTeams", () => {
  beforeEach(() => {
    mockState.loadOutboundMediaFromUrl.mockReset();
    mockState.resolveMSTeamsSendContext.mockReset();
    mockState.requiresFileConsent.mockReset();
    mockState.prepareFileConsentActivity.mockReset();
    mockState.extractFilename.mockReset();
    mockState.sendMSTeamsMessages.mockReset();

    mockState.extractFilename.mockResolvedValue("fallback.bin");
    mockState.requiresFileConsent.mockReturnValue(false);
    mockState.resolveMSTeamsSendContext.mockResolvedValue({
      adapter: {},
      appId: "app-id",
      conversationId: "19:conversation@thread.tacv2",
      ref: {},
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "personal",
      tokenProvider: { getAccessToken: vi.fn(async () => "token") },
      mediaMaxBytes: 8 * 1024,
      sharePointSiteId: undefined,
    });
    mockState.sendMSTeamsMessages.mockResolvedValue(["message-1"]);
  });

  it("loads media through shared helper and forwards mediaLocalRoots", async () => {
    const mediaBuffer = Buffer.from("tiny-image");
    mockState.loadOutboundMediaFromUrl.mockResolvedValueOnce({
      buffer: mediaBuffer,
      contentType: "image/png",
      fileName: "inline.png",
      kind: "image",
    });

    await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:conversation@thread.tacv2",
      text: "hello",
      mediaUrl: "file:///tmp/agent-workspace/inline.png",
      mediaLocalRoots: ["/tmp/agent-workspace"],
    });

    expect(mockState.loadOutboundMediaFromUrl).toHaveBeenCalledWith(
      "file:///tmp/agent-workspace/inline.png",
      {
        maxBytes: 8 * 1024,
        mediaLocalRoots: ["/tmp/agent-workspace"],
      },
    );

    expect(mockState.sendMSTeamsMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            text: "hello",
            mediaUrl: `data:image/png;base64,${mediaBuffer.toString("base64")}`,
          }),
        ],
      }),
    );
  });
});

describe("editMessageMSTeams", () => {
  beforeEach(() => {
    mockState.resolveMSTeamsSendContext.mockReset();
  });

  it("calls continueConversation and updateActivity with correct params", async () => {
    const mockUpdateActivity = vi.fn();
    const mockContinueConversation = vi.fn(
      async (_appId: string, _ref: unknown, logic: (ctx: unknown) => Promise<void>) => {
        await logic({
          sendActivity: vi.fn(),
          updateActivity: mockUpdateActivity,
          deleteActivity: vi.fn(),
        });
      },
    );
    mockState.resolveMSTeamsSendContext.mockResolvedValue({
      adapter: { continueConversation: mockContinueConversation },
      appId: "app-id",
      conversationId: "19:conversation@thread.tacv2",
      ref: {
        user: { id: "user-1" },
        agent: { id: "agent-1" },
        conversation: { id: "19:conversation@thread.tacv2", conversationType: "personal" },
        channelId: "msteams",
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "personal",
      tokenProvider: {},
    });

    const result = await editMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:conversation@thread.tacv2",
      activityId: "activity-123",
      text: "Updated message text",
    });

    expect(result.conversationId).toBe("19:conversation@thread.tacv2");
    expect(mockContinueConversation).toHaveBeenCalledTimes(1);
    expect(mockContinueConversation).toHaveBeenCalledWith(
      "app-id",
      expect.objectContaining({ activityId: undefined }),
      expect.any(Function),
    );
    expect(mockUpdateActivity).toHaveBeenCalledWith({
      type: "message",
      id: "activity-123",
      text: "Updated message text",
    });
  });

  it("throws a descriptive error when continueConversation fails", async () => {
    const mockContinueConversation = vi.fn().mockRejectedValue(new Error("Service unavailable"));
    mockState.resolveMSTeamsSendContext.mockResolvedValue({
      adapter: { continueConversation: mockContinueConversation },
      appId: "app-id",
      conversationId: "19:conversation@thread.tacv2",
      ref: {
        user: { id: "user-1" },
        agent: { id: "agent-1" },
        conversation: { id: "19:conversation@thread.tacv2" },
        channelId: "msteams",
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "personal",
      tokenProvider: {},
    });

    await expect(
      editMessageMSTeams({
        cfg: {} as OpenClawConfig,
        to: "conversation:19:conversation@thread.tacv2",
        activityId: "activity-123",
        text: "Updated text",
      }),
    ).rejects.toThrow("msteams edit failed");
  });
});

describe("deleteMessageMSTeams", () => {
  beforeEach(() => {
    mockState.resolveMSTeamsSendContext.mockReset();
  });

  it("calls continueConversation and deleteActivity with correct activityId", async () => {
    const mockDeleteActivity = vi.fn();
    const mockContinueConversation = vi.fn(
      async (_appId: string, _ref: unknown, logic: (ctx: unknown) => Promise<void>) => {
        await logic({
          sendActivity: vi.fn(),
          updateActivity: vi.fn(),
          deleteActivity: mockDeleteActivity,
        });
      },
    );
    mockState.resolveMSTeamsSendContext.mockResolvedValue({
      adapter: { continueConversation: mockContinueConversation },
      appId: "app-id",
      conversationId: "19:conversation@thread.tacv2",
      ref: {
        user: { id: "user-1" },
        agent: { id: "agent-1" },
        conversation: { id: "19:conversation@thread.tacv2", conversationType: "groupChat" },
        channelId: "msteams",
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "groupChat",
      tokenProvider: {},
    });

    const result = await deleteMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:conversation@thread.tacv2",
      activityId: "activity-456",
    });

    expect(result.conversationId).toBe("19:conversation@thread.tacv2");
    expect(mockContinueConversation).toHaveBeenCalledTimes(1);
    expect(mockContinueConversation).toHaveBeenCalledWith(
      "app-id",
      expect.objectContaining({ activityId: undefined }),
      expect.any(Function),
    );
    expect(mockDeleteActivity).toHaveBeenCalledWith("activity-456");
  });

  it("throws a descriptive error when continueConversation fails", async () => {
    const mockContinueConversation = vi.fn().mockRejectedValue(new Error("Not found"));
    mockState.resolveMSTeamsSendContext.mockResolvedValue({
      adapter: { continueConversation: mockContinueConversation },
      appId: "app-id",
      conversationId: "19:conversation@thread.tacv2",
      ref: {
        user: { id: "user-1" },
        agent: { id: "agent-1" },
        conversation: { id: "19:conversation@thread.tacv2" },
        channelId: "msteams",
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "personal",
      tokenProvider: {},
    });

    await expect(
      deleteMessageMSTeams({
        cfg: {} as OpenClawConfig,
        to: "conversation:19:conversation@thread.tacv2",
        activityId: "activity-456",
      }),
    ).rejects.toThrow("msteams delete failed");
  });

  it("passes the appId and proactive ref to continueConversation", async () => {
    const mockContinueConversation = vi.fn(
      async (_appId: string, _ref: unknown, logic: (ctx: unknown) => Promise<void>) => {
        await logic({
          sendActivity: vi.fn(),
          updateActivity: vi.fn(),
          deleteActivity: vi.fn(),
        });
      },
    );
    mockState.resolveMSTeamsSendContext.mockResolvedValue({
      adapter: { continueConversation: mockContinueConversation },
      appId: "my-app-id",
      conversationId: "19:conv@thread.tacv2",
      ref: {
        activityId: "original-activity",
        user: { id: "user-1" },
        agent: { id: "agent-1" },
        conversation: { id: "19:conv@thread.tacv2" },
        channelId: "msteams",
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "personal",
      tokenProvider: {},
    });

    await deleteMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:conv@thread.tacv2",
      activityId: "activity-789",
    });

    // appId should be forwarded correctly
    expect(mockContinueConversation.mock.calls[0]?.[0]).toBe("my-app-id");
    // activityId on the proactive ref should be cleared (undefined) — proactive pattern
    expect(mockContinueConversation.mock.calls[0]?.[1]).toMatchObject({
      activityId: undefined,
    });
  });
});
