import { resolveAgentModelPrimaryValue } from "../config/model-input.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { readSessionStoreReadOnly } from "../config/sessions/store-read.js";
import type { SessionEntry } from "../config/sessions/types.js";
import type { OpenClawConfig } from "../config/types.js";
import { listGatewayAgentsBasic } from "../gateway/agent-list.js";
import { resolveHeartbeatSummaryForAgent } from "../infra/heartbeat-summary.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { resolveRuntimeServiceVersion } from "../version.js";
import type { HeartbeatStatus, SessionStatus, StatusSummary } from "./status.types.js";

const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_MODEL = "claude-opus-4-6";
const DEFAULT_CONTEXT_TOKENS = 200_000;
const IGNORED_CHANNEL_CONFIG_KEYS = new Set(["defaults", "modelByChannel"]);

let channelSummaryModulePromise: Promise<typeof import("../infra/channel-summary.js")> | undefined;
let linkChannelModulePromise: Promise<typeof import("./status.link-channel.js")> | undefined;

function loadChannelSummaryModule() {
  channelSummaryModulePromise ??= import("../infra/channel-summary.js");
  return channelSummaryModulePromise;
}

function loadLinkChannelModule() {
  linkChannelModulePromise ??= import("./status.link-channel.js");
  return linkChannelModulePromise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasMeaningfulChannelConfig(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return Object.keys(value).some((key) => key !== "enabled");
}

function hasPotentialConfiguredChannelsForFastSummary(cfg: OpenClawConfig): boolean {
  const channels = isRecord(cfg.channels) ? cfg.channels : null;
  if (!channels) {
    return false;
  }
  for (const [key, value] of Object.entries(channels)) {
    if (IGNORED_CHANNEL_CONFIG_KEYS.has(key)) {
      continue;
    }
    if (hasMeaningfulChannelConfig(value)) {
      return true;
    }
  }
  return false;
}

function resolveFreshSessionTotalTokensForFastSummary(
  entry?: Pick<SessionEntry, "totalTokens" | "totalTokensFresh"> | null,
): number | undefined {
  const total = entry?.totalTokens;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    return undefined;
  }
  if (entry?.totalTokensFresh === false) {
    return undefined;
  }
  return total;
}

function parseStatusModelRef(
  raw: string,
  defaultProvider: string,
): { provider: string; model: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const slash = trimmed.indexOf("/");
  if (slash === -1) {
    return { provider: defaultProvider, model: trimmed };
  }
  const provider = trimmed.slice(0, slash).trim();
  const model = trimmed.slice(slash + 1).trim();
  if (!provider || !model) {
    return null;
  }
  return { provider, model };
}

function resolveConfiguredStatusModelRef(params: {
  cfg: OpenClawConfig;
  defaultProvider: string;
  defaultModel: string;
}): { provider: string; model: string } {
  const rawModel = resolveAgentModelPrimaryValue(params.cfg.agents?.defaults?.model) ?? "";
  if (rawModel) {
    const trimmed = rawModel.trim();
    const configuredModels = params.cfg.agents?.defaults?.models ?? {};
    if (!trimmed.includes("/")) {
      const aliasKey = trimmed.toLowerCase();
      for (const [modelKey, entry] of Object.entries(configuredModels)) {
        const aliasValue = (entry as { alias?: unknown } | undefined)?.alias;
        const alias = typeof aliasValue === "string" ? aliasValue.trim() : "";
        if (!alias || alias.toLowerCase() !== aliasKey) {
          continue;
        }
        const parsed = parseStatusModelRef(modelKey, params.defaultProvider);
        if (parsed) {
          return parsed;
        }
      }
      return { provider: "anthropic", model: trimmed };
    }
    const parsed = parseStatusModelRef(trimmed, params.defaultProvider);
    if (parsed) {
      return parsed;
    }
  }

  const configuredProviders = params.cfg.models?.providers;
  if (configuredProviders && typeof configuredProviders === "object") {
    const hasDefaultProvider = Boolean(configuredProviders[params.defaultProvider]);
    if (!hasDefaultProvider) {
      const availableProvider = Object.entries(configuredProviders).find(
        ([, providerCfg]) =>
          providerCfg &&
          Array.isArray(providerCfg.models) &&
          providerCfg.models.length > 0 &&
          providerCfg.models[0]?.id,
      );
      if (availableProvider) {
        const [providerName, providerCfg] = availableProvider;
        const firstModel = providerCfg.models[0];
        return { provider: providerName, model: firstModel.id };
      }
    }
  }

  return { provider: params.defaultProvider, model: params.defaultModel };
}

function findConfiguredContextWindow(
  cfg: OpenClawConfig,
  provider: string,
  model: string | null,
): number | undefined {
  if (!model) {
    return undefined;
  }
  const providerModels = cfg.models?.providers?.[provider]?.models;
  if (Array.isArray(providerModels)) {
    const configured = providerModels.find((entry) => entry?.id === model);
    if (
      typeof configured?.contextWindow === "number" &&
      Number.isFinite(configured.contextWindow) &&
      configured.contextWindow > 0
    ) {
      return configured.contextWindow;
    }
  }

  const agentModels = cfg.agents?.defaults?.models;
  if (!agentModels || typeof agentModels !== "object") {
    return undefined;
  }
  const qualifiedId = `${provider}/${model}`.toLowerCase();
  for (const [rawKey, entry] of Object.entries(agentModels)) {
    if (rawKey.trim().toLowerCase() !== qualifiedId) {
      continue;
    }
    const contextWindow = (entry as { contextWindow?: unknown } | undefined)?.contextWindow;
    if (typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0) {
      return contextWindow;
    }
  }
  return undefined;
}

function resolveConfiguredModelRefForAgent(
  cfg: OpenClawConfig,
  agentId: string | undefined,
): { provider: string; model: string } {
  const agentModel = cfg.agents?.list?.find((agent) => agent?.id === agentId)?.model;
  const rawModel =
    resolveAgentModelPrimaryValue(agentModel) ??
    resolveAgentModelPrimaryValue(cfg.agents?.defaults?.model) ??
    "";
  if (!rawModel) {
    return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
  }
  const parsed = parseStatusModelRef(rawModel, DEFAULT_PROVIDER);
  return parsed ?? { provider: DEFAULT_PROVIDER, model: rawModel.trim() };
}

function resolveFastSessionModelRef(
  cfg: OpenClawConfig,
  entry:
    | SessionEntry
    | Pick<SessionEntry, "model" | "modelProvider" | "modelOverride" | "providerOverride">
    | undefined,
  agentId?: string,
): { provider: string; model: string } {
  const resolved = resolveConfiguredModelRefForAgent(cfg, agentId);
  const runtimeModel = entry?.model?.trim();
  const runtimeProvider = entry?.modelProvider?.trim();
  if (runtimeModel) {
    if (runtimeProvider) {
      return { provider: runtimeProvider, model: runtimeModel };
    }
    const parsedRuntime = parseStatusModelRef(runtimeModel, resolved.provider);
    return parsedRuntime ?? { provider: resolved.provider, model: runtimeModel };
  }

  const modelOverride = entry?.modelOverride?.trim();
  if (modelOverride) {
    const overrideProvider = entry?.providerOverride?.trim() || resolved.provider;
    const parsedOverride = parseStatusModelRef(modelOverride, overrideProvider);
    return parsedOverride ?? { provider: overrideProvider, model: modelOverride };
  }

  return resolved;
}

function resolveContextTokensForFastSummary(params: {
  cfg: OpenClawConfig;
  provider: string;
  model: string | null;
  contextTokensOverride?: number | null;
  fallbackContextTokens: number;
}): number {
  const override = params.contextTokensOverride;
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return override;
  }
  return (
    findConfiguredContextWindow(params.cfg, params.provider, params.model) ??
    params.fallbackContextTokens
  );
}

function classifySessionKeyForFastSummary(
  key: string,
  entry?: Pick<SessionEntry, "chatType">,
): SessionStatus["kind"] {
  if (key === "global") {
    return "global";
  }
  if (key === "unknown") {
    return "unknown";
  }
  if (entry?.chatType === "group" || entry?.chatType === "channel") {
    return "group";
  }
  if (key.includes(":group:") || key.includes(":channel:")) {
    return "group";
  }
  return "direct";
}

function buildFlags(entry?: SessionEntry): string[] {
  if (!entry) {
    return [];
  }
  const flags: string[] = [];
  const think = entry.thinkingLevel;
  if (typeof think === "string" && think.length > 0) {
    flags.push(`think:${think}`);
  }
  const verbose = entry.verboseLevel;
  if (typeof verbose === "string" && verbose.length > 0) {
    flags.push(`verbose:${verbose}`);
  }
  if (typeof entry.fastMode === "boolean") {
    flags.push(entry.fastMode ? "fast" : "fast:off");
  }
  const reasoning = entry.reasoningLevel;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    flags.push(`reasoning:${reasoning}`);
  }
  const elevated = entry.elevatedLevel;
  if (typeof elevated === "string" && elevated.length > 0) {
    flags.push(`elevated:${elevated}`);
  }
  if (entry.systemSent) {
    flags.push("system");
  }
  if (entry.abortedLastRun) {
    flags.push("aborted");
  }
  if (typeof entry.sessionId === "string" && entry.sessionId.length > 0) {
    flags.push(`id:${entry.sessionId}`);
  }
  return flags;
}

export async function getStatusSummaryForFastJson(params: {
  config: OpenClawConfig;
  sourceConfig?: OpenClawConfig;
}): Promise<StatusSummary> {
  const cfg = params.config;
  const needsChannelPlugins = hasPotentialConfiguredChannelsForFastSummary(cfg);
  const linkContext = needsChannelPlugins
    ? await loadLinkChannelModule().then(({ resolveLinkChannelContext }) =>
        resolveLinkChannelContext(cfg),
      )
    : null;
  const agentList = listGatewayAgentsBasic(cfg);
  const heartbeatAgents: HeartbeatStatus[] = agentList.agents.map((agent) => {
    const summary = resolveHeartbeatSummaryForAgent(cfg, agent.id);
    return {
      agentId: agent.id,
      enabled: summary.enabled,
      every: summary.every,
      everyMs: summary.everyMs,
    };
  });
  const channelSummary = needsChannelPlugins
    ? await loadChannelSummaryModule().then(({ buildChannelSummary }) =>
        buildChannelSummary(cfg, {
          colorize: true,
          includeAllowFrom: true,
          sourceConfig: params.sourceConfig,
        }),
      )
    : [];

  const resolved = resolveConfiguredStatusModelRef({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const configModel = resolved.model ?? DEFAULT_MODEL;
  const configContextTokens = resolveContextTokensForFastSummary({
    cfg,
    provider: resolved.provider ?? DEFAULT_PROVIDER,
    model: configModel,
    contextTokensOverride: cfg.agents?.defaults?.contextTokens,
    fallbackContextTokens: DEFAULT_CONTEXT_TOKENS,
  });

  const now = Date.now();
  const storeCache = new Map<string, Record<string, SessionEntry | undefined>>();
  const loadStore = (storePath: string) => {
    const cached = storeCache.get(storePath);
    if (cached) {
      return cached;
    }
    const store = readSessionStoreReadOnly(storePath);
    storeCache.set(storePath, store);
    return store;
  };
  const buildSessionRows = (
    store: Record<string, SessionEntry | undefined>,
    opts: { agentIdOverride?: string } = {},
  ) =>
    Object.entries(store)
      .filter(([key]) => key !== "global" && key !== "unknown")
      .map(([key, entry]) => {
        const updatedAt = entry?.updatedAt ?? null;
        const age = updatedAt ? now - updatedAt : null;
        const resolvedModel = resolveFastSessionModelRef(cfg, entry, opts.agentIdOverride);
        const model = resolvedModel.model ?? configModel ?? null;
        const contextTokens = resolveContextTokensForFastSummary({
          cfg,
          provider: resolvedModel.provider,
          model,
          contextTokensOverride: entry?.contextTokens,
          fallbackContextTokens: configContextTokens,
        });
        const total = resolveFreshSessionTotalTokensForFastSummary(entry);
        const totalTokensFresh =
          typeof entry?.totalTokens === "number" ? entry.totalTokensFresh !== false : false;
        const remaining =
          contextTokens != null && total !== undefined ? Math.max(0, contextTokens - total) : null;
        const pct =
          contextTokens && contextTokens > 0 && total !== undefined
            ? Math.min(999, Math.round((total / contextTokens) * 100))
            : null;
        const parsedAgentId = parseAgentSessionKey(key)?.agentId;
        const agentId = opts.agentIdOverride ?? parsedAgentId;

        return {
          agentId,
          key,
          kind: classifySessionKeyForFastSummary(key, entry),
          sessionId: entry?.sessionId,
          updatedAt,
          age,
          thinkingLevel: entry?.thinkingLevel,
          fastMode: entry?.fastMode,
          verboseLevel: entry?.verboseLevel,
          reasoningLevel: entry?.reasoningLevel,
          elevatedLevel: entry?.elevatedLevel,
          systemSent: entry?.systemSent,
          abortedLastRun: entry?.abortedLastRun,
          inputTokens: entry?.inputTokens,
          outputTokens: entry?.outputTokens,
          cacheRead: entry?.cacheRead,
          cacheWrite: entry?.cacheWrite,
          totalTokens: total ?? null,
          totalTokensFresh,
          remainingTokens: remaining,
          percentUsed: pct,
          model,
          contextTokens,
          flags: buildFlags(entry),
        } satisfies SessionStatus;
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const paths = new Set<string>();
  const byAgent = agentList.agents.map((agent) => {
    const storePath = resolveStorePath(cfg.session?.store, { agentId: agent.id });
    paths.add(storePath);
    const store = loadStore(storePath);
    const sessions = buildSessionRows(store, { agentIdOverride: agent.id });
    return {
      agentId: agent.id,
      path: storePath,
      count: sessions.length,
      recent: sessions.slice(0, 10),
    };
  });

  const allSessions = Array.from(paths)
    .flatMap((storePath) => buildSessionRows(loadStore(storePath)))
    .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  return {
    runtimeVersion: resolveRuntimeServiceVersion(process.env),
    linkChannel: linkContext
      ? {
          id: linkContext.plugin.id,
          label: linkContext.plugin.meta.label ?? "Channel",
          linked: linkContext.linked,
          authAgeMs: linkContext.authAgeMs,
        }
      : undefined,
    heartbeat: {
      defaultAgentId: agentList.defaultId,
      agents: heartbeatAgents,
    },
    channelSummary,
    queuedSystemEvents: [],
    sessions: {
      paths: Array.from(paths),
      count: allSessions.length,
      defaults: {
        model: configModel ?? null,
        contextTokens: configContextTokens ?? null,
      },
      recent: allSessions.slice(0, 10),
      byAgent,
    },
  };
}
