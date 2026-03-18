import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthUrl, generateOAuthState, TokenStore } from "./oauth.js";
import type { StravaTokens } from "./types.js";

describe("buildAuthUrl", () => {
  it("includes all required OAuth parameters", () => {
    const url = buildAuthUrl("12345", "http://localhost:18789/callback", "abc123");
    expect(url).toContain("client_id=12345");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("response_type=code");
    expect(url).toContain("scope=activity%3Aread_all");
    expect(url).toContain("approval_prompt=auto");
    expect(url).toContain("state=abc123");
  });

  it("uses custom scope when provided", () => {
    const url = buildAuthUrl("12345", "http://localhost/cb", "state1", "read");
    expect(url).toContain("scope=read");
  });
});

describe("generateOAuthState", () => {
  it("returns a hex string", () => {
    const state = generateOAuthState();
    expect(state).toMatch(/^[0-9a-f]+$/);
  });

  it("returns unique values", () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    expect(a).not.toBe(b);
  });

  it("has sufficient length for CSRF protection", () => {
    const state = generateOAuthState();
    // 24 random bytes = 48 hex chars
    expect(state.length).toBe(48);
  });
});

describe("TokenStore", () => {
  let tmpDir: string;
  let store: TokenStore;

  const testTokens: StravaTokens = {
    accessToken: "access_123",
    refreshToken: "refresh_456",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    athleteId: "42",
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "strava-test-"));
    store = new TokenStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no tokens saved", () => {
    expect(store.load()).toBeNull();
  });

  it("saves and loads tokens", () => {
    store.save(testTokens);
    const loaded = store.load();
    expect(loaded).toEqual(testTokens);
  });

  it("saves token file with restricted permissions (0600)", () => {
    store.save(testTokens);
    const filePath = path.join(tmpDir, "strava-tokens.json");
    const stat = fs.statSync(filePath);
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("clears tokens", () => {
    store.save(testTokens);
    expect(store.load()).not.toBeNull();
    store.clear();
    expect(store.load()).toBeNull();
  });

  it("clear is safe when no tokens exist", () => {
    expect(() => store.clear()).not.toThrow();
  });

  it("saves and consumes OAuth state nonce", () => {
    store.saveState("test-state-123");
    expect(store.consumeState("test-state-123")).toBe(true);
    // Second call returns false (consumed)
    expect(store.consumeState("test-state-123")).toBe(false);
  });

  it("consumeState returns false when no state saved", () => {
    expect(store.consumeState("anything")).toBe(false);
  });

  it("preserves multiple state nonces concurrently", () => {
    store.saveState("state-a");
    store.saveState("state-b");
    store.saveState("state-c");
    // All three should be valid
    expect(store.consumeState("state-a")).toBe(true);
    expect(store.consumeState("state-c")).toBe(true);
    expect(store.consumeState("state-b")).toBe(true);
    // All consumed
    expect(store.consumeState("state-a")).toBe(false);
  });

  it("creates directory if it does not exist", () => {
    const nested = path.join(tmpDir, "nested", "deep");
    const nestedStore = new TokenStore(nested);
    nestedStore.save(testTokens);
    expect(nestedStore.load()).toEqual(testTokens);
  });
});
