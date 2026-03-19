// Narrow plugin-sdk surface for the bundled google-antigravity-auth plugin.
// Keep this list additive and scoped to symbols used under extensions/google-antigravity-auth.

export { isWSL2Sync } from "../infra/wsl.js";
export { emptyPluginConfigSchema } from "../plugins/config-schema.js";
export type { OpenClawPluginApi, ProviderAuthContext } from "../plugins/types.js";
export { buildOauthProviderAuthResult } from "./provider-auth-result.js";
