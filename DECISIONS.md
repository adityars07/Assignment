# DECISIONS.md — Agent Console Design Decisions

This document explains key architectural and implementation decisions made while building the Agent Console.

---

## 1. State Management: Pure TypeScript Class + React State

**Decision:** Use a standalone `AgentConnectionManager` class (pure TypeScript, no React) for the WebSocket lifecycle, with React `useState`/`useCallback`/`useRef` for UI state.

**Alternatives considered:**
- **Zustand / Redux:** Would add external dependencies. The state shape here is simple enough that React's built-in primitives suffice. The complexity lies in the *protocol layer*, not the *state management*.
- **`useReducer`:** Considered, but the message handler logic is more naturally expressed as imperative mutations on a ref-tracked active stream, not as a pure reducer. The `activeStreamRef` pattern allows us to mutate in-place without stale closure issues.

**Rationale:**
- The WebSocket protocol handler (PING/PONG, reorder buffer, RESUME) must operate independently of React's render cycle. Putting it in a `useEffect` or hook creates stale closure risks with rapidly changing state. A standalone class with callback-based communication avoids this entirely.
- React state is used only for what needs to trigger re-renders: chat entries, trace events, context snapshots, and connection status.
- The `activeStreamRef` pattern lets the message handler append tokens without re-rendering for intermediate state calculations.

---

## 2. PING/PONG: Bypass Reorder Buffer

**Decision:** Respond to PING messages immediately upon receipt (before the reorder buffer), while still routing them through the reorder buffer for timeline display.

**Rationale:**
- The server expects a PONG within 3 seconds. If the reorder buffer is waiting for a missing earlier sequence number, the PING could be delayed indefinitely, causing a heartbeat timeout.
- By sending PONG immediately and independently routing the PING through reorder for display, we satisfy the server's timing requirement while maintaining correct timeline ordering.
- Empty challenge strings (chaos mode corrupt heartbeats) are echoed as-is — the server accepts whatever is echoed back.

---

## 3. Reorder Buffer: Binary-Search Sorted Array

**Decision:** Use a sorted array with binary-search insertion for the reorder buffer instead of a min-heap.

**Alternatives considered:**
- **Min-heap:** Asymptotically optimal (O(log n) insert/extract), but the buffer size is small (chaos reorder window is 4 messages). The overhead of heap maintenance is unnecessary.
- **Simple array with sort-on-insert:** O(n) worst case, but n ≤ ~10 in practice. Simpler to reason about and debug.

**Rationale:**
- The server's chaos engine uses a reorder buffer of size 4 with Fisher-Yates shuffle. This means at most ~4 messages will be out of order at any time. For such small buffers, a sorted array with `splice` is faster in practice than a heap due to cache locality and lower constant factors.
- The `seenSeqs` Set provides O(1) duplicate detection.

---

## 4. Sequence Reset on USER_MESSAGE

**Decision:** Reset the reorder buffer (including `nextExpectedSeq`, `seenSeqs`, and stats) every time the client sends a `USER_MESSAGE`.

**Rationale:**
- The server resets its sequence counter to 0 on each `USER_MESSAGE` (see `handleUserMessage()` in `server.ts` line 210). If we don't reset the client's buffer, all messages from the new conversation turn would be treated as duplicates.
- Context snapshots are also cleared per turn, matching the server's fresh-start semantics.

---

## 5. TOOL_ACK: Auto-Send on Render

**Decision:** Send `TOOL_ACK` automatically when a `ToolCallCard` component mounts (via `useEffect`), using a ref guard to prevent double-acks.

**Alternatives considered:**
- **Manual user acknowledgement:** The assignment specifies "send TOOL_ACK when it renders a tool call card," meaning the act of rendering *is* the acknowledgement.
- **Send from message handler:** This would be faster but wouldn't prove the card was actually *rendered* to the user.

**Rationale:**
- The server has a 5-second timeout for TOOL_ACK. Sending on mount ensures the ACK is sent as soon as the user can see the card, which is the semantic intent of the protocol.
- The `ackSentRef` prevents re-acks if React re-renders the component (e.g., due to parent state changes).

---

## 6. CSS: Vanilla CSS with Custom Properties

**Decision:** Use vanilla CSS with CSS custom properties (variables) instead of Tailwind CSS or CSS-in-JS.

**Rationale:**
- No additional build tooling or dependencies required.
- CSS custom properties provide a clean design token system (colors, spacing, radii, shadows) that's easy to modify and reason about.
- The assignment evaluates function over form, but a professional dark-theme UI with glassmorphism and smooth animations demonstrates frontend competence without adding bloat.

---

## 7. RESUME Strategy

**Decision:** On reconnection, send `RESUME` with `lastProcessedSeq` (the last sequence number that was emitted in-order from the reorder buffer), not the last *received* seq.

**Rationale:**
- `lastProcessedSeq` represents what the UI has actually consumed. If we used the last received seq, we might skip messages that were received out-of-order but not yet processed (still in the buffer).
- The server replays via `rawSend` (bypassing chaos), so replayed messages arrive in order and can be processed normally.
- The buffer is not reset on reconnect — buffered messages from before the drop are retained and will be drained when the replay fills the gaps.

---

## 8. Context Inspector: Recursive Diff with Depth Cap

**Decision:** Implement a recursive JSON diff engine with a maximum depth of 12 levels, and display diffs in a collapsible tree.

**Alternatives considered:**
- **`json-diff` npm package:** Adds an external dependency. The diff logic is straightforward enough to implement in ~170 lines.
- **Flat key-path diffing:** Simpler but loses the hierarchical structure that makes large diffs navigable.

**Rationale:**
- The server can send 500KB+ context snapshots with deeply nested structures (64 tables with columns, metadata, relationships). A flat diff would produce thousands of entries. The tree structure with collapsible nodes makes it manageable.
- The depth cap of 12 prevents stack overflow and UI freeze on adversarial inputs.
- Unchanged subtrees are collapsed by default (expanded only at depth < 2 or when changed), keeping the UI focused on what changed.

---

## 9. Trace Timeline: DOM-Capped Event List

**Decision:** Cap the visible trace event list at 500 entries, showing only the most recent.

**Alternatives considered:**
- **Virtual scrolling (react-window):** Would handle unlimited events, but adds a dependency and complexity for marginal benefit.
- **No cap:** Risk of DOM bloat and jank with thousands of trace events during long chaos sessions.

**Rationale:**
- In chaos mode, the trace can accumulate hundreds of events per minute. Rendering all of them causes DOM bloat. The 500-event cap keeps the UI responsive.
- The full event array is kept in React state (for counting), but only the last 500 are rendered.
- Auto-scroll with manual override (scroll up pauses, "scroll to latest" button appears) gives the user control.

---

## 10. No `any` Types

**Decision:** Zero `any` types across the entire codebase. All protocol messages use `Readonly<Record<string, unknown>>` for dynamic data fields.

**Rationale:**
- The assignment explicitly prohibits `any` types (except in a single documented escape hatch file).
- `unknown` forces explicit type narrowing, catching bugs at compile time.
- `Readonly` on message types prevents accidental mutation of shared state.
