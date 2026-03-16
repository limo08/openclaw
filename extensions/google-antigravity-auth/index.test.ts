import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("google-antigravity-auth plugin", () => {
  it("ships plugin metadata for extension-fast discovery", () => {
    const manifestPath = path.join(import.meta.dirname, "openclaw.plugin.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      id?: string;
      providers?: string[];
    };

    expect(manifest.id).toBe("google-antigravity-auth");
    expect(manifest.providers).toContain("google-antigravity");
  });
});
