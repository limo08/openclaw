import type { Api, Model } from "@mariozechner/pi-ai";
import type { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { OpenClawConfig } from "../../config/config.js";
import type { ModelDefinitionConfig } from "../../config/types.js";
import {
  prepareProviderDynamicModel,
  resolveProviderRuntimePlugin,
  runProviderDynamicModel,
  normalizeProviderResolvedModelWithPlugin,
} from "../../plugins/provider-runtime.js";
import { resolveOpenClawAgentDir } from "../agent-paths.js";
import { DEFAULT_CONTEXT_TOKENS } from "../defaults.js";
import { buildModelAliasLines } from "../model-alias-lines.js";
import { isSecretRefHeaderValueMarker } from "../model-auth-markers.js";
import { normalizeModelCompat } from "../model-compat.js";
import { findNormalizedProviderValue, normalizeProviderId } from "../model-selection.js";
import {
  buildSuppressedBuiltInModelError,
  shouldSuppressBuiltInModel,
} from "../model-suppression.js";
import { discoverAuthStorage, discoverModels } from "../pi-model-discovery.js";
import { normalizeResolvedProviderModel } from "./model.provider-normalization.js";

type InlineModelEntry = ModelDefinitionConfig & {
  provider: string;
  baseUrl?: string;
  headers?: Record<string, string>;
};
type InlineProviderConfig = {
  baseUrl?: string;
  api?: ModelDefinitionConfig["api"];
  models?: ModelDefinitionConfig[];
  headers?: unknown;
};

/**
 * Heuristic to detect vision-capable models based on their model ID.
 * OpenRouter models often follow naming patterns that indicate vision support.
 */
function isLikelyVisionModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  // Common vision model patterns:
  // - Models with "vision", "vl", or "visual" in the name
  // - Claude 3+ models (claude-3-*, claude-opus-4-*, claude-sonnet-4-*) except claude-2
  // - GPT-4 vision variants (gpt-4-vision, gpt-4o, gpt-4-turbo)
  // - Gemini models (gemini-1.5-*, gemini-2-*, gemini-pro-vision)
  // - Llama vision models (llava, llama-3.2-*-vision)
  // - Qwen vision models (qwen-vl, qwen2-vl)
  // - Pixtral models
  const visionPatterns = [
    /vision/,
    /\bvl\b/, // "vl" as a separate segment (e.g., qwen-vl, qwen2-vl-72b, MiniMax-VL-01)
    /visual/,
    /claude-3/,
    /claude-opus-4/,
    /claude-sonnet-4/,
    /claude-haiku-4/,
    /gpt-4o/,
    /gpt-4-turbo/,
    /gpt-4-vision/,
    /gemini-1\.5/,
    /gemini-2/,
    /gemini-pro-vision/,
    /gemini-flash/,
    /llava/,
    /llama-3\.2.*vision/,
    /pixtral/,
  ];
  return visionPatterns.some((pattern) => pattern.test(lower));
}

function sanitizeModelHeaders(
  headers: unknown,
  opts?: { stripSecretRefMarkers?: boolean },
): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return undefined;
  }
  const next: Record<string, string> = {};
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (typeof headerValue !== "string") {
      continue;
    }
    if (opts?.stripSecretRefMarkers && isSecretRefHeaderValueMarker(headerValue)) {
      continue;
    }
    next[headerName] = headerValue;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeResolvedModel(params: {
  provider: string;
  model: Model<Api>;
  cfg?: OpenClawConfig;
  agentDir?: string;
}): Model<Api> {
  const pluginNormalized = normalizeProviderResolvedModelWithPlugin({
    provider: params.provider,
    config: params.cfg,
    context: {
      config: params.cfg,
      agentDir: params.agentDir,
      provider: params.provider,
      modelId: params.model.id,
      model: params.model,
    },
  });
  if (pluginNormalized) {
    return normalizeModelCompat(pluginNormalized);
  }
  return normalizeResolvedProviderModel(params);
}

export { buildModelAliasLines };

function resolveConfiguredProviderConfig(
  cfg: OpenClawConfig | undefined,
  provider: string,
): InlineProviderConfig | undefined {
  const configuredProviders = cfg?.models?.providers;
  if (!configuredProviders) {
    return undefined;
  }
  const exactProviderConfig = configuredProviders[provider];
  if (exactProviderConfig) {
    return exactProviderConfig;
  }
  return findNormalizedProviderValue(configuredProviders, provider);
}

function applyConfiguredProviderOverrides(params: {
  discoveredModel: Model<Api>;
  providerConfig?: InlineProviderConfig;
  modelId: string;
}): Model<Api> {
  const { discoveredModel, providerConfig, modelId } = params;
  if (!providerConfig) {
    return {
      ...discoveredModel,
      // Discovered models originate from models.json and may contain persistence markers.
      headers: sanitizeModelHeaders(discoveredModel.headers, { stripSecretRefMarkers: true }),
    };
  }
  const configuredModel = providerConfig.models?.find((candidate) => candidate.id === modelId);
  const discoveredHeaders = sanitizeModelHeaders(discoveredModel.headers, {
    stripSecretRefMarkers: true,
  });
  const providerHeaders = sanitizeModelHeaders(providerConfig.headers, {
    stripSecretRefMarkers: true,
  });
  const configuredHeaders = sanitizeModelHeaders(configuredModel?.headers, {
    stripSecretRefMarkers: true,
  });
  if (!configuredModel && !providerConfig.baseUrl && !providerConfig.api && !providerHeaders) {
    return {
      ...discoveredModel,
      headers: discoveredHeaders,
    };
  }
  const resolvedInput = configuredModel?.input ?? discoveredModel.input;
  const normalizedInput =
    Array.isArray(resolvedInput) && resolvedInput.length > 0
      ? resolvedInput.filter((item) => item === "text" || item === "image")
      : (["text"] as Array<"text" | "image">);

  return {
    ...discoveredModel,
    api: configuredModel?.api ?? providerConfig.api ?? discoveredModel.api,
    baseUrl: providerConfig.baseUrl ?? discoveredModel.baseUrl,
    reasoning: configuredModel?.reasoning ?? discoveredModel.reasoning,
    input: normalizedInput,
    cost: configuredModel?.cost ?? discoveredModel.cost,
    contextWindow: configuredModel?.contextWindow ?? discoveredModel.contextWindow,
    maxTokens: configuredModel?.maxTokens ?? discoveredModel.maxTokens,
    headers:
      discoveredHeaders || providerHeaders || configuredHeaders
        ? {
            ...discoveredHeaders,
            ...providerHeaders,
            ...configuredHeaders,
          }
        : undefined,
    compat: configuredModel?.compat ?? discoveredModel.compat,
  };
}

export function buildInlineProviderModels(
  providers: Record<string, InlineProviderConfig>,
): InlineModelEntry[] {
  return Object.entries(providers).flatMap(([providerId, entry]) => {
    const trimmed = providerId.trim();
    if (!trimmed) {
      return [];
    }
    const providerHeaders = sanitizeModelHeaders(entry?.headers, {
      stripSecretRefMarkers: true,
    });
    return (entry?.models ?? []).map((model) => ({
      ...model,
      provider: trimmed,
      baseUrl: entry?.baseUrl,
      api: model.api ?? entry?.api,
      headers: (() => {
        const modelHeaders = sanitizeModelHeaders((model as InlineModelEntry).headers, {
          stripSecretRefMarkers: true,
        });
        if (!providerHeaders && !modelHeaders) {
          return undefined;
        }
        return {
          ...providerHeaders,
          ...modelHeaders,
        };
      })(),
    }));
  });
}

function resolveExplicitModelWithRegistry(params: {
  provider: string;
  modelId: string;
  modelRegistry: ModelRegistry;
  cfg?: OpenClawConfig;
  agentDir?: string;
}): { kind: "resolved"; model: Model<Api> } | { kind: "suppressed" } | undefined {
  const { provider, modelId, modelRegistry, cfg, agentDir } = params;
  if (shouldSuppressBuiltInModel({ provider, id: modelId })) {
    return { kind: "suppressed" };
  }
  const providerConfig = resolveConfiguredProviderConfig(cfg, provider);
  const model = modelRegistry.find(provider, modelId) as Model<Api> | null;

  if (model) {
    return {
      kind: "resolved",
      model: normalizeResolvedModel({
        provider,
        cfg,
        agentDir,
        model: applyConfiguredProviderOverrides({
          discoveredModel: model,
          providerConfig,
          modelId,
        }),
      }),
    };
  }

  const providers = cfg?.models?.providers ?? {};
  const inlineModels = buildInlineProviderModels(providers);
  const normalizedProvider = normalizeProviderId(provider);
  const inlineMatch = inlineModels.find(
    (entry) => normalizeProviderId(entry.provider) === normalizedProvider && entry.id === modelId,
  );
  if (inlineMatch?.api) {
    return {
      kind: "resolved",
      model: normalizeResolvedModel({
        provider,
        cfg,
        agentDir,
        model: inlineMatch as Model<Api>,
      }),
    };
  }

  return undefined;
}

export function resolveModelWithRegistry(params: {
  provider: string;
  modelId: string;
  modelRegistry: ModelRegistry;
  cfg?: OpenClawConfig;
  agentDir?: string;
}): Model<Api> | undefined {
  const explicitModel = resolveExplicitModelWithRegistry(params);
  if (explicitModel?.kind === "suppressed") {
    return undefined;
  }
  if (explicitModel?.kind === "resolved") {
    return explicitModel.model;
  }

  const { provider, modelId, cfg, modelRegistry, agentDir } = params;
  const normalizedProvider = normalizeProviderId(provider);
  const providerConfig = resolveConfiguredProviderConfig(cfg, provider);
  const pluginDynamicModel = runProviderDynamicModel({
    provider,
    config: cfg,
    context: {
      config: cfg,
      agentDir,
      provider,
      modelId,
      modelRegistry,
      providerConfig,
    },
  });
  if (pluginDynamicModel) {
    return normalizeResolvedModel({
      provider,
      cfg,
      agentDir,
      model: pluginDynamicModel,
    });
  }

  // OpenRouter is a pass-through proxy - any model ID available on OpenRouter
  // should work without being pre-registered in the local catalog.
  // This fallback uses heuristics when the plugin-based capability lookup returns nothing.
  // Note: configured models with provider-level `api` return early via inlineMatch,
  // so we rely on heuristic detection for vision support here, unless explicitly configured.
  if (normalizedProvider === "openrouter") {
    // Honor explicitly configured input from providerConfig.models before applying heuristic.
    const configuredOpenRouterModel = providerConfig?.models?.find(
      (candidate) => candidate.id === modelId,
    );
    const configuredInput = configuredOpenRouterModel?.input
      ? configuredOpenRouterModel.input.filter((item) => item === "text" || item === "image")
      : undefined;
    const resolvedInput: Array<"text" | "image"> =
      configuredInput && configuredInput.length > 0
        ? configuredInput
        : isLikelyVisionModel(modelId)
          ? ["text", "image"]
          : ["text"];

    const providerHeaders = sanitizeModelHeaders(providerConfig?.headers, {
      stripSecretRefMarkers: true,
    });
    const modelHeaders = sanitizeModelHeaders(configuredOpenRouterModel?.headers, {
      stripSecretRefMarkers: true,
    });

    return normalizeResolvedModel({
      provider,
      cfg,
      agentDir,
      model: {
        id: modelId,
        name: modelId,
        api: configuredOpenRouterModel?.api ?? providerConfig?.api ?? "openai-completions",
        provider,
        baseUrl: providerConfig?.baseUrl ?? "https://openrouter.ai/api/v1",
        reasoning: configuredOpenRouterModel?.reasoning ?? false,
        input: resolvedInput,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: configuredOpenRouterModel?.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
        // Align with OPENROUTER_DEFAULT_MAX_TOKENS in models-config.providers.ts
        maxTokens: configuredOpenRouterModel?.maxTokens ?? 8192,
        ...(providerHeaders || modelHeaders
          ? { headers: { ...providerHeaders, ...modelHeaders } }
          : {}),
      } as Model<Api>,
    });
  }

  // Fallback for non-OpenRouter providers with custom providerConfig or mock models.
  // OpenRouter returns early above using isLikelyVisionModel heuristic.
  const configuredModel = providerConfig?.models?.find((candidate) => candidate.id === modelId);
  const providerHeaders = sanitizeModelHeaders(providerConfig?.headers, {
    stripSecretRefMarkers: true,
  });
  const modelHeaders = sanitizeModelHeaders(configuredModel?.headers, {
    stripSecretRefMarkers: true,
  });
  if (providerConfig || modelId.startsWith("mock-")) {
    return normalizeResolvedModel({
      provider,
      cfg,
      agentDir,
      model: {
        id: modelId,
        name: modelId,
        api: providerConfig?.api ?? "openai-responses",
        provider,
        baseUrl: providerConfig?.baseUrl,
        reasoning: configuredModel?.reasoning ?? false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow:
          configuredModel?.contextWindow ??
          providerConfig?.models?.[0]?.contextWindow ??
          DEFAULT_CONTEXT_TOKENS,
        maxTokens:
          configuredModel?.maxTokens ??
          providerConfig?.models?.[0]?.maxTokens ??
          DEFAULT_CONTEXT_TOKENS,
        headers:
          providerHeaders || modelHeaders ? { ...providerHeaders, ...modelHeaders } : undefined,
      } as Model<Api>,
    });
  }

  return undefined;
}

export function resolveModel(
  provider: string,
  modelId: string,
  agentDir?: string,
  cfg?: OpenClawConfig,
): {
  model?: Model<Api>;
  error?: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
} {
  const resolvedAgentDir = agentDir ?? resolveOpenClawAgentDir();
  const authStorage = discoverAuthStorage(resolvedAgentDir);
  const modelRegistry = discoverModels(authStorage, resolvedAgentDir);
  const model = resolveModelWithRegistry({
    provider,
    modelId,
    modelRegistry,
    cfg,
    agentDir: resolvedAgentDir,
  });
  if (model) {
    return { model, authStorage, modelRegistry };
  }

  return {
    error: buildUnknownModelError(provider, modelId),
    authStorage,
    modelRegistry,
  };
}

export async function resolveModelAsync(
  provider: string,
  modelId: string,
  agentDir?: string,
  cfg?: OpenClawConfig,
): Promise<{
  model?: Model<Api>;
  error?: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
}> {
  const resolvedAgentDir = agentDir ?? resolveOpenClawAgentDir();
  const authStorage = discoverAuthStorage(resolvedAgentDir);
  const modelRegistry = discoverModels(authStorage, resolvedAgentDir);
  const explicitModel = resolveExplicitModelWithRegistry({
    provider,
    modelId,
    modelRegistry,
    cfg,
    agentDir: resolvedAgentDir,
  });
  if (explicitModel?.kind === "suppressed") {
    return {
      error: buildUnknownModelError(provider, modelId),
      authStorage,
      modelRegistry,
    };
  }
  if (!explicitModel) {
    const providerPlugin = resolveProviderRuntimePlugin({
      provider,
      config: cfg,
    });
    if (providerPlugin?.prepareDynamicModel) {
      await prepareProviderDynamicModel({
        provider,
        config: cfg,
        context: {
          config: cfg,
          agentDir: resolvedAgentDir,
          provider,
          modelId,
          modelRegistry,
          providerConfig: resolveConfiguredProviderConfig(cfg, provider),
        },
      });
    }
  }
  const model =
    explicitModel?.kind === "resolved"
      ? explicitModel.model
      : resolveModelWithRegistry({
          provider,
          modelId,
          modelRegistry,
          cfg,
          agentDir: resolvedAgentDir,
        });
  if (model) {
    return { model, authStorage, modelRegistry };
  }

  return {
    error: buildUnknownModelError(provider, modelId),
    authStorage,
    modelRegistry,
  };
}

/**
 * Build a more helpful error when the model is not found.
 *
 * Local providers (ollama, vllm) need a dummy API key to be registered.
 * Users often configure `agents.defaults.model.primary: "ollama/…"` but
 * forget to set `OLLAMA_API_KEY`, resulting in a confusing "Unknown model"
 * error.  This detects known providers that require opt-in auth and adds
 * a hint.
 *
 * See: https://github.com/openclaw/openclaw/issues/17328
 */
const LOCAL_PROVIDER_HINTS: Record<string, string> = {
  ollama:
    "Ollama requires authentication to be registered as a provider. " +
    'Set OLLAMA_API_KEY="ollama-local" (any value works) or run "openclaw configure". ' +
    "See: https://docs.openclaw.ai/providers/ollama",
  vllm:
    "vLLM requires authentication to be registered as a provider. " +
    'Set VLLM_API_KEY (any value works) or run "openclaw configure". ' +
    "See: https://docs.openclaw.ai/providers/vllm",
};

function buildUnknownModelError(provider: string, modelId: string): string {
  const suppressed = buildSuppressedBuiltInModelError({ provider, id: modelId });
  if (suppressed) {
    return suppressed;
  }
  const base = `Unknown model: ${provider}/${modelId}`;
  const hint = LOCAL_PROVIDER_HINTS[provider.toLowerCase()];
  return hint ? `${base}. ${hint}` : base;
}
