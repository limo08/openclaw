import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scanStatusJsonFast: vi.fn(async () => ({
    cfg: {},
    sourceConfig: {},
    summary: { ok: true },
    osSummary: { platform: "darwin" },
    update: { installKind: "npm", git: null },
    memory: null,
    memoryPlugin: { enabled: true, slot: "memory-core" },
    gatewayMode: "local",
    gatewayConnection: { url: "ws://127.0.0.1:18789", urlSource: "local loopback" },
    remoteUrlMissing: false,
    gatewayReachable: false,
    gatewayProbe: null,
    gatewaySelf: null,
    gatewayProbeAuthWarning: null,
    agentStatus: {},
    secretDiagnostics: [],
  })),
  runSecurityAudit: vi.fn(async () => ({ summary: { critical: 0, warn: 0, info: 0 } })),
  getDaemonStatusSummary: vi.fn(async () => ({ label: "none" })),
  getNodeDaemonStatusSummary: vi.fn(async () => ({ label: "none" })),
}));

vi.mock("./status.scan.fast-json.js", () => ({
  scanStatusJsonFast: mocks.scanStatusJsonFast,
}));
vi.mock("./status.daemon.js", () => ({
  getDaemonStatusSummary: mocks.getDaemonStatusSummary,
  getNodeDaemonStatusSummary: mocks.getNodeDaemonStatusSummary,
}));
vi.mock("../security/audit.runtime.js", () => ({
  runSecurityAudit: mocks.runSecurityAudit,
}));

import { statusJsonCommand } from "./status-json.js";

describe("statusJsonCommand", () => {
  beforeEach(() => {
    mocks.scanStatusJsonFast.mockClear();
    mocks.runSecurityAudit.mockClear();
    mocks.getDaemonStatusSummary.mockClear();
    mocks.getNodeDaemonStatusSummary.mockClear();
  });

  it("skips the security audit on the default fast path", async () => {
    const runtime = { log: vi.fn() };

    await statusJsonCommand({}, runtime as never);

    expect(mocks.runSecurityAudit).not.toHaveBeenCalled();
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.securityAudit).toMatchObject({ skipped: true });
  });

  it("runs the security audit when --all is requested", async () => {
    const runtime = { log: vi.fn() };

    await statusJsonCommand({ all: true }, runtime as never);

    expect(mocks.runSecurityAudit).toHaveBeenCalledTimes(1);
  });
});
