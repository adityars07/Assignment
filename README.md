# Agent Console

A Next.js 14+ application that connects to a mock AI agent backend over WebSockets, renders streaming responses with mid-stream tool call interruptions, displays a live agent trace timeline, and survives chaos mode without crashing or losing state.

## Quick Start

```bash
# 1. Start the agent server (Docker)
cd agent-server
docker build -t agent-server .
docker run -p 4747:4747 agent-server                # normal mode
docker run -p 4747:4747 agent-server --mode chaos    # chaos mode

# 2. Start the Agent Console
cd agent-console
npm install
npm run build
npm run start
# Open http://localhost:3000
```

## Development

```bash
cd agent-console
npm run dev
# Open http://localhost:3000
```

## Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Agent Console (Browser)                │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │              React UI Layer (page.tsx)            │    │
│  │                                                  │    │
│  │  ┌─────────────┐ ┌──────────┐ ┌──────────────┐  │    │
│  │  │ Context      │ │  Chat    │ │  Trace       │  │    │
│  │  │ Inspector    │ │  Console │ │  Timeline    │  │    │
│  │  └─────────────┘ └──────────┘ └──────────────┘  │    │
│  └──────────────────────┬───────────────────────────┘    │
│                         │ callbacks                      │
│  ┌──────────────────────▼───────────────────────────┐    │
│  │         AgentConnectionManager (pure TS)          │    │
│  │                                                   │    │
│  │  ┌──────────────┐  ┌────────────────────────┐    │    │
│  │  │  WebSocket    │  │    ReorderBuffer       │    │    │
│  │  │  Lifecycle    │──│  • Binary-search insert │    │    │
│  │  │  • Connect    │  │  • Dedup via Set       │    │    │
│  │  │  • Reconnect  │  │  • Contiguous drain    │    │    │
│  │  │  • PING/PONG  │  └────────────────────────┘    │    │
│  │  │  • RESUME     │                                │    │
│  │  └──────────────┘                                 │    │
│  └───────────────────────────────────────────────────┘    │
│                         │ WebSocket                      │
└─────────────────────────┼────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   Agent Server :4747  │
              │   (Docker container)  │
              └───────────────────────┘
```

### Connection State Machine

```
                    ┌─────────────┐
                    │ DISCONNECTED│◄──── user calls disconnect()
                    └──────┬──────┘
                           │ connect()
                           ▼
                    ┌─────────────┐
               ┌───►│ CONNECTING  │
               │    └──────┬──────┘
               │           │ ws.onopen
               │           ▼
               │    ┌─────────────┐
               │    │  CONNECTED  │◄──── RESUME sent if hasConnectedBefore
               │    └──────┬──────┘
               │           │ ws.onclose (not intentional)
               │           ▼
               │    ┌──────────────┐
               └────┤ RECONNECTING │
                    │  (exp. backoff│
                    │   + jitter)   │
                    └──────────────┘
```

### Message Processing Pipeline

```
  Server Message (raw JSON)
        │
        ▼
  ┌─────────────────┐
  │  Parse JSON      │──── Parse error → trace "error"
  │                   │
  │  If PING:         │──── Immediately send PONG
  │  (bypass reorder) │     (avoids 3s timeout)
  └─────────┬─────────┘
            ▼
  ┌─────────────────────┐
  │   ReorderBuffer     │
  │                     │
  │  seq < expected?  ──│──► DUPLICATE → dropped
  │  seq == expected? ──│──► EMIT → drain buffer
  │  seq > expected?  ──│──► BUFFER → sorted insert
  └─────────┬───────────┘
            │ in-order
            ▼
  ┌─────────────────────┐
  │  handleOrderedMsg() │
  │                     │
  │  TOKEN        → append to stream
  │  TOOL_CALL    → add card (auto-ACK on render)
  │  TOOL_RESULT  → update card status
  │  CONTEXT_SNAP → add to snapshots
  │  STREAM_END   → mark complete
  │  PING         → (trace only, PONG already sent)
  │  ERROR        → trace timeline
  └─────────────────────┘
```

### Chaos Mode Resilience

| Chaos Behavior | Client Countermeasure |
|---|---|
| Out-of-order messages | ReorderBuffer with binary-search sorted insertion and contiguous drain |
| Duplicate messages | `seenSeqs` Set rejects messages with seq ≤ lastProcessedSeq or already in buffer |
| Connection drops | Exponential backoff reconnection (500ms–8s + jitter), RESUME with `last_seq` |
| Corrupt heartbeats (empty challenge) | Echo whatever challenge string is provided, including empty |
| Latency spikes | PING/PONG bypasses reorder buffer for immediate response |
| 500KB+ context | Recursive diff with lazy tree expansion, max depth cap at 12 |

## Project Structure

```
agent-console/
├── app/
│   ├── globals.css            # Design system (dark glassmorphism)
│   ├── layout.tsx             # Root layout + Inter font
│   └── page.tsx               # Dashboard coordinator
├── components/
│   ├── ChatConsole.tsx        # Streaming chat + tool call cards
│   ├── ConnectionBadge.tsx    # Connection state indicator
│   ├── ContextInspector.tsx   # JSON diff tree viewer
│   └── TraceTimeline.tsx      # Real-time event feed
├── lib/
│   ├── protocol/
│   │   ├── types.ts           # All protocol + state types
│   │   ├── connection.ts      # WebSocket manager
│   │   └── reorder-buffer.ts  # Sequence reorder + dedup
│   └── utils/
│       └── diff.ts            # JSON deep-diff engine
└── agent-server/              # Mock backend (not modified)
```

## Verification

After running the console, verify protocol compliance:

```bash
curl -s http://localhost:4747/log | python3 -m json.tool
```

All entries should show `"verdict": "ok"`.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript (strict mode, zero `any` types)
- **Styling**: Vanilla CSS with CSS custom properties
- **State Management**: React `useState`/`useCallback`/`useRef` + pure TypeScript `AgentConnectionManager` class
- **No external dependencies**: No AI chat libraries, no `@ts-ignore`
