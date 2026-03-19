type IdleAwareAgent = {
  waitForIdle?: (() => Promise<void>) | undefined;
  /**
   * Returns the number of tool calls currently in flight.
   * Used to detect retry gaps where waitForIdle() can transiently resolve
   * before a scheduled auto-retry starts executing new tool calls.
   */
  pendingToolCount?: (() => number) | undefined;
  /**
   * Resolves when all in-flight tool calls have drained (pendingToolCount hits 0).
   * Called only when pendingToolCount() > 0 after waitForIdle resolves,
   * with whatever timeout budget remains.
   */
  onPendingToolsDrained?: (() => Promise<void>) | undefined;
};

type ToolResultFlushManager = {
  flushPendingToolResults?: (() => void) | undefined;
  clearPendingToolResults?: (() => void) | undefined;
};

export const DEFAULT_WAIT_FOR_IDLE_TIMEOUT_MS = 30_000;

async function waitForAgentIdleBestEffort(
  agent: IdleAwareAgent | null | undefined,
  timeoutMs: number,
): Promise<boolean> {
  const waitForIdle = agent?.waitForIdle;
  if (typeof waitForIdle !== "function") {
    return false;
  }

  const idleResolved = Symbol("idle");
  const idleTimedOut = Symbol("timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      waitForIdle.call(agent).then(() => idleResolved),
      new Promise<symbol>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(idleTimedOut), timeoutMs);
        timeoutHandle.unref?.();
      }),
    ]);
    return outcome === idleTimedOut;
  } catch {
    // Best-effort during cleanup.
    return false;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function waitForToolsDrainedBestEffort(
  agent: IdleAwareAgent | null | undefined,
  remainingMs: number,
): Promise<boolean> {
  const pendingToolCount = agent?.pendingToolCount;
  const onPendingToolsDrained = agent?.onPendingToolsDrained;

  let count = 0;
  if (typeof pendingToolCount === "function") {
    try {
      count = pendingToolCount.call(agent);
    } catch {
      // Best-effort during cleanup.
      count = 0;
    }
  }

  if (count <= 0 || typeof onPendingToolsDrained !== "function") {
    // Nothing pending or no drain signal available — proceed.
    return false;
  }

  const drainResolved = Symbol("drain");
  const drainTimedOut = Symbol("timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      onPendingToolsDrained.call(agent).then(() => drainResolved),
      new Promise<symbol>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(drainTimedOut), remainingMs);
        timeoutHandle.unref?.();
      }),
    ]);
    return outcome === drainTimedOut;
  } catch {
    // Best-effort during cleanup.
    return false;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function flushPendingToolResultsAfterIdle(opts: {
  agent: IdleAwareAgent | null | undefined;
  sessionManager: ToolResultFlushManager | null | undefined;
  timeoutMs?: number;
  clearPendingOnTimeout?: boolean;
}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_WAIT_FOR_IDLE_TIMEOUT_MS;
  const waitStartedAt = Date.now();

  const timedOut = await waitForAgentIdleBestEffort(opts.agent, timeoutMs);

  if (timedOut) {
    if (opts.clearPendingOnTimeout && opts.sessionManager?.clearPendingToolResults) {
      opts.sessionManager.clearPendingToolResults();
      return;
    }
    opts.sessionManager?.flushPendingToolResults?.();
    return;
  }

  // Guard against overloaded-retry gaps: waitForIdle can briefly resolve
  // while a scheduled retry has not yet started executing tool calls.
  // If a tool execution counter is provided, wait for it to drain before
  // flushing — one clean await rather than a polling loop.
  const elapsedMs = Date.now() - waitStartedAt;
  const remainingMs = timeoutMs - elapsedMs;

  if (remainingMs <= 0) {
    if (opts.clearPendingOnTimeout && opts.sessionManager?.clearPendingToolResults) {
      opts.sessionManager.clearPendingToolResults();
      return;
    }
    opts.sessionManager?.flushPendingToolResults?.();
    return;
  }

  const drainTimedOut = await waitForToolsDrainedBestEffort(opts.agent, remainingMs);

  if (drainTimedOut) {
    if (opts.clearPendingOnTimeout && opts.sessionManager?.clearPendingToolResults) {
      opts.sessionManager.clearPendingToolResults();
      return;
    }
    opts.sessionManager?.flushPendingToolResults?.();
    return;
  }

  opts.sessionManager?.flushPendingToolResults?.();
}
