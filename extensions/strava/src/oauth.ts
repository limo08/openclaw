import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { StravaConfig, StravaTokens } from "./types.js";

const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/api/v3/oauth/token";

/** Build the Strava OAuth authorization URL with a CSRF state nonce. */
export function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  scope = "activity:read_all",
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    approval_prompt: "auto",
    state,
  });
  return `${STRAVA_AUTH_URL}?${params.toString()}`;
}

/** Generate a random state nonce for OAuth CSRF protection. */
export function generateOAuthState(): string {
  return crypto.randomBytes(24).toString("hex");
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(config: StravaConfig, code: string): Promise<StravaTokens> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete: { id: number };
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    athleteId: String(data.athlete.id),
  };
}

/** Error from a token refresh attempt, with HTTP status for triage. */
export class StravaRefreshError extends Error {
  status = 0;
}

/** Refresh an expired access token. Returns new token pair (refresh token rotates). */
export async function refreshTokens(
  config: StravaConfig,
  refreshToken: string,
): Promise<StravaTokens> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new StravaRefreshError(`Strava token refresh failed (${res.status}): ${text}`);
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  // Refresh response doesn't include athlete — we'll preserve the existing athleteId in the store.
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    athleteId: "", // caller must merge with existing athleteId
  };
}

const TOKEN_FILE = "strava-tokens.json";
const STATE_FILE = "oauth-state.json";

/** Persistent token store backed by a JSON file. */
export class TokenStore {
  private dir: string;

  constructor(stateDir: string) {
    this.dir = stateDir;
  }

  private filePath(): string {
    return path.join(this.dir, TOKEN_FILE);
  }

  private statePath(): string {
    return path.join(this.dir, STATE_FILE);
  }

  save(tokens: StravaTokens): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.filePath(), JSON.stringify(tokens, null, 2), { mode: 0o600 });
  }

  load(): StravaTokens | null {
    try {
      const raw = fs.readFileSync(this.filePath(), "utf-8");
      return JSON.parse(raw) as StravaTokens;
    } catch {
      return null;
    }
  }

  clear(): void {
    try {
      fs.unlinkSync(this.filePath());
    } catch {
      // already gone
    }
  }

  /** Store an OAuth state nonce for CSRF validation. Keeps the last 5 nonces so
   *  multiple auth URLs can be valid concurrently (e.g. agent asks twice, user
   *  opens a second tab). */
  saveState(state: string): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const existing = this.loadStates();
    // Keep most recent 4 + the new one = 5 max.
    const states = [...existing.slice(-4), state];
    fs.writeFileSync(this.statePath(), JSON.stringify({ states }), { mode: 0o600 });
  }

  /** Check if a state nonce is valid and consume it. Returns true if matched. */
  consumeState(state: string): boolean {
    const states = this.loadStates();
    const idx = states.indexOf(state);
    if (idx === -1) return false;
    states.splice(idx, 1);
    try {
      if (states.length === 0) {
        fs.unlinkSync(this.statePath());
      } else {
        fs.writeFileSync(this.statePath(), JSON.stringify({ states }), { mode: 0o600 });
      }
    } catch {
      // best-effort cleanup
    }
    return true;
  }

  private loadStates(): string[] {
    try {
      const raw = fs.readFileSync(this.statePath(), "utf-8");
      const data = JSON.parse(raw) as { state?: string; states?: string[] };
      // Handle legacy single-state format gracefully.
      if (data.states) return [...data.states];
      if (data.state) return [data.state];
      return [];
    } catch {
      return [];
    }
  }
}

/** Margin in seconds before expiry to trigger a proactive refresh. */
const REFRESH_MARGIN_SEC = 300; // 5 minutes

/**
 * Return a valid access token, refreshing if needed.
 * Returns null if no tokens are stored (user hasn't connected).
 */
export async function ensureFreshToken(
  store: TokenStore,
  config: StravaConfig,
): Promise<string | null> {
  const tokens = store.load();
  if (!tokens) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (tokens.expiresAt - nowSec > REFRESH_MARGIN_SEC) {
    return tokens.accessToken;
  }

  // Token expired or about to — refresh it.
  const refreshed = await refreshTokens(config, tokens.refreshToken);
  const updated: StravaTokens = {
    ...refreshed,
    athleteId: tokens.athleteId, // preserve athlete ID
  };
  store.save(updated);
  return updated.accessToken;
}
