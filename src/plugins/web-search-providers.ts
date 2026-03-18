import { createBraveWebSearchProvider } from "../../extensions/brave/src/brave-web-search-provider.js";
import { createFirecrawlWebSearchProvider } from "../../extensions/firecrawl/src/firecrawl-search-provider.js";
import { createGeminiWebSearchProvider } from "../../extensions/google/src/gemini-web-search-provider.js";
import { createKimiWebSearchProvider } from "../../extensions/moonshot/src/kimi-web-search-provider.js";
import { createPerplexityWebSearchProvider } from "../../extensions/perplexity/src/perplexity-web-search-provider.js";
import { createGrokWebSearchProvider } from "../../extensions/xai/src/grok-web-search-provider.js";
import {
  withBundledPluginAllowlistCompat,
  withBundledPluginEnablementCompat,
} from "./bundled-compat.js";
import { normalizePluginsConfig, resolveEffectiveEnableState } from "./config-state.js";
import type { PluginLoadOptions } from "./loader.js";
import { getActivePluginRegistry } from "./runtime.js";
import type { PluginWebSearchProviderEntry } from "./types.js";

const BUNDLED_WEB_SEARCH_ALLOWLIST_COMPAT_PLUGIN_IDS = [
  "brave",
  "firecrawl",
  "google",
  "moonshot",
  "perplexity",
  "xai",
] as const;

const BUNDLED_WEB_SEARCH_PROVIDER_REGISTRY = [
  {
    pluginId: "brave",
    provider: createBraveWebSearchProvider(),
  },
  {
    pluginId: "google",
    provider: createGeminiWebSearchProvider(),
  },
  {
    pluginId: "xai",
    provider: createGrokWebSearchProvider(),
  },
  {
    pluginId: "moonshot",
    provider: createKimiWebSearchProvider(),
  },
  {
    pluginId: "perplexity",
    provider: createPerplexityWebSearchProvider(),
  },
  {
    pluginId: "firecrawl",
    provider: createFirecrawlWebSearchProvider(),
  },
] as const;

export type ResolvedPluginWebSearchProvider = PluginWebSearchProviderEntry;

export function resolvePluginWebSearchProviders(params: {
  config?: PluginLoadOptions["config"];
  workspaceDir?: string;
  env?: PluginLoadOptions["env"];
  bundledAllowlistCompat?: boolean;
}): ResolvedPluginWebSearchProvider[] {
  const allowlistCompat = params.bundledAllowlistCompat
    ? withBundledPluginAllowlistCompat({
        config: params.config,
        pluginIds: BUNDLED_WEB_SEARCH_ALLOWLIST_COMPAT_PLUGIN_IDS,
      })
    : params.config;
  const config = withBundledPluginEnablementCompat({
    config: allowlistCompat,
    pluginIds: BUNDLED_WEB_SEARCH_ALLOWLIST_COMPAT_PLUGIN_IDS,
  });
  const normalizedPlugins = normalizePluginsConfig(config?.plugins);

  return BUNDLED_WEB_SEARCH_PROVIDER_REGISTRY.filter(
    ({ pluginId }) =>
      resolveEffectiveEnableState({
        id: pluginId,
        origin: "bundled",
        config: normalizedPlugins,
        rootConfig: config,
      }).enabled,
  )
    .map((entry) => ({
      ...entry.provider,
      pluginId: entry.pluginId,
    }))
    .toSorted((a, b) => {
      const aOrder = a.autoDetectOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.autoDetectOrder ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return a.id.localeCompare(b.id);
    });
}

export function resolveRuntimeWebSearchProviders(params: {
  config?: PluginLoadOptions["config"];
  workspaceDir?: string;
  env?: PluginLoadOptions["env"];
  bundledAllowlistCompat?: boolean;
}): ResolvedPluginWebSearchProvider[] {
  const runtimeProviders = getActivePluginRegistry()?.webSearchProviders ?? [];
  if (runtimeProviders.length > 0) {
    return runtimeProviders
      .map((entry) => ({
        ...entry.provider,
        pluginId: entry.pluginId,
      }))
      .toSorted((a, b) => {
        const aOrder = a.autoDetectOrder ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.autoDetectOrder ?? Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        return a.id.localeCompare(b.id);
      });
  }
  return resolvePluginWebSearchProviders(params);
}
