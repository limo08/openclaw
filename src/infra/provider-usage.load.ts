import { loadConfig, type OpenClawConfig } from "../config/config.js";
import { resolveFetch } from "./fetch.js";
import { type ProviderAuth, resolveProviderAuths } from "./provider-usage.auth.js";
import {
  fetchClaudeUsage,
  fetchCodexUsage,
  fetchGeminiUsage,
  fetchMinimaxUsage,
  fetchZaiUsage,
} from "./provider-usage.fetch.js";
import {
  DEFAULT_TIMEOUT_MS,
  ignoredErrors,
  PROVIDER_LABELS,
  usageProviders,
  withTimeout,
} from "./provider-usage.shared.js";
import type {
  ProviderUsageSnapshot,
  UsageProviderId,
  UsageSummary,
} from "./provider-usage.types.js";

type UsageSummaryOptions = {
  now?: number;
  timeoutMs?: number;
  providers?: UsageProviderId[];
  auth?: ProviderAuth[];
  agentDir?: string;
  workspaceDir?: string;
  config?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
};

async function fetchProviderUsageSnapshot(params: {
  auth: ProviderAuth;
  config: OpenClawConfig;
  env: NodeJS.ProcessEnv;
  agentDir?: string;
  workspaceDir?: string;
  timeoutMs: number;
  fetchFn: typeof fetch;
}): Promise<ProviderUsageSnapshot> {
  if (params.auth.provider === "xiaomi") {
    return {
      provider: "xiaomi",
      displayName: PROVIDER_LABELS.xiaomi,
      windows: [],
    };
  }

  const { resolveProviderUsageSnapshotWithPlugin } = await import("../plugins/provider-runtime.js");
  const pluginSnapshot = await resolveProviderUsageSnapshotWithPlugin({
    provider: params.auth.provider,
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
    context: {
      config: params.config,
      agentDir: params.agentDir,
      workspaceDir: params.workspaceDir,
      env: params.env,
      provider: params.auth.provider,
      token: params.auth.token,
      accountId: params.auth.accountId,
      timeoutMs: params.timeoutMs,
      fetchFn: params.fetchFn,
    },
  });
  if (pluginSnapshot) {
    return pluginSnapshot;
  }
  switch (params.auth.provider) {
    case "anthropic":
      return await fetchClaudeUsage(params.auth.token, params.timeoutMs, params.fetchFn);
    case "github-copilot": {
      const { fetchCopilotUsage } = await import("../../extensions/github-copilot/usage.js");
      return await fetchCopilotUsage(params.auth.token, params.timeoutMs, params.fetchFn);
    }
    case "google-gemini-cli":
      return await fetchGeminiUsage(
        params.auth.token,
        params.timeoutMs,
        params.fetchFn,
        params.auth.provider,
      );
    case "minimax":
      return await fetchMinimaxUsage(params.auth.token, params.timeoutMs, params.fetchFn);
    case "openai-codex":
      return await fetchCodexUsage(
        params.auth.token,
        params.auth.accountId,
        params.timeoutMs,
        params.fetchFn,
      );
    case "zai":
      return await fetchZaiUsage(params.auth.token, params.timeoutMs, params.fetchFn);
  }
  return {
    provider: params.auth.provider,
    displayName: PROVIDER_LABELS[params.auth.provider],
    windows: [],
    error: "Unsupported provider",
  };
}

export async function loadProviderUsageSummary(
  opts: UsageSummaryOptions = {},
): Promise<UsageSummary> {
  const now = opts.now ?? Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const config = opts.config ?? loadConfig();
  const env = opts.env ?? process.env;
  const fetchFn = resolveFetch(opts.fetch);
  if (!fetchFn) {
    throw new Error("fetch is not available");
  }

  const auths = await resolveProviderAuths({
    providers: opts.providers ?? usageProviders,
    auth: opts.auth,
    agentDir: opts.agentDir,
    config,
    env,
  });
  if (auths.length === 0) {
    return { updatedAt: now, providers: [] };
  }

  const tasks = auths.map((auth) =>
    withTimeout(
      fetchProviderUsageSnapshot({
        auth,
        config,
        env,
        agentDir: opts.agentDir,
        workspaceDir: opts.workspaceDir,
        timeoutMs,
        fetchFn,
      }),
      timeoutMs + 1000,
      {
        provider: auth.provider,
        displayName: PROVIDER_LABELS[auth.provider],
        windows: [],
        error: "Timeout",
      },
    ),
  );

  const snapshots = await Promise.all(tasks);
  const providers = snapshots.filter((entry) => {
    if (entry.windows.length > 0) {
      return true;
    }
    if (!entry.error) {
      return true;
    }
    return !ignoredErrors.has(entry.error);
  });

  return { updatedAt: now, providers };
}
