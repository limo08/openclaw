import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";

describe("resolveMemoryBackendConfig", () => {
  it("defaults to builtin backend when config missing", () => {
    const cfg = { agents: { defaults: { workspace: "/tmp/memory-test" } } } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.backend).toBe("builtin");
    expect(resolved.citations).toBe("auto");
    expect(resolved.qmd).toBeUndefined();
  });

  it("resolves qmd backend with default collections", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {},
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.backend).toBe("qmd");
    expect(resolved.qmd?.collections.length).toBeGreaterThanOrEqual(3);
    expect(resolved.qmd?.command).toBe("qmd");
    expect(resolved.qmd?.searchMode).toBe("search");
    expect(resolved.qmd?.update.intervalMs).toBeGreaterThan(0);
    expect(resolved.qmd?.update.waitForBootSync).toBe(false);
    expect(resolved.qmd?.update.commandTimeoutMs).toBe(30_000);
    expect(resolved.qmd?.update.updateTimeoutMs).toBe(120_000);
    expect(resolved.qmd?.update.embedTimeoutMs).toBe(120_000);
    const names = new Set((resolved.qmd?.collections ?? []).map((collection) => collection.name));
    expect(names.has("memory-root-main")).toBe(true);
    expect(names.has("memory-alt-main")).toBe(true);
    expect(names.has("memory-dir-main")).toBe(true);
  });

  it("parses quoted qmd command paths", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {
          command: '"/Applications/QMD Tools/qmd" --flag',
        },
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.qmd?.command).toBe("/Applications/QMD Tools/qmd");
  });

  it("resolves custom paths relative to workspace", () => {
    const cfg = {
      agents: {
        defaults: { workspace: "/workspace/root" },
        list: [{ id: "main", workspace: "/workspace/root" }],
      },
      memory: {
        backend: "qmd",
        qmd: {
          paths: [
            {
              path: "notes",
              name: "custom-notes",
              pattern: "**/*.md",
            },
          ],
        },
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    const custom = resolved.qmd?.collections.find((c) => c.name.startsWith("custom-notes"));
    expect(custom).toBeDefined();
    const workspaceRoot = resolveAgentWorkspaceDir(cfg, "main");
    expect(custom?.path).toBe(path.resolve(workspaceRoot, "notes"));
  });

  it("scopes qmd collection names per agent", () => {
    const cfg = {
      agents: {
        defaults: { workspace: "/workspace/root" },
        list: [
          { id: "main", default: true, workspace: "/workspace/root" },
          { id: "dev", workspace: "/workspace/dev" },
        ],
      },
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: true,
          paths: [{ path: "notes", name: "workspace", pattern: "**/*.md" }],
        },
      },
    } as OpenClawConfig;
    const mainResolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    const devResolved = resolveMemoryBackendConfig({ cfg, agentId: "dev" });
    const mainNames = new Set(
      (mainResolved.qmd?.collections ?? []).map((collection) => collection.name),
    );
    const devNames = new Set(
      (devResolved.qmd?.collections ?? []).map((collection) => collection.name),
    );
    expect(mainNames.has("memory-dir-main")).toBe(true);
    expect(devNames.has("memory-dir-dev")).toBe(true);
    expect(mainNames.has("workspace-main")).toBe(true);
    expect(devNames.has("workspace-dev")).toBe(true);
  });

  it("resolves qmd update timeout overrides", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {
          update: {
            waitForBootSync: true,
            commandTimeoutMs: 12_000,
            updateTimeoutMs: 480_000,
            embedTimeoutMs: 360_000,
          },
        },
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.qmd?.update.waitForBootSync).toBe(true);
    expect(resolved.qmd?.update.commandTimeoutMs).toBe(12_000);
    expect(resolved.qmd?.update.updateTimeoutMs).toBe(480_000);
    expect(resolved.qmd?.update.embedTimeoutMs).toBe(360_000);
  });

  it("resolves qmd search mode override", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {
          searchMode: "vsearch",
        },
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.qmd?.searchMode).toBe("vsearch");
  });

  it("scopes qmd collections by user when userId provided", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {},
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main", userId: "user-abc" });
    expect(resolved.backend).toBe("qmd");
    const names = new Set((resolved.qmd?.collections ?? []).map((c) => c.name));
    // Shared root files should still be agent-scoped (not user-scoped)
    expect(names.has("memory-root-main")).toBe(true);
    expect(names.has("memory-alt-main")).toBe(true);
    // User-scoped memory directory should include userId
    expect(names.has("memory-user-abc-main-user-abc")).toBe(true);
    // Agent-wide memory-dir should NOT be present when userId is provided
    expect(names.has("memory-dir-main")).toBe(false);
    // Verify the user-scoped collection path points to user-specific directory
    const userCollection = resolved.qmd?.collections.find(
      (c) => c.name === "memory-user-abc-main-user-abc",
    );
    expect(userCollection?.path).toBe(path.join("/tmp/memory-test", "memory", "user-abc"));
    expect(userCollection?.pattern).toBe("**/*.md");
    expect(userCollection?.kind).toBe("memory");
  });

  it("includes agent-wide memory directory when userId not provided", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {},
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    const names = new Set((resolved.qmd?.collections ?? []).map((c) => c.name));
    // Should include agent-wide memory-dir
    expect(names.has("memory-dir-main")).toBe(true);
    const dirCollection = resolved.qmd?.collections.find((c) => c.name === "memory-dir-main");
    expect(dirCollection?.path).toBe(path.join("/tmp/memory-test", "memory"));
  });

  // Issue 1: QMD backend doesn't honor memory.isolation.enabled
  describe("isolation.enabled parameter", () => {
    it("includes user-scoped collections when isolation.enabled is true (default)", () => {
      const cfg = {
        agents: { defaults: { workspace: "/tmp/memory-test" } },
        memory: {
          backend: "qmd",
          qmd: {},
        },
      } as OpenClawConfig;
      // Default: isolation.enabled defaults to true
      const resolved = resolveMemoryBackendConfig({
        cfg,
        agentId: "main",
        userId: "discord-123", // sanitized format (underscores become hyphens)
        isolation: { enabled: true },
      });
      const names = new Set((resolved.qmd?.collections ?? []).map((c) => c.name));
      // Should include user-scoped collection
      expect(names.has("memory-discord-123-main-discord-123")).toBe(true);
      // Should NOT include agent-wide memory-dir
      expect(names.has("memory-dir-main")).toBe(false);
    });

    it("includes agent-wide memory directory when isolation.enabled is false", () => {
      const cfg = {
        agents: { defaults: { workspace: "/tmp/memory-test" } },
        memory: {
          backend: "qmd",
          qmd: {},
        },
      } as OpenClawConfig;
      const resolved = resolveMemoryBackendConfig({
        cfg,
        agentId: "main",
        userId: "discord-123",
        isolation: { enabled: false },
      });
      const names = new Set((resolved.qmd?.collections ?? []).map((c) => c.name));
      // Should include agent-wide memory-dir, not user-scoped
      expect(names.has("memory-dir-main")).toBe(true);
      // Should NOT include user-scoped collection
      expect(names.has("memory-discord-123-main-discord-123")).toBe(false);
    });

    it("ignores userId when isolation.enabled is false even if userId provided", () => {
      const cfg = {
        agents: { defaults: { workspace: "/tmp/memory-test" } },
        memory: {
          backend: "qmd",
          qmd: {},
        },
      } as OpenClawConfig;
      // With isolation disabled, userId should be ignored
      const resolved = resolveMemoryBackendConfig({
        cfg,
        agentId: "main",
        userId: "discord-123",
        isolation: { enabled: false },
      });
      const names = new Set((resolved.qmd?.collections ?? []).map((c) => c.name));
      // Agent-wide collection should be present
      expect(names.has("memory-dir-main")).toBe(true);
      // User collection should NOT be present
      expect(names.has("memory-discord-123-main-discord-123")).toBe(false);
    });

    it("defaults isolation.enabled to true when not specified", () => {
      const cfg = {
        agents: { defaults: { workspace: "/tmp/memory-test" } },
        memory: {
          backend: "qmd",
          qmd: {},
        },
      } as OpenClawConfig;
      // No isolation param provided - should default to enabled
      const resolved = resolveMemoryBackendConfig({
        cfg,
        agentId: "main",
        userId: "telegram-456", // sanitized format
      });
      const names = new Set((resolved.qmd?.collections ?? []).map((c) => c.name));
      // Should include user-scoped collection
      expect(names.has("memory-telegram-456-main-telegram-456")).toBe(true);
    });
  });
});
