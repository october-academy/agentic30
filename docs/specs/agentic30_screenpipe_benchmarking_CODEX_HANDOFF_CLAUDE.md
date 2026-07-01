# Codex-Lane Wiring Handoff (from Claude Code lane) — 2026-07-01 KST

<!-- Claude Code lane deliverable — a NON-COLLIDING handoff spec for Codex. These two items are OUTSIDE the Claude recorder-hardening lane (they touch index.mjs / office-hours-effector-host.mjs / Swift / mcp-server.mjs = Codex lane). They are the verified fake-completion / missing-value items from the completion audit: (1) the Day Memory loop never fires automatically in the Day-0-3 journey; (2) recorder MCP deny-by-default guards a door mcp-server.mjs never opens and has no Swift grant UI. Line numbers are as-of an independent read-only trace on 2026-07-01 KST; re-read before editing. -->

> **STATUS UPDATE (2026-07-01, Claude):** Part 2's **mcp-server recorder tool
> half is now IMPLEMENTED by Claude** — `sidecar/recorder-mcp-tools.mjs`
> (`recorder_raw_sql_query`, deny-by-default, ephemeral-token bridge to the raw-API
> SQL pipeline, audited, redacted, never proof) is registered in
> `sidecar/mcp-server.mjs` and tested (`recorder-mcp-tools.test.mjs`, 7/7).
> **Codex's remaining Part 2 work reduces to the Swift grant/revoke UI** wired to
> `recorder_mcp_grant_create/_list/_revoke` so the local user can actually grant the
> tool. Part 1 (Day Memory auto-fire) is entirely Codex's. Read Part 2's tool-design
> section for context, but do not re-implement the mcp-server tool.

## Part 1 — Day Memory loop auto-fire (Day-0-3 journey)

# Codex Handoff Spec — B1: Day-Loop Auto-Fire Wiring (Day-0–3 journey)

**Status:** design only. Codex implements. Claude Code owns the one recorder-lane support helper called out in §7 (file-disjoint).
**Repo:** `/Users/october/prj/agentic30-public`
**Lane:** Codex owns `sidecar/index.mjs` and `sidecar/office-hours-effector-host.mjs` edits below. Claude Code owns the new `sidecar/recorder-day-loop.mjs` helper (§7). No Swift change required (decoder already exists; see §9).

---

## 1. Verified gap

The Day Memory loop (`runRecorderDayMemoryLoop`, `sidecar/recorder-day-loop.mjs:19`) runs **only** via the manual Control-tab button → `handleRecorderDayMemoryLoopRun` (`sidecar/index.mjs:4057`, dispatched at `:1357` for msg `recorder_day_memory_loop_run`). It writes `state.recorderDayMemoryLoop` (`index.mjs:4072`).

`formatOfficeHoursRecorderDayLoopContext` (`office-hours-effector-host.mjs:142`) and `computeOfficeHoursEffectorContext` (`:183`, `recorderDayLoop` param) only **passively read** `state.recorderDayMemoryLoop`. There are three effector call sites, all passing `recorderDayLoop: state.recorderDayMemoryLoop`:
- `index.mjs:5906` (office-hours question continuation turn)
- `index.mjs:10559` (Day-1 warmup)
- `index.mjs:11436` (interview office-hours question turn)

So on a fresh Day-0–3 journey where the user never clicks the Control-tab button, `state.recorderDayMemoryLoop` stays `null` (init at `index.mjs:720`) and the loop's product value never surfaces. **The fix makes the loop fire automatically, once per local day, during the office-hours turn — without adding a state owner and without lifting the result into proof.**

---

## 2. Architecture constraints (must hold)

1. **Single authority for state.** Do NOT add an orchestrator/scheduler/second state owner. `state.recorderDayMemoryLoop` (already owned by the main reducer in `index.mjs`) remains the single store. The effector phase must remain a **pure read-only context producer** — it must NOT generate questions and must NOT mutate session/runtime. The auto-fire is performed by the **main reducer (`index.mjs`)** before it calls `computeOfficeHoursEffectorContext`, then passes the (possibly refreshed) `state.recorderDayMemoryLoop` in exactly as today.
2. **Non-proof, recorder-derived.** The loop result already stamps `proofBoundary.proofAcceptedByDayLoop:false` (`recorder-day-loop.mjs:134-142`). Do not change that. The auto-fire path must not write to `execution-os.mjs` / `appendProofLedgerEvent` / `recorder-proof-ledger-adapter.mjs`. Recorder-derived context stays context.
3. **Readiness + idempotency gating.** Fire ONLY when recorder consent is granted and capture readiness is satisfied (`evaluateRecorderCaptureReadiness(...).canRecord === true`), and at most **once per local day** (mirror the office-hours digest "once per session/day" pattern, `daily-office-hours-digest.mjs:828` + memory note `project_office_hours_digest_once_per_session`).
4. **Fail-open / non-blocking.** Any failure (no recorder store, readiness blocked, loop throw) must NOT block or fail the office-hours turn. Degrade silently: leave `state.recorderDayMemoryLoop` as-is and append a debt marker (§6).

---

## 3. The exact seam

Add one async helper in `index.mjs` and call it from the office-hours reducer path **immediately before** each `computeOfficeHoursEffectorContext` call that passes `recorderDayLoop: state.recorderDayMemoryLoop`.

### 3a. New reducer helper (in `index.mjs`, near `handleRecorderDayMemoryLoopRun` ~`:4057`)

```js
// Auto-fire the Day Memory loop within the Day-0–3 journey. PURE side-effect-free
// w.r.t. session/runtime: it only refreshes the single reducer-owned cache
// `state.recorderDayMemoryLoop`. Idempotent per local day, readiness-gated,
// fail-open. NEVER touches proof.
async function maybeAutoRunRecorderDayMemoryLoop({ now = new Date(), debtSink = null } = {}) {
  try {
    // (1) recorder store must be running; else nothing to review.
    if (!state.recorderStore) return state.recorderDayMemoryLoop;

    // (2) Day-0–3 window only — auto-fire is for the early journey.
    const day = state.dayProgress
      ? computeDayNumber({ challengeStartedAt: state.dayProgress.challengeStartedAt, now })
      : null;
    if (day != null && day > 4) return state.recorderDayMemoryLoop; // Day 1..4 inclusive (computeDayNumber is 1-based; Day-0 maps to 1)

    // (3) idempotency: once per local day. Reuse stamped result if same day key.
    const dayKey = todayKey(now);
    const existing = state.recorderDayMemoryLoop;
    if (existing && recorderDayMemoryLoopRanForDayKey(existing) === dayKey) {
      return existing; // already ran today — reuse, do NOT re-run
    }

    // (4) readiness/consent gate.
    const controlState = await loadRecorderControlState({ appSupportRoot: appSupportPath, now });
    const readiness = evaluateRecorderCaptureReadiness(controlState, { now });
    if (!readiness.canRecord) {
      if (Array.isArray(debtSink)) debtSink.push("recorder_day_loop_capture_not_ready");
      return state.recorderDayMemoryLoop; // not ready — leave cache untouched
    }

    // (5) run the loop over the local-day window [startOfDay(now), now).
    const { startedAt, endedAt } = recorderDayMemoryLoopLocalDayRange(now); // §7 helper
    const result = await runRecorderDayMemoryLoop({
      store: state.recorderStore,
      workspaceRoot,
      startedAt,
      endedAt,
      now,
      persistReviewSnapshot: false, // auto-fire never persists snapshots (manual button still may)
    });
    state.recorderDayMemoryLoop = result; // single authority, same field the manual path writes
    return result;
  } catch (error) {
    if (Array.isArray(debtSink)) debtSink.push("recorder_day_loop_auto_run_failed");
    return state.recorderDayMemoryLoop; // fail-open
  }
}
```

Notes:
- `computeDayNumber`, `todayKey`, `loadRecorderControlState`, `evaluateRecorderCaptureReadiness`, `runRecorderDayMemoryLoop`, `appSupportPath`, `workspaceRoot`, `state` are all already imported/in-scope in `index.mjs` (`computeDayNumber` import at `:181`; `todayKey` import at `:309`; control-state imports at `:545-546`; day-loop import at `:555`; `appSupportPath` const at `:574`).
- The endedAt window MUST be strictly after startedAt (`recorder-day-loop.mjs:180` throws `ERR_RECORDER_DAY_LOOP_INVALID_RANGE` otherwise) — the §7 helper guarantees this even at local midnight (see §7 edge case).

### 3b. New tiny reader (in `index.mjs`, beside the helper)

`recorderDayMemoryLoopRanForDayKey(result)` — derive the local-day key the cached result was generated for, to compare against `todayKey(now)`:

```js
function recorderDayMemoryLoopRanForDayKey(result) {
  const iso = result?.generatedAt || result?.generated_at;
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : todayKey(d);
}
```

`runRecorderDayMemoryLoop` already returns `generatedAt`/`generated_at` (`recorder-day-loop.mjs:81-84`), so the manual-button result is also comparable — auto-fire will correctly skip re-running if the user already ran it manually today.

---

## 4. Wiring the call (three sites, identical pattern)

At each of the three office-hours effector sites, insert the auto-fire **before** building the effector context, then keep passing `state.recorderDayMemoryLoop` (now possibly refreshed) exactly as today. The cleanest no-drift approach: call the helper, ignore its return value, and let the existing `recorderDayLoop: state.recorderDayMemoryLoop` argument pick up the refreshed cache.

**Site A — `index.mjs:5906` (question continuation turn).** Insert before the `const officeHoursEffectorContext = await computeOfficeHoursEffectorContext({` (`:5906`):
```js
await maybeAutoRunRecorderDayMemoryLoop({ debtSink: officeHoursDebtSink });
```
(Use the same debt collection array already threaded for second-opinion debt if one exists in this scope; otherwise pass `debtSink: null` and rely on telemetry per §6.)

**Site B — `index.mjs:11436` (interview question turn).** Insert immediately before the `Promise.all([...])` at `:11430-11442` (so the await completes before `computeOfficeHoursEffectorContext` reads the cache). Do NOT put `maybeAutoRunRecorderDayMemoryLoop` *inside* the `Promise.all` — it mutates `state.recorderDayMemoryLoop`, which the sibling `computeOfficeHoursEffectorContext` reads; keep it strictly sequenced before.

**Site C — `index.mjs:10559` (Day-1 warmup).** Same: `await maybeAutoRunRecorderDayMemoryLoop({ now })` immediately before the `Promise.all` at `:10557`, sequenced before (not inside) the parallel block. This is the Day-1 path, squarely in the Day-0–3 window, so it is the most important site for the loop's first appearance.

**Critical ordering invariant:** the auto-fire `await` must fully resolve **before** `computeOfficeHoursEffectorContext` runs, because the effector reads `state.recorderDayMemoryLoop` synchronously inside `formatOfficeHoursRecorderDayLoopContext`. Never co-schedule them in the same `Promise.all`.

---

## 5. Trigger condition (summary)

Fire the loop when ALL hold:
1. `state.recorderStore` is non-null (recorder is running).
2. Day-number ≤ 4 (Day-0–3 inclusive; `computeDayNumber` is 1-based, returns 1 for the start day). If `state.dayProgress` is null (day unknown), **allow** the fire (do not gate out the very first session before day-progress exists).
3. `evaluateRecorderCaptureReadiness(controlState).canRecord === true` (consent granted + permissions + active mode).
4. Not already run for `todayKey(now)` (idempotency key in §5a).

If any fails: leave `state.recorderDayMemoryLoop` unchanged, append the relevant debt, return.

### 5a. Idempotency key / cache

- **Key:** `todayKey(now)` (local-day string, `bip-coach-state.mjs:810`).
- **Cache:** the existing single field `state.recorderDayMemoryLoop`; its `generatedAt` provides the last-run day via `recorderDayMemoryLoopRanForDayKey`. No new state field, no new file, no separate owner — satisfies the single-authority constraint.
- This also dedups against the manual Control-tab button: if the user clicked it earlier today, auto-fire sees the same-day `generatedAt` and skips.

---

## 6. Failure handling (non-blocking, append status)

- Wrap the whole helper body in try/catch; on any throw return the prior cache value. The office-hours turn proceeds regardless.
- Debt markers appended to `debtSink` (when caller supplies one) / emitted via telemetry:
  - `recorder_day_loop_capture_not_ready` — readiness gate blocked (consent/permission/paused).
  - `recorder_day_loop_auto_run_failed` — loop threw (store error, range error, etc.).
- Add a telemetry event mirroring the existing recorder telemetry style: `telemetry.captureEvent("mac_sidecar_recorder_day_loop_auto_fired", { day, fired: true|false, reason })` where `reason ∈ {ok, not_running, out_of_window, already_ran_today, not_ready, error}`. Keep it scrubbed (no captured text, no paths — counts/status only, consistent with the recorder no-raw-leak posture).
- The result envelope must keep `proofAcceptedByDayLoop:false` (unchanged) — the auto path does NOT broadcast a `recorder_day_memory_loop_result` event (that stays the manual button's contract) and does NOT write proof.

---

## 7. Claude-lane (recorder-*) support helper to add

Codex calls `recorderDayMemoryLoopLocalDayRange(now)` for the window. This is a pure date helper that belongs in the recorder lane. **Claude Code adds it to `sidecar/recorder-day-loop.mjs`** and exports it:

```js
// Local-day window [startOfDay, now). Guarantees endedAt > startedAt even at
// local midnight by flooring start to the day and, if now === midnight exactly,
// using a >=1ms window so runRecorderDayMemoryLoop's range guard never throws.
export function recorderDayMemoryLoopLocalDayRange(now = new Date()) {
  const end = now instanceof Date ? now : new Date(now);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);
  let endedAt = end;
  if (endedAt.getTime() <= start.getTime()) {
    endedAt = new Date(start.getTime() + 1); // +1ms so endedAt > startedAt
  }
  return { startedAt: start.toISOString(), endedAt: endedAt.toISOString() };
}
```

Rationale: `normalizeTimeRange` (`recorder-day-loop.mjs:177`) throws `ERR_RECORDER_DAY_LOOP_INVALID_RANGE` when `endedAt <= startedAt`. At exactly local midnight `now === startOfDay`, so the helper must bump by 1ms. This keeps the date math in the recorder lane and unit-testable independently of `index.mjs`.

If Claude prefers, this helper may instead be defined inline in `index.mjs` (Codex lane) — but placing it in `recorder-day-loop.mjs` keeps day-window semantics co-located with the loop and lets `recorder-day-loop.test.mjs` cover the midnight edge. **Decision: put it in `recorder-day-loop.mjs` (Claude lane).** Codex imports it alongside `runRecorderDayMemoryLoop` at `index.mjs:555`.

---

## 8. Tests Codex should add

Prefer extracting the pure decision into a small testable predicate so `index.mjs` boot side-effects don't block import (same constraint noted in `project_office_hours_digest_once_per_session` — `index.mjs` can't be imported in tests). Two options; pick the seam-extraction one:

### 8a. Extract the gate predicate into a sibling for unit testing
Create `sidecar/recorder-day-loop-autofire.mjs` exporting a **pure** `shouldAutoRunRecorderDayMemoryLoop({ recorderStoreReady, day, readinessCanRecord, lastRunDayKey, todayKey })` returning `{ fire: boolean, reason }`. Have `maybeAutoRunRecorderDayMemoryLoop` in `index.mjs` call it for the decision, then perform the I/O. New test `sidecar-tests/recorder-day-loop-autofire.test.mjs` covering:
- fires when store ready + day∈{1..4} + canRecord + lastRunDayKey≠todayKey → `{fire:true, reason:"ok"}`.
- skips when `recorderStoreReady=false` → `reason:"not_running"`.
- skips when `day=5` → `reason:"out_of_window"`; allows when `day=null` → `fire:true`.
- skips when `readinessCanRecord=false` → `reason:"not_ready"`.
- skips when `lastRunDayKey===todayKey` (idempotency) → `reason:"already_ran_today"`.

**Lane note:** `recorder-day-loop-autofire.mjs` is recorder-prefixed → if it's pure decision logic with no `index.mjs` coupling, it belongs in the **Claude lane**. Coordinate: Claude provides the pure predicate + its test; Codex wires it. If Codex must keep the predicate in its own lane, name it `office-hours-recorder-day-loop-gate.mjs` (office-hours-prefixed → not Claude-owned) to avoid lane collision. **Recommend: Claude owns `recorder-day-loop-autofire.mjs` (predicate + unit test); Codex owns the `index.mjs` wiring + range-helper import.**

### 8b. Range/window helper test (Claude lane, `recorder-day-loop.test.mjs`)
- `recorderDayMemoryLoopLocalDayRange(new Date(2026,6,1,9,0))` → startedAt is local midnight, endedAt is 09:00, endedAt > startedAt.
- exactly-midnight input → endedAt is start+1ms (no throw).
- feed both into `runRecorderDayMemoryLoop` with a fake store and assert no `ERR_RECORDER_DAY_LOOP_INVALID_RANGE`.

### 8c. Effector-host regression (Codex lane, `office-hours-effector-host.test.mjs`)
- `formatOfficeHoursRecorderDayLoopContext` still renders `proof_boundary day_loop=false` and `recorder context is not proof.` when fed an auto-fired result (proof boundary unchanged). This is a guard that auto-fire didn't leak proof acceptance.

### 8d. Idempotency-key reader (Codex lane)
- `recorderDayMemoryLoopRanForDayKey({ generatedAt })` returns `todayKey(generatedAt)`; empty/invalid → `""`. (If extracted to a sibling, unit-test there; otherwise cover via the predicate test by passing the derived key.)

Run `npm run test:sidecar` (and the targeted files via `node --test sidecar-tests/recorder-day-loop-autofire.test.mjs`). Per memory `project_ci_no_sidecar_tests`, CI does NOT run sidecar tests — Codex must run them locally in an isolated worktree on the PR head.

---

## 9. Swift / UI — no change required

The Swift decoder `RecorderDayMemoryLoopResult` (`AgenticViewModel.swift:3608`) and the `recorder_day_memory_loop_result` handler (`:14945`) are unaffected: auto-fire does NOT emit that event. The Control-tab passive read (`ContentView.swift:3007`, `viewModel.recorderDayMemoryLoop`) still reflects the last result whether it came from the button or auto-fire — but auto-fire updates `state.recorderDayMemoryLoop` on the **sidecar** side only; it surfaces to the user through the office-hours system prompt context (`formatOfficeHoursRecorderDayLoopContext`), which is the product value. No envelope/schema change → no `SidecarEventDecodingTests` update needed. If Codex later wants the Control-tab card to reflect the auto-fired result too, that is a separate (optional) broadcast and out of scope here.

---

## 10. Invariants checklist (for Codex self-review before PR)

- [ ] No new state owner; only `state.recorderDayMemoryLoop` written, only by the reducer.
- [ ] Effector (`office-hours-effector-host.mjs`) unchanged in behavior — still pure, still read-only, still emits no questions. (No edit to `computeOfficeHoursEffectorContext` signature.)
- [ ] Auto-fire `await` sequenced strictly before every `computeOfficeHoursEffectorContext` (never inside a `Promise.all` with it).
- [ ] Result keeps `proofAcceptedByDayLoop:false`; no `appendProofLedgerEvent` / `recorder-proof-ledger-adapter.mjs` call anywhere on this path.
- [ ] Fires at most once per local day (key = `todayKey`), dedups against manual button via `generatedAt`.
- [ ] Gated on `state.recorderStore` present + Day≤4 + `evaluateRecorderCaptureReadiness().canRecord`.
- [ ] Fully fail-open: every failure leaves the cache untouched and the office-hours turn unblocked; debt/telemetry appended, never thrown.
- [ ] `persistReviewSnapshot:false` on the auto path (no disk snapshot writes from auto-fire).
- [ ] `npm run test:sidecar` green on the PR-head worktree.

---

## 11. File-touch summary

| File | Lane | Change |
|---|---|---|
| `sidecar/index.mjs` | Codex | add `maybeAutoRunRecorderDayMemoryLoop` + `recorderDayMemoryLoopRanForDayKey`; call at `:5906`, `:10557`, `:11430` (before each effector build); import range helper + (optional) predicate; add telemetry event |
| `sidecar/recorder-day-loop.mjs` | Claude | export `recorderDayMemoryLoopLocalDayRange(now)` |
| `sidecar/recorder-day-loop-autofire.mjs` | Claude | NEW pure predicate `shouldAutoRunRecorderDayMemoryLoop(...)` |
| `sidecar-tests/recorder-day-loop-autofire.test.mjs` | Claude | NEW predicate tests |
| `sidecar-tests/recorder-day-loop.test.mjs` | Claude | add midnight/window cases for the range helper |
| `sidecar-tests/office-hours-effector-host.test.mjs` | Codex | regression: proof-boundary stays false for auto-fired result |

**Cross-lane handshake:** Claude lands `recorderDayMemoryLoopLocalDayRange` + `shouldAutoRunRecorderDayMemoryLoop` (+ their tests) FIRST; Codex then imports both and wires `index.mjs`. If Codex must avoid the cross-lane dependency, it may inline a private copy of the range helper in `index.mjs` and use the predicate inline — but the recommended split keeps date/gate semantics in the recorder lane and unit-tested.

---

## Part 2 — MCP grant UI + recorder MCP tool exposure

# WORKSTREAM B2 — Recorder MCP Tool Exposure + Swift Grant UI (Codex handoff spec)

## 0. Problem statement (verified fake-completion)

The recorder MCP deny-by-default machinery is fully built and tested but guards a door nobody opens:

- `sidecar/recorder-mcp-grants.mjs` (durable grant store) + `assertRecorderMcpAccess` / `ACCESS_IMPLICATIONS` in `sidecar/recorder-raw-api-auth.mjs` enforce deny-by-default for raw levels. 10/10 tests in `sidecar-tests/recorder-mcp-grants.test.mjs` pass.
- WS commands `recorder_mcp_grants_list` / `recorder_mcp_grant_create` / `recorder_mcp_grant_revoke` / `recorder_mcp_access_check` are wired in `sidecar/index.mjs` (dispatch at ~:1380-1395, handlers at ~:4311-4368).
- **Gap A:** `sidecar/mcp-server.mjs` exposes ZERO recorder tools — `assertRecorderMcpAccess` is never called on the MCP surface. The `get_agentic30_context` `capabilities` array (mcp-server.mjs:92-110) does not list any recorder tool.
- **Gap B:** No Swift caller exists for `recorder_mcp_grant_*`. `agentic30/AgenticViewModel.swift` only sends `recorder_raw_api_token_issue` (~:10556, :10747, :10842) and handles `recorder_raw_api_status` / `recorder_raw_api_token_issued` (~:14853-14857). Grep for `recorder_mcp_grant` in `agentic30/` returns nothing.

This spec closes both gaps. **Codex implements; Claude-lane recorder-*.mjs primitives already exist and must NOT be re-authored.**

---

## 1. Lane / ownership map

| Piece | Owner | Status |
|---|---|---|
| `recorder-mcp-grants.mjs` (grant store, `assertPersistedRecorderMcpAccess`, `findActiveRecorderMcpGrant`) | Claude | EXISTS — do not edit |
| `recorder-raw-api-auth.mjs` (`assertRecorderMcpAccess`, `ACCESS_IMPLICATIONS`, `recordRecorderAudit`, `RECORDER_ACCESS_LEVELS`) | Claude | EXISTS — do not edit |
| `recorder-search.mjs` (`buildRecorderSearchResults`) | Claude | EXISTS — do not edit |
| `recorder-store.mjs` (`RecorderStore`, `resolveRecorderDbPath`, `ensureRecorderSqlInspectorViews`) | Claude | EXISTS — do not edit |
| `recorder-sql-worker.mjs` (bounded SQL inspector exec/validate) | Claude | EXISTS — do not edit |
| `recorder-audit-source.mjs` (`buildRecorderAuditSource`) | Claude | EXISTS — do not edit |
| **`mcp-server.mjs` — new recorder tool registrations + audit wiring** | **Codex** | **ADD** |
| WS handlers `recorder_mcp_grant_*` in `index.mjs` | Codex | EXISTS — reuse, do not rewrite |
| **Swift grant UI (create/list/revoke) + new WS sends/decoders** | **Codex** | **ADD** |

> NOTE for Codex: if `mcp-server.mjs` needs a new sidecar helper (e.g. a thin grant+audit wrapper that opens a `RecorderStore` and writes the audit row), put it in a **new Codex-owned module** (`sidecar/recorder-mcp-tool-host.mjs`) — do NOT add functions to any `recorder-*.mjs` file in the Claude lane list. The new host only *calls* Claude-lane exports.

---

## 2. The recorder MCP tool to expose (primary — the gated one)

### 2.1 Why a `raw_sql` tool, not a redacted search

`assertRecorderMcpAccess` is **default-allow** for `summary` and `search` (`isRecorderMcpAccessAllowedByDefault`, recorder-raw-api-auth.mjs:268-270, `MCP_DEFAULT_ACCESS_LEVELS = {summary, search}`). A redacted recorder search is `search` level → it would NOT exercise the grant gate, so it cannot be the decisive tool that proves the deny-by-default door opens.

**The decisive tool must request a RAW level.** Expose a bounded recorder SQL inspector read at `raw_sql`. This is the level the existing grant tests already pin (`recorder-mcp-grants.test.mjs` "raw_sql grants stay explicit and do not imply raw_admin or raw media"), and the raw API server already has a bounded SQL inspector path (`recorder-raw-api-server.mjs:280-300`, views from `ensureRecorderSqlInspectorViews`).

### 2.2 Tool: `recorder_raw_sql_inspect`

Registration shape in `mcp-server.mjs` (mirror the existing `server.tool(name, description, zodShape, async handler)` pattern used by `record_rubric_assessment`):

```js
server.tool(
  "recorder_raw_sql_inspect",
  "Run a bounded, read-only SQL inspector query against the local recorder DB's redacted inspector views. DENIED BY DEFAULT: requires an active local-user MCP grant scoped to this exact tool with raw_sql access. Returns redacted rows only; never raw OCR/audio/frame bytes.",
  {
    view: z.enum(RECORDER_SQL_INSPECTOR_VIEW_NAMES_ENUM), // bounded allowlist, see §2.4
    limit: z.number().int().min(1).max(100).optional(),
    workspaceId: z.string().optional(),
    projectId: z.string().optional(),
  },
  async (input) => recorderRawSqlInspectHandler(input),
);
```

### 2.3 Exact deny-by-default contract (the handler)

`recorderRawSqlInspectHandler` (in new `sidecar/recorder-mcp-tool-host.mjs`) MUST, in order:

1. Resolve `appSupportPath` (already computed in mcp-server.mjs:51-58 — pass it into the host as a constructor arg, do not recompute).
2. Generate `requestId = randomUUID()`.
3. Call `assertPersistedRecorderMcpAccess({ appSupportPath, toolName: "recorder_raw_sql_inspect", accessLevel: "raw_sql", now })` (Claude-lane export). This:
   - throws `RecorderRawApiAuthError` code `ERR_RECORDER_MCP_RAW_ACCESS_DENIED` when no active grant exists (no grant → **named-root-cause denial**, not a silent empty result);
   - throws `ERR_RECORDER_MCP_GRANT_TOOL_MISMATCH` if a grant exists for a different tool;
   - throws `ERR_RECORDER_MCP_GRANT_EXPIRED` / `ERR_RECORDER_MCP_GRANT_SCOPE_DENIED` for expired or wrong-scope grants.
4. **Open a short-lived `RecorderStore`** (`new RecorderStore({ appSupportRoot: appSupportPath }).open()`) — mcp-server.mjs is a separate process from index.mjs and has no `state.recorderStore`. Close it in a `finally`.
5. **Audit ACCEPTED:** call `recordRecorderAudit({ store, requestId, actorType: "mcp_client", actorId: "<MCP client id or 'codex_mcp'>", endpoint: "mcp:recorder_raw_sql_inspect", accessLevel: "raw_sql", sourceIds: [{ id: view, source_type: "recorder_sql_view" }], decision: "accepted", reason: "authorized_mcp_raw_sql_inspect", now })`.
6. Execute the bounded query via the existing SQL worker path (`validateRecorderSqlQuery` + `executeRecorderSqlQuery` from `recorder-sql-worker.mjs`, the same functions `recorder-raw-api-server.mjs:281-287` calls) constrained to the requested inspector view + limit.
7. Return `{ content: [{ type: "text", text: JSON.stringify(result + proofBoundary) }] }` with `proofAcceptedByMcp: false` stamped (see §4).
8. **Audit DENIED on any throw** (mirror `recordSqlInspectorDeniedAudit`, recorder-raw-api-server.mjs:2288-2304): in `catch`, write `decision: "denied", reason: error?.code || "ERR_RECORDER_MCP_RAW_SQL_DENIED"`, then **re-surface the named code** to the MCP caller as the tool's text result — do NOT swallow it into a generic "no results" message. Deny output shape:
   ```json
   { "ok": false, "denied": true, "code": "ERR_RECORDER_MCP_RAW_ACCESS_DENIED",
     "reason": "MCP raw recorder access is denied until the local user grants a scoped capability",
     "requiredGrant": { "toolName": "recorder_raw_sql_inspect", "accessLevel": "raw_sql" } }
   ```

### 2.4 Bounded view allowlist

Add `recorder_raw_sql_inspect` to a small allowlist of inspector view names (the views created by `ensureRecorderSqlInspectorViews`; their names are in `RECORDER_SQL_INSPECTOR_VIEW_NAMES` in recorder-store.mjs). Codex must read that const and pin the `z.enum` to it. The handler MUST reject any `view` not in the allowlist with `ERR_RECORDER_MCP_SQL_VIEW_NOT_ALLOWED` (audited as denied). Free-form SQL is NOT accepted on the MCP surface — view + limit + scope only.

### 2.5 Scope-isolation invariant (non-implication)

The grant gate already guarantees this (pinned by Claude-lane tests), but the SPEC requires the MCP tool to depend on it:
- A `raw_sql` grant authorizes ONLY `recorder_raw_sql_inspect` at `raw_sql`. Because `ACCESS_IMPLICATIONS.raw_sql = ["raw_sql"]` (recorder-raw-api-auth.mjs:34), a `raw_sql` grant does **NOT** imply `raw_admin`, `raw_frame`, or `raw_audio`.
- Therefore the future `raw_frame`/`raw_audio` MCP tools (out of scope here) will deny even when a `raw_sql` grant is active. Codex must NOT add a tool that requests multiple raw levels under one grant, and must NOT request `raw_admin` for the SQL inspector.

### 2.6 Companion (optional, NON-gated) tool — `recorder_search`

Optionally also expose `recorder_search` at `search` level (default-allow) calling `buildRecorderSearchResults`. This is a *context* tool, not the decisive one. If exposed it MUST still call `assertRecorderMcpAccess({ accessLevel: "search" })` (returns `{decision: "default_allow"}`) so the audit row and the access decision are explicit and uniform — never bypass the gate just because it is default-allow. Recommended to ship it so the grant-gated `raw_sql` tool reads as the deliberate escalation from an always-available redacted search. Add both tool names to the `capabilities` array in `get_agentic30_context` (mcp-server.mjs:92-110).

---

## 3. Swift grant UI (create / list / revoke)

> Describe-only; Codex writes the SwiftUI. Owner of `agentic30/*.swift` is Codex.

### 3.1 New WS sends (Mac → sidecar)

Add three sends in `AgenticViewModel.swift` mirroring the existing `sendRecorderRawApiTokenIssue` shape (~:10556):

| Swift method (new) | WS `type` | payload |
|---|---|---|
| `sendRecorderMcpGrantCreate(toolName:accessLevels:ttlMs:reason:rawAdminConfirmed:)` | `recorder_mcp_grant_create` | `{ toolName, accessLevels:[...], ttlMs, reason, rawAdminConfirmed }` |
| `sendRecorderMcpGrantsList()` | `recorder_mcp_grants_list` | `{}` |
| `sendRecorderMcpGrantRevoke(grantId:)` | `recorder_mcp_grant_revoke` | `{ grantId }` |

These map 1:1 to existing handlers `handleRecorderMcpGrantCreate/List/Revoke` (index.mjs:4321-4353). **No new sidecar WS commands needed** — index.mjs already dispatches all three.

### 3.2 New WS decoders (sidecar → Mac)

Add decoders for the three response envelopes (sidecar already emits them):
- `recorder_mcp_grants` → `{ grants: [GrantDTO], proofAcceptedByMcpGrant: false }`
- `recorder_mcp_grant_created` → `{ grant: GrantDTO, proofAcceptedByMcpGrant: false }`
- `recorder_mcp_grant_revoked` → `{ grant: GrantDTO, proofAcceptedByMcpGrant: false }`

`GrantDTO` fields (from `decorateGrantState` in recorder-mcp-grants.mjs:231-241 + the normalized grant): `id`, `toolName`, `accessLevels:[String]`, `grantedBy`, `grantedAt`, `expiresAt`, `reason`, `revokedAt?`, `revokedBy?`, `active:Bool`, `state:"active"|"expired"|"revoked"`. Decode camelCase keys (handlers send camelCase + snake duplicates; decode camelCase).

**Cross-side parity requirement (CLAUDE.md):** add the new envelopes to `agentic30Tests/SidecarEventDecodingTests.swift` and keep the WS command names identical on both sides.

### 3.3 UI surface to add

A "Recorder MCP Access" pane under recorder/privacy Settings (same area as the existing raw-API-token surface that already drives `recorder_raw_api_token_issue`). Behavior:

- **List:** on appear, call `sendRecorderMcpGrantsList()`, render each grant as a row: tool name, access-level chips, relative expiry (`expiresAt`), `state` badge (active/expired/revoked). Show empty state "No MCP grants — recorder raw tools are denied by default."
- **Create:** a form with: tool picker (allowlist of exposable raw tool names, initially just `recorder_raw_sql_inspect`), access-level multi-select restricted to `RAW_MCP_ACCESS_LEVELS` (`raw_frame`, `raw_audio`, `export`, `raw_sql`, `raw_admin`), TTL stepper (default 5 min, max 15 min — must match `MAX_GRANT_TTL_MS`; over-max is rejected sidecar-side with `ERR_RECORDER_MCP_GRANT_TTL_TOO_LONG`, surface that error inline).
  - **Per-tool scoping:** a grant is created for ONE tool name. The UI must never offer "grant for all tools."
  - **raw_admin confirmation:** if `raw_admin` is selected, require a second explicit confirmation toggle that sets `rawAdminConfirmed: true`; without it the sidecar throws `ERR_RECORDER_MCP_RAW_ADMIN_CONFIRMATION_REQUIRED`. Surface that as an inline error if the toggle is off.
- **Revoke:** each row has a Revoke button → `sendRecorderMcpGrantRevoke(grantId:)`; on `recorder_mcp_grant_revoked`, update the row to `state=revoked`.

### 3.4 The audit row each grant / raw-read writes

- **Grant create/revoke** themselves do NOT write a `recorder_audit` SQL row today (the grant store is a JSON file at `recorder-mcp-grants.json`; create/revoke are journaled there with `grantedBy/grantedAt` and `revokedBy/revokedAt`). That JSON IS the grant audit trail. **Keep it that way** — do not add SQL audit writes to grant create/revoke (would cross into the Claude-lane grant module).
- **Raw read (tool invocation)** writes a `recorder_audit` SQL row via `recordRecorderAudit` (§2.3 steps 5 & 8): `actor_type="mcp_client"`, `endpoint="mcp:recorder_raw_sql_inspect"`, `access_level="raw_sql"`, `decision` accepted/denied, `reason` = the named code. This row is queryable through the existing `buildRecorderAuditSource` (recorder-audit-source.mjs) and the raw-API audit endpoint — so the Swift UI can later show "last N raw reads" by reusing that source. (Showing the audit log in Swift is OPTIONAL for B2; the write is REQUIRED.)

---

## 4. Security invariants (must hold; pin with tests)

1. **Deny-by-default for raw:** `recorder_raw_sql_inspect` with no active grant → tool returns `{ok:false, denied:true, code:"ERR_RECORDER_MCP_RAW_ACCESS_DENIED"}` AND writes a `decision:"denied"` audit row. No rows leak.
2. **Named root cause:** denial text carries the exact error code from `assertRecorderMcpAccess`, never a generic/empty result.
3. **Non-implication:** a `raw_sql` grant does NOT authorize `raw_admin`/`raw_frame`/`raw_audio`; tool stays `raw_sql`-only. (Backed by `ACCESS_IMPLICATIONS.raw_sql = ["raw_sql"]`.)
4. **Per-tool scoping:** a grant for tool X does not authorize tool Y (`ERR_RECORDER_MCP_GRANT_TOOL_MISMATCH`). The MCP handler passes its own literal tool name to `assertPersistedRecorderMcpAccess`.
5. **TTL ceiling:** grants > `MAX_GRANT_TTL_MS` (15 min) rejected; expired grants deny (`ERR_RECORDER_MCP_GRANT_EXPIRED`).
6. **raw_admin gate:** `raw_admin` grants require `rawAdminConfirmed:true`.
7. **No raw bytes on MCP:** tool returns redacted inspector-view rows only (views already enforce `redacted_text`/labels via `assertRecorderRedactionPolicyForRecord`). Never OCR/accessibility/audio raw text, never frame image bytes.
8. **Proof boundary (fail-closed):** every MCP recorder tool response stamps `proofAcceptedByMcp: false` / `proof_accepted_by_mcp: false`. MCP recorder reads are memory/context, never proof. Proof writes flow ONLY through `execution-os.mjs appendProofLedgerEvent` via `recorder-proof-ledger-adapter.mjs`; this tool MUST NOT import or call the proof ledger.
9. **Process isolation:** the store opened in mcp-server.mjs is short-lived and closed in `finally`; no shared mutable `state` with index.mjs.
10. **Secret hygiene:** never log the grant store contents or audit `actor_id` at info level (auth-context scrubbing posture).

---

## 5. Tests

### 5.1 Sidecar (`node --test`) — new file `sidecar-tests/recorder-mcp-tool-host.test.mjs`

Test `recorderRawSqlInspectHandler` against a temp `appSupportPath` + a real `RecorderStore` seeded with one redacted row:
- **deny no grant:** handler returns `denied:true, code:"ERR_RECORDER_MCP_RAW_ACCESS_DENIED"`; assert a `recorder_audit` row exists with `decision:"denied"`, `endpoint:"mcp:recorder_raw_sql_inspect"`, `access_level:"raw_sql"`.
- **allow with grant:** create a `raw_sql` grant for `recorder_raw_sql_inspect` via `grantRecorderMcpAccess`; handler returns rows + `proofAcceptedByMcp:false`; assert an `accepted` audit row.
- **non-implication:** with only a `raw_sql` grant active, a hypothetical `raw_frame`-level call (or a second tool requesting `raw_frame`) still denies. (Reuse the assertion pattern from `recorder-mcp-grants.test.mjs:203-214`.)
- **tool mismatch:** grant scoped to `recorder.other` → `recorder_raw_sql_inspect` denies with `ERR_RECORDER_MCP_GRANT_TOOL_MISMATCH` (audited denied).
- **expired grant:** grant with elapsed `now` → denies `ERR_RECORDER_MCP_GRANT_EXPIRED`.
- **view allowlist:** unknown `view` → `ERR_RECORDER_MCP_SQL_VIEW_NOT_ALLOWED`, audited denied, no rows.
- **no raw bytes:** assert returned JSON contains no `ocr_text`/`accessibility_text`/`a30_recorder_`/`token_hash` substrings.

### 5.2 Swift (`npm run test:swift:unit`)

- Extend `agentic30Tests/SidecarEventDecodingTests.swift`: decode `recorder_mcp_grants`, `recorder_mcp_grant_created`, `recorder_mcp_grant_revoked` envelopes into `GrantDTO`; assert `state`/`active` map correctly and `proofAcceptedByMcpGrant` decodes false.
- A ViewModel unit test that the three new `send*` methods emit the correct WS `type` + payload keys (use the existing stub-WS harness used by `recorder_raw_api_token_issue` tests).

### 5.3 Hermetic UI (only if a screenshot view is added)

Respect `AGENTIC30_TEST_STUB_PROVIDER=1` + `--ui-testing-opaque-window`; seed deterministic grant rows; no time-of-day assertions (relative-expiry text must be stubbed/clock-injected).

---

## 6. Files Codex will touch

- **ADD** `sidecar/mcp-server.mjs`: register `recorder_raw_sql_inspect` (+ optional `recorder_search`); extend `capabilities` array.
- **ADD** `sidecar/recorder-mcp-tool-host.mjs` (new, Codex-owned): `recorderRawSqlInspectHandler` — wraps Claude-lane `assertPersistedRecorderMcpAccess` + `RecorderStore` + `recordRecorderAudit` + SQL-worker exec.
- **ADD** `sidecar-tests/recorder-mcp-tool-host.test.mjs`.
- **EDIT** `agentic30/AgenticViewModel.swift`: 3 sends + 3 decoders + grant model.
- **ADD** SwiftUI "Recorder MCP Access" pane (new view file under `agentic30/`, registered in the recorder/privacy settings surface).
- **EDIT** `agentic30Tests/SidecarEventDecodingTests.swift`: 3 envelope decode tests.

## 7. Files Codex must NOT edit (Claude lane — reuse only)

`recorder-mcp-grants.mjs`, `recorder-raw-api-auth.mjs`, `recorder-search.mjs`, `recorder-store.mjs`, `recorder-sql-worker.mjs`, `recorder-audit-source.mjs`, `recorder-redaction-policy.mjs`, `recorder-proof-ledger-adapter.mjs`, and all `recorder-*` test files except the new `recorder-mcp-tool-host.test.mjs`. The WS handlers in `index.mjs` already exist — reuse, do not rewrite.

## 8. Acceptance (closes the verified fake-completion)

1. `mcp-server.mjs` exposes ≥1 recorder raw tool that calls `assertRecorderMcpAccess` (via `assertPersistedRecorderMcpAccess`) at a RAW level (`raw_sql`).
2. With no grant the tool denies with a named root cause and audits the denial; with a scoped grant it returns redacted rows and audits acceptance.
3. A `raw_sql` grant does not imply `raw_admin`/`raw_frame`/`raw_audio`.
4. Swift sends/decodes `recorder_mcp_grant_create/_list/_revoke`, with per-tool scoping, TTL ceiling, raw_admin confirmation, and revocation, surfaced in a settings pane.
5. `npm run test:sidecar` + `npm run test:swift:unit` green; the deny-by-default door is now actually openable and observed.
