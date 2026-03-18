# Design: Chat Channel Session Switching

## Background

OpenClaw's TUI already supports `/sessions` listing and `/session <key>` switching, but chat channels (Feishu, DingTalk, Telegram DM, etc.) do not expose these commands. This design adds **SessionId switching within the same SessionKey** for chat channels, allowing users to navigate between past conversations without changing routing.

Related Issues:

- [#9959](https://github.com/openclaw/openclaw/issues/9959) - Session list and switch from chat interface (Open)
- [#8397](https://github.com/openclaw/openclaw/issues/8397) - Topic-based Session Switching (Closed as dup of #14276)
- [#14276](https://github.com/openclaw/openclaw/issues/14276) - Named sessions with navigation/recall (Closed as dup of #9959)
- [#28168](https://github.com/openclaw/openclaw/issues/28168) - Session sidebar should show human-readable title + preview (Open)

## Core Concept

```text
SessionKey (stable)                  SessionId (new UUID per /new)
agent:main:feishu:default:direct:ou_xxx
    ├── 5d4c0726... (active)        ← 5d4c0726.jsonl
    ├── 9931a580... (3/16 08:00)    ← 9931a580.jsonl
    ├── 57118706... (3/15 21:03)    ← 57118706.jsonl
    └── 5d78736c... (3/12 15:39)    ← 5d78736c.jsonl
```

This feature does **not** change SessionKey routing logic. It only switches SessionIds within the same SessionKey.

## Design Decisions

### 1. When to Add to the History Queue

**When the current session is deactivated.**

Whenever a new SessionId is generated (`/new`, `/reset`, daily reset) or the user switches away from the current session via `/session ...`, the outgoing SessionId is pushed into the history queue together with a metadata snapshot.

### 2. History Queue Data Structure

Uses an **LRU queue** model. A new `sessionHistory` field is added to `SessionEntry`:

```typescript
interface SessionHistoryItem {
  sessionId: string; // UUID
  createdAt: number; // timestamp ms captured when pushed into history
  label?: string; // user-assigned label (future extension)
  derivedTitle?: string; // auto-generated title (future extension)
  metadata?: {
    systemSent?: boolean;
    thinkingLevel?: string;
    verboseLevel?: string;
    reasoningLevel?: string;
    ttsAuto?: string;
    modelOverride?: string;
    providerOverride?: string;
    label?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    totalTokensFresh?: boolean;
    contextTokens?: number;
    compactionCount?: number;
    memoryFlushAt?: number;
    memoryFlushCompactionCount?: number;
  };
}

interface SessionEntry {
  // ... existing fields
  sessionHistory?: SessionHistoryItem[]; // tail = most recently deactivated
}
```

### 3. Queue Size Limit

**Default limit: 5 entries.** Configurable via `session.historyLimit`.

- `historyLimit > 0`: keep up to N switchable past sessions in the LRU queue
- `historyLimit = 0`: disable switchable session history for this SessionKey

When the limit is exceeded, the oldest entry (queue head) is evicted.

### 4. Transcript Retention / Eviction

Transcripts for sessions that are still present in `sessionHistory` are preserved so users can switch back to them.

When a session is evicted from the LRU history queue, its transcript is archived via `archiveSessionTranscripts(...)`.

If `historyLimit = 0`, the previous session is archived immediately on reset, preserving the pre-history cleanup behavior.

### 5. Queue Operations (LRU)

**`/new`, `/reset`, daily reset:**

1. Current sessionId + metadata snapshot → push to queue tail
2. If queue exceeds limit → evict queue head and archive its transcript
3. Generate new sessionId and make it active

**`/session <number>` or `/session <sessionId>` (selecting a different session):**

1. Current sessionId + metadata snapshot → push to queue tail
2. Target session removed from queue
3. Target sessionId becomes active, metadata snapshot restored
4. If queue exceeds limit → evict queue head and archive its transcript

**`/session <number>` or `/session <sessionId>` (selecting the current session):**

- No-op, reply `Already in that session.`

**`/session back`:**

- Equivalent to selecting the queue tail entry (the most recently deactivated session)

### 6. Ordering Strategy

The queue itself is the ordering — tail is the most recently used, head is the least recently used. `/sessions` lists entries from tail to head, while also including the current active session at the top.

Current implementation renders each row as a compact single line:

- index in the switchable list
- `[current]` marker for the active session
- 8-character SessionId prefix
- relative timestamp when available
- one-line preview truncated for chat readability

Example output:

```text
📋 Sessions:
1. [current] 5d4c0726 (6h ago) 👤 What about DingTalk…
2. 9931a580 (2d ago) 🤖 Server migration c…
3. 57118706 (5d ago) 👤 OpenClaw upgraded t…

Use /session <number>, /session <sessionId>, or /session back.
```

### 7. Daily Reset Behavior

Daily reset (4 AM) is **not a timer-triggered event** — it is lazily evaluated when the next message arrives. Active conversations are never interrupted.

When daily reset triggers:

- Current sessionId is pushed into `sessionHistory` (queue tail)
- New sessionId is generated
- Existing history is preserved, not cleared
- Any session evicted due to `historyLimit` is archived

This means users can still switch back to yesterday's conversation as long as it remains in the configured history window.

### 8. Metadata Restored on Switch

The following snapshot fields are restored when switching back to a prior session:

| Field                          | Description                                 | Restored |
| ------------------------------ | ------------------------------------------- | -------- |
| `systemSent`                   | Whether system prompt has already been sent | ✅       |
| `thinkingLevel`                | Thinking level setting                      | ✅       |
| `verboseLevel`                 | Verbose level setting                       | ✅       |
| `reasoningLevel`               | Reasoning level setting                     | ✅       |
| `ttsAuto`                      | TTS auto-play mode                          | ✅       |
| `modelOverride`                | Model override                              | ✅       |
| `providerOverride`             | Provider override                           | ✅       |
| `label`                        | Session label                               | ✅       |
| `inputTokens` / `outputTokens` | Last token usage snapshot                   | ✅       |
| `cacheRead` / `cacheWrite`     | Cache usage snapshot                        | ✅       |
| `totalTokens`                  | Last total-token snapshot                   | ✅       |
| `totalTokensFresh`             | Whether totalTokens is a fresh snapshot     | ✅       |
| `contextTokens`                | Last known context/token-window usage       | ✅       |
| `compactionCount`              | Compaction counter for the switched session | ✅       |
| `memoryFlushAt`                | Last memory flush timestamp                 | ✅       |
| `memoryFlushCompactionCount`   | Compaction count at last memory flush       | ✅       |
| `abortedLastRun`               | Whether last run was aborted                | ❌       |

Metadata is captured in `SessionHistoryItem.metadata` when a session is deactivated, and restored when switching back.

### 9. SessionId Selection Rules

Supported commands:

| Command                | Description                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- |
| `/sessions`            | List all sessions under the current SessionKey (including current)           |
| `/session <number>`    | Switch to the Nth session in the rendered list                               |
| `/session <sessionId>` | Switch to a specific UUID; unique prefix matching is supported (e.g. `5d4c`) |
| `/session back`        | Switch to the most recently deactivated session (queue tail)                 |

Matching behavior:

1. Exact SessionId match wins.
2. Otherwise, prefix matching is attempted.
3. Prefix matching succeeds **only if exactly one session matches**.
4. Ambiguous or missing matches return `Session not found` and direct the user to `/sessions`.

### 10. Post-Switch Reply

```text
🔄 Switched to session #2 (5d4c0726).

Recent: 👤 What about DingTalk topic isolation?
```

## Files Modified

### Core Changes

| File                                       | Change                                                                     | Risk                                            |
| ------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------- | ---------------- | ---------------------------------------- |
| `src/config/sessions/types.ts`             | Add `SessionHistoryItem` type and `sessionHistory` field to `SessionEntry` | Low — new optional field, backward compatible   |
| `src/auto-reply/reply/session.ts`          | Push outgoing sessionId into history queue on reset/switch boundaries      | Medium — inserts logic into existing reset flow |
| `src/auto-reply/reply/commands-session.ts` | Add `/sessions` list + `/session <n                                        | id                                              | back>` switching | Medium — new selection and restore logic |
| `src/auto-reply/commands-registry.data.ts` | Register `/sessions` command                                               | Low — pure addition                             |

### Auxiliary Changes

| File                                    | Change                                      | Risk                     |
| --------------------------------------- | ------------------------------------------- | ------------------------ |
| `src/auto-reply/reply/commands-core.ts` | Add `handleSessionsListCommand` to HANDLERS | Low — one-line addition  |
| `src/config/types.base.ts`              | Add `historyLimit` to `SessionConfig`       | Low — new optional field |

### Files Not Modified

- `src/routing/session-key.ts` — SessionKey resolution logic untouched
- `src/gateway/server-methods/sessions.ts` — Gateway RPC not affected
- Channel plugins (Feishu, DingTalk, etc.) — commands handled at the Gateway layer

## Future Extensions (Out of Scope)

- Auto-generated session titles (LLM-derived `derivedTitle`)
- `/session name <label>` for manual naming
- Cross-SessionKey switching (requires a VirtualClient abstraction)
- Feishu interactive card picker
- Expired session cleanup policies beyond the current LRU archive behavior
- session-memory hook integration (auto-archive memory on session switch)
