import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { resetInboundDedupe } from "openclaw/plugin-sdk/reply-runtime";
import type { MsgContext } from "openclaw/plugin-sdk/reply-runtime";
import type { GetReplyOptions, ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import type { MockFn } from "openclaw/plugin-sdk/testing";
import { beforeEach, vi } from "vitest";
import type { TelegramBotDeps } from "./bot-deps.js";
import {
  Bot as RealBotCtor,
  sequentialize as realSequentialize,
  apiThrottler as realApiThrottler,
} from "./bot.runtime.js";

type AnyMock = ReturnType<typeof vi.fn>;
type AnyAsyncMock = ReturnType<typeof vi.fn>;
type DispatchReplyWithBufferedBlockDispatcherFn =
  typeof import("openclaw/plugin-sdk/reply-runtime").dispatchReplyWithBufferedBlockDispatcher;
type DispatchReplyWithBufferedBlockDispatcherResult = Awaited<
  ReturnType<DispatchReplyWithBufferedBlockDispatcherFn>
>;
type DispatchReplyHarnessParams = {
  ctx: Parameters<DispatchReplyWithBufferedBlockDispatcherFn>[0]["ctx"];
  replyOptions?: Parameters<DispatchReplyWithBufferedBlockDispatcherFn>[0]["replyOptions"];
  dispatcherOptions?: Parameters<DispatchReplyWithBufferedBlockDispatcherFn>[0]["dispatcherOptions"];
};

const { sessionStorePath } = vi.hoisted(() => ({
  sessionStorePath: `/tmp/openclaw-telegram-${process.pid}-${process.env.VITEST_POOL_ID ?? "0"}.json`,
}));

const { loadWebMedia } = vi.hoisted((): { loadWebMedia: AnyMock } => ({
  loadWebMedia: vi.fn(),
}));

export function getLoadWebMediaMock(): AnyMock {
  return loadWebMedia;
}

vi.doMock("openclaw/plugin-sdk/web-media", () => ({
  loadWebMedia,
}));

const { loadConfig, resolveStorePathMock } = vi.hoisted(
  (): {
    loadConfig: MockFn<LoadConfigFn>;
    resolveStorePathMock: MockFn<ResolveStorePathFn>;
  } => ({
    loadConfig: vi.fn<LoadConfigFn>(() => ({})),
    resolveStorePathMock: vi.fn<ResolveStorePathFn>(
      (storePath?: string) => storePath ?? sessionStorePath,
    ),
  }),
);

export function getLoadConfigMock(): AnyMock {
  return loadConfig;
}
vi.doMock("openclaw/plugin-sdk/config-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/config-runtime")>();
  return {
    ...actual,
    loadConfig,
    resolveStorePath: resolveStorePathMock,
  };
});

const { readChannelAllowFromStore, upsertChannelPairingRequest } = vi.hoisted(
  (): {
    readChannelAllowFromStore: MockFn<TelegramBotDeps["readChannelAllowFromStore"]>;
    upsertChannelPairingRequest: AnyAsyncMock;
  } => ({
    readChannelAllowFromStore: vi.fn(async () => [] as string[]),
    upsertChannelPairingRequest: vi.fn(async () => ({
      code: "PAIRCODE",
      created: true,
    })),
  }),
);

export function getReadChannelAllowFromStoreMock(): AnyAsyncMock {
  return readChannelAllowFromStore;
}

export function getUpsertChannelPairingRequestMock(): AnyAsyncMock {
  return upsertChannelPairingRequest;
}

vi.doMock("openclaw/plugin-sdk/conversation-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/conversation-runtime")>();
  return {
    ...actual,
    readChannelAllowFromStore,
    upsertChannelPairingRequest,
  };
});

const skillCommandListHoisted = vi.hoisted(() => ({
  listSkillCommandsForAgents: vi.fn(() => []),
}));
const replySpyHoisted = vi.hoisted(() => ({
  replySpy: vi.fn(async (_ctx: MsgContext, opts?: GetReplyOptions) => {
    await opts?.onReplyStart?.();
    return undefined;
  }) as MockFn<
    (
      ctx: MsgContext,
      opts?: GetReplyOptions,
      configOverride?: OpenClawConfig,
    ) => Promise<ReplyPayload | ReplyPayload[] | undefined>
  >,
}));
const dispatchReplyHoisted = vi.hoisted(() => ({
  dispatchReplyWithBufferedBlockDispatcher: vi.fn<DispatchReplyWithBufferedBlockDispatcherFn>(
    async (params: DispatchReplyHarnessParams) => {
      const result: DispatchReplyWithBufferedBlockDispatcherResult = {
        queuedFinal: false,
        counts: { tool: 0, block: 0, final: 0 },
      };
      await params.dispatcherOptions?.typingCallbacks?.onReplyStart?.();
      const reply = await skillCommandsHoisted.replySpy(params.ctx, params.replyOptions);
      const payloads = reply === undefined ? [] : Array.isArray(reply) ? reply : [reply];
      for (const payload of payloads) {
        await params.dispatcherOptions?.deliver?.(payload, { kind: "final" });
      }
      return { queuedFinal: payloads.length > 0, counts };
    },
  ),
}));
export const listSkillCommandsForAgents = skillCommandListHoisted.listSkillCommandsForAgents;
export const replySpy = replySpyHoisted.replySpy;
export const dispatchReplyWithBufferedBlockDispatcher =
  dispatchReplyHoisted.dispatchReplyWithBufferedBlockDispatcher;

vi.doMock("openclaw/plugin-sdk/reply-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/reply-runtime")>();
  return {
    ...actual,
    listSkillCommandsForAgents: skillCommandListHoisted.listSkillCommandsForAgents,
    getReplyFromConfig: replySpyHoisted.replySpy,
    __replySpy: replySpyHoisted.replySpy,
    dispatchReplyWithBufferedBlockDispatcher:
      dispatchReplyHoisted.dispatchReplyWithBufferedBlockDispatcher,
  };
});

const systemEventsHoisted = vi.hoisted(() => ({
  enqueueSystemEventSpy: vi.fn<TelegramBotDeps["enqueueSystemEvent"]>(() => false),
}));
export const enqueueSystemEventSpy: MockFn<TelegramBotDeps["enqueueSystemEvent"]> =
  systemEventsHoisted.enqueueSystemEventSpy;

vi.doMock("openclaw/plugin-sdk/infra-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/infra-runtime")>();
  return {
    ...actual,
    enqueueSystemEvent: systemEventsHoisted.enqueueSystemEventSpy,
  };
});

const sentMessageCacheHoisted = vi.hoisted(() => ({
  wasSentByBot: vi.fn(() => false),
}));
export const wasSentByBot = sentMessageCacheHoisted.wasSentByBot;

vi.doMock("./sent-message-cache.js", () => ({
  wasSentByBot: sentMessageCacheHoisted.wasSentByBot,
  recordSentMessage: vi.fn(),
  clearSentMessageCache: vi.fn(),
}));

// All spy variables used inside vi.mock("grammy", ...) must be created via
// vi.hoisted() so they are available when the hoisted factory runs, regardless
// of module evaluation order across different test files.
const grammySpies = vi.hoisted(() => ({
  useSpy: vi.fn<(arg: unknown) => void>(),
  middlewareUseSpy: vi.fn<(...args: unknown[]) => unknown>(),
  onSpy: vi.fn<(...args: unknown[]) => unknown>(),
  stopSpy: vi.fn<(...args: unknown[]) => unknown>(),
  commandSpy: vi.fn<(...args: unknown[]) => unknown>(),
  botCtorSpy: vi.fn<(token: string, options?: { client?: { fetch?: typeof fetch } }) => void>(),
  answerCallbackQuerySpy: vi.fn<() => Promise<void>>(),
  sendChatActionSpy: vi.fn<(...args: unknown[]) => unknown>(),
  editMessageTextSpy:
    vi.fn<
      (
        chatId: unknown,
        messageId: unknown,
        text: unknown,
        params?: unknown,
      ) => Promise<{ message_id: number }>
    >(),
  editMessageReplyMarkupSpy:
    vi.fn<
      (chatId: unknown, messageId: unknown, replyMarkup: unknown) => Promise<{ message_id: number }>
    >(),
  sendMessageDraftSpy: vi.fn<() => Promise<boolean>>(),
  setMessageReactionSpy: vi.fn<() => Promise<void>>(),
  setMyCommandsSpy: vi.fn<(commands: unknown) => Promise<void>>(),
  getMeSpy: vi.fn<() => Promise<{ username: string; has_topics_enabled: boolean }>>(),
  sendMessageSpy:
    vi.fn<(chatId: unknown, text: unknown, params?: unknown) => Promise<{ message_id: number }>>(),
  sendAnimationSpy: vi.fn<() => Promise<{ message_id: number }>>(),
  sendPhotoSpy: vi.fn<() => Promise<{ message_id: number }>>(),
  getFileSpy: vi.fn<() => Promise<{ file_path: string }>>(),
}));

export const useSpy: MockFn<(arg: unknown) => void> = grammySpies.useSpy;
export const middlewareUseSpy: AnyMock = grammySpies.middlewareUseSpy;
export const onSpy: AnyMock = grammySpies.onSpy;
export const stopSpy: AnyMock = grammySpies.stopSpy;
export const commandSpy: AnyMock = grammySpies.commandSpy;
export const botCtorSpy: MockFn<
  (token: string, options?: { client?: { fetch?: typeof fetch } }) => void
> = grammySpies.botCtorSpy;
export const answerCallbackQuerySpy: AnyAsyncMock = grammySpies.answerCallbackQuerySpy;
export const sendChatActionSpy: AnyMock = grammySpies.sendChatActionSpy;
export const editMessageTextSpy: AnyAsyncMock = grammySpies.editMessageTextSpy;
export const editMessageReplyMarkupSpy: AnyAsyncMock = grammySpies.editMessageReplyMarkupSpy;
export const sendMessageDraftSpy: AnyAsyncMock = grammySpies.sendMessageDraftSpy;
export const setMessageReactionSpy: AnyAsyncMock = grammySpies.setMessageReactionSpy;
export const setMyCommandsSpy: AnyAsyncMock = grammySpies.setMyCommandsSpy;
export const getMeSpy: AnyAsyncMock = grammySpies.getMeSpy;
export const sendMessageSpy: AnyAsyncMock = grammySpies.sendMessageSpy;
export const sendAnimationSpy: AnyAsyncMock = grammySpies.sendAnimationSpy;
export const sendPhotoSpy: AnyAsyncMock = grammySpies.sendPhotoSpy;
export const getFileSpy: AnyAsyncMock = grammySpies.getFileSpy;

const runnerHoisted = vi.hoisted(() => {
  const sequentializeMiddleware = vi.fn(async (_ctx: unknown, next?: () => Promise<void>) => {
    if (typeof next === "function") {
      await next();
    }
  });
  const sequentializeSpy = vi.fn<() => typeof sequentializeMiddleware>(
    () => sequentializeMiddleware,
  );
  const throttlerSpy = vi.fn(() => "throttler");
  return {
    sequentializeMiddleware,
    sequentializeSpy,
    throttlerSpy,
  };
});
export const sequentializeSpy: typeof runnerHoisted.sequentializeSpy =
  runnerHoisted.sequentializeSpy;
export let sequentializeKey: Parameters<RealSequentialize>[0] | undefined;
export const throttlerSpy: AnyMock = runnerHoisted.throttlerSpy;
type TelegramBotRuntimeForTest = NonNullable<
  Parameters<typeof import("./bot.js").setTelegramBotRuntimeForTest>[0]
>;

type RealSequentialize = typeof realSequentialize;
type RealApiThrottler = typeof realApiThrottler;

const FakeTelegramBotCtor = class {
  api = {
    config: { use: grammySpies.useSpy },
    answerCallbackQuery: grammySpies.answerCallbackQuerySpy,
    sendChatAction: grammySpies.sendChatActionSpy,
    editMessageText: grammySpies.editMessageTextSpy,
    editMessageReplyMarkup: grammySpies.editMessageReplyMarkupSpy,
    sendMessageDraft: grammySpies.sendMessageDraftSpy,
    setMessageReaction: grammySpies.setMessageReactionSpy,
    setMyCommands: grammySpies.setMyCommandsSpy,
    getMe: grammySpies.getMeSpy,
    sendMessage: grammySpies.sendMessageSpy,
    sendAnimation: grammySpies.sendAnimationSpy,
    sendPhoto: grammySpies.sendPhotoSpy,
    getFile: grammySpies.getFileSpy,
  };
  use = grammySpies.middlewareUseSpy;
  on = grammySpies.onSpy;
  stop = grammySpies.stopSpy;
  command = grammySpies.commandSpy;
  catch = vi.fn();
  constructor(
    public token: string,
    public options?: { client?: { fetch?: typeof fetch } },
  ) {
    (
      grammySpies.botCtorSpy as unknown as (
        token: string,
        options?: { client?: { fetch?: typeof fetch } },
      ) => void
    )(token, options);
  }
};

const fakeSequentialize: RealSequentialize = ((keyFn: Parameters<typeof realSequentialize>[0]) => {
  sequentializeKey = keyFn;
  return runnerHoisted.sequentializeMiddleware;
}) as unknown as RealSequentialize;

const fakeApiThrottler: RealApiThrottler = () => {
  const throttle = runnerHoisted.throttlerSpy();
  return throttle as unknown as ReturnType<typeof realApiThrottler>;
};

export const telegramBotRuntimeForTest: TelegramBotRuntimeForTest = {
  Bot: FakeTelegramBotCtor as unknown as TelegramBotRuntimeForTest["Bot"],
  sequentialize: fakeSequentialize,
  apiThrottler: fakeApiThrottler,
};

export const telegramBotDepsForTest = {
  loadConfig,
  resolveStorePath: resolveStorePathMock,
  readChannelAllowFromStore:
    readChannelAllowFromStore as TelegramBotDeps["readChannelAllowFromStore"],
  enqueueSystemEvent: enqueueSystemEventSpy as TelegramBotDeps["enqueueSystemEvent"],
  dispatchReplyWithBufferedBlockDispatcher,
  listSkillCommandsForAgents,
  wasSentByBot,
} as TelegramBotDeps;

vi.doMock("./bot.runtime.js", () => telegramBotRuntimeForTest);

export const getOnHandler = (event: string) => {
  const handler = onSpy.mock.calls.find((call) => call[0] === event)?.[1];
  if (!handler) {
    throw new Error(`Missing handler for event: ${event}`);
  }
  return handler as (ctx: Record<string, unknown>) => Promise<void>;
};

const DEFAULT_TELEGRAM_TEST_CONFIG: OpenClawConfig = {
  agents: {
    defaults: {
      envelopeTimezone: "utc",
    },
  },
  channels: {
    telegram: { dmPolicy: "open", allowFrom: ["*"] },
  },
};

export function makeTelegramMessageCtx(params: {
  chat: {
    id: number;
    type: string;
    title?: string;
    is_forum?: boolean;
  };
  from: { id: number; username?: string };
  text: string;
  date?: number;
  messageId?: number;
  messageThreadId?: number;
}) {
  return {
    message: {
      chat: params.chat,
      from: params.from,
      text: params.text,
      date: params.date ?? 1736380800,
      message_id: params.messageId ?? 42,
      ...(params.messageThreadId === undefined
        ? {}
        : { message_thread_id: params.messageThreadId }),
    },
    me: { username: "openclaw_bot" },
    getFile: async () => ({ download: async () => new Uint8Array() }),
  };
}

export function makeForumGroupMessageCtx(params?: {
  chatId?: number;
  threadId?: number;
  text?: string;
  fromId?: number;
  username?: string;
  title?: string;
}) {
  return makeTelegramMessageCtx({
    chat: {
      id: params?.chatId ?? -1001234567890,
      type: "supergroup",
      title: params?.title ?? "Forum Group",
      is_forum: true,
    },
    from: { id: params?.fromId ?? 12345, username: params?.username ?? "testuser" },
    text: params?.text ?? "hello",
    messageThreadId: params?.threadId,
  });
}

beforeEach(() => {
  resetInboundDedupe();
  loadConfig.mockReset();
  loadConfig.mockReturnValue(DEFAULT_TELEGRAM_TEST_CONFIG);
  resolveStorePathMock.mockReset();
  resolveStorePathMock.mockImplementation((storePath?: string) => storePath ?? sessionStorePath);
  loadWebMedia.mockReset();
  readChannelAllowFromStore.mockReset();
  readChannelAllowFromStore.mockResolvedValue([]);
  upsertChannelPairingRequest.mockReset();
  upsertChannelPairingRequest.mockResolvedValue({ code: "PAIRCODE", created: true } as const);
  onSpy.mockReset();
  commandSpy.mockReset();
  stopSpy.mockReset();
  useSpy.mockReset();
  replySpy.mockReset();
  replySpy.mockImplementation(async (_ctx: MsgContext, opts?: GetReplyOptions) => {
    await opts?.onReplyStart?.();
    return undefined;
  });
  dispatchReplyWithBufferedBlockDispatcher.mockReset();
  dispatchReplyWithBufferedBlockDispatcher.mockImplementation(
    async (params: DispatchReplyHarnessParams) => {
      const result: DispatchReplyWithBufferedBlockDispatcherResult = {
        queuedFinal: false,
        counts: { tool: 0, block: 0, final: 0 },
      };
      await params.dispatcherOptions?.typingCallbacks?.onReplyStart?.();
      const reply = await replySpy(params.ctx, params.replyOptions);
      const payloads = reply === undefined ? [] : Array.isArray(reply) ? reply : [reply];
      const counts: DispatchReplyWithBufferedBlockDispatcherResult["counts"] = {
        block: 0,
        final: payloads.length,
        tool: 0,
      };
      for (const payload of payloads) {
        await params.dispatcherOptions?.deliver?.(payload, { kind: "final" });
      }
      return { queuedFinal: payloads.length > 0, counts };
    },
  );

  sendAnimationSpy.mockReset();
  sendAnimationSpy.mockResolvedValue({ message_id: 78 });
  sendPhotoSpy.mockReset();
  sendPhotoSpy.mockResolvedValue({ message_id: 79 });
  sendMessageSpy.mockReset();
  sendMessageSpy.mockResolvedValue({ message_id: 77 });
  getFileSpy.mockReset();
  getFileSpy.mockResolvedValue({ file_path: "media/file.jpg" });

  setMessageReactionSpy.mockReset();
  setMessageReactionSpy.mockResolvedValue(undefined);
  answerCallbackQuerySpy.mockReset();
  answerCallbackQuerySpy.mockResolvedValue(undefined);
  sendChatActionSpy.mockReset();
  sendChatActionSpy.mockResolvedValue(undefined);
  setMyCommandsSpy.mockReset();
  setMyCommandsSpy.mockResolvedValue(undefined);
  getMeSpy.mockReset();
  getMeSpy.mockResolvedValue({
    username: "openclaw_bot",
    has_topics_enabled: true,
  });
  editMessageTextSpy.mockReset();
  editMessageTextSpy.mockResolvedValue({ message_id: 88 });
  editMessageReplyMarkupSpy.mockReset();
  editMessageReplyMarkupSpy.mockResolvedValue({ message_id: 88 });
  sendMessageDraftSpy.mockReset();
  sendMessageDraftSpy.mockResolvedValue(true);
  enqueueSystemEventSpy.mockReset();
  wasSentByBot.mockReset();
  wasSentByBot.mockReturnValue(false);
  listSkillCommandsForAgents.mockReset();
  listSkillCommandsForAgents.mockReturnValue([]);
  middlewareUseSpy.mockReset();
  runnerHoisted.sequentializeMiddleware.mockReset();
  runnerHoisted.sequentializeMiddleware.mockImplementation(async (_ctx, next) => {
    if (typeof next === "function") {
      await next();
    }
  });
  sequentializeSpy.mockReset();
  sequentializeSpy.mockImplementation(() => runnerHoisted.sequentializeMiddleware);
  botCtorSpy.mockReset();
  sequentializeKey = undefined;
});
