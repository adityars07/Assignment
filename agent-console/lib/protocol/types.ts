// ─────────────────────────────────────────────────────────────
// Protocol type definitions for the Agent Console client.
// These mirror the server's canonical types (agent-server/src/types.ts)
// plus client-specific state types.
// ─────────────────────────────────────────────────────────────

// ── Server → Client Messages ──────────────────────────────────

export interface TokenMessage {
  readonly type: "TOKEN";
  readonly seq: number;
  readonly text: string;
  readonly stream_id: string;
}

export interface ToolCallMessage {
  readonly type: "TOOL_CALL";
  readonly seq: number;
  readonly call_id: string;
  readonly tool_name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly stream_id: string;
}

export interface ToolResultMessage {
  readonly type: "TOOL_RESULT";
  readonly seq: number;
  readonly call_id: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly stream_id: string;
}

export interface ContextSnapshotMessage {
  readonly type: "CONTEXT_SNAPSHOT";
  readonly seq: number;
  readonly context_id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface PingMessage {
  readonly type: "PING";
  readonly seq: number;
  readonly challenge: string;
}

export interface StreamEndMessage {
  readonly type: "STREAM_END";
  readonly seq: number;
  readonly stream_id: string;
}

export interface ErrorMessage {
  readonly type: "ERROR";
  readonly seq: number;
  readonly code: string;
  readonly message: string;
}

export type ServerMessage =
  | TokenMessage
  | ToolCallMessage
  | ToolResultMessage
  | ContextSnapshotMessage
  | PingMessage
  | StreamEndMessage
  | ErrorMessage;

// ── Client → Server Messages ──────────────────────────────────

export interface UserMessagePayload {
  readonly type: "USER_MESSAGE";
  readonly content: string;
}

export interface PongPayload {
  readonly type: "PONG";
  readonly echo: string;
}

export interface ResumePayload {
  readonly type: "RESUME";
  readonly last_seq: number;
}

export interface ToolAckPayload {
  readonly type: "TOOL_ACK";
  readonly call_id: string;
}

export type ClientMessage =
  | UserMessagePayload
  | PongPayload
  | ResumePayload
  | ToolAckPayload;

// ── Connection State ──────────────────────────────────────────

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

// ── Trace Event (for the timeline panel) ──────────────────────

export type TraceCategory =
  | "connection"
  | "stream"
  | "tool"
  | "ping"
  | "context"
  | "error"
  | "reorder";

export interface TraceEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly category: TraceCategory;
  readonly label: string;
  readonly detail: string;
  readonly seq?: number;
}

// ── Chat Message Model ────────────────────────────────────────

export type ToolCallStatus = "pending_ack" | "executing" | "completed" | "error";

export interface ToolCallState {
  readonly callId: string;
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: ToolCallStatus;
  readonly result?: Readonly<Record<string, unknown>>;
}

export interface ChatStreamSegment {
  readonly streamId: string;
  readonly tokens: string[];
  readonly toolCalls: ToolCallState[];
  readonly isComplete: boolean;
}

export type ChatEntryRole = "user" | "agent";

export interface ChatEntry {
  readonly id: string;
  readonly role: ChatEntryRole;
  readonly content: string;           // For user messages
  readonly stream?: ChatStreamSegment; // For agent responses
  readonly timestamp: number;
}

// ── Context Snapshot State ────────────────────────────────────

export interface ContextSnapshot {
  readonly contextId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly receivedAt: number;
  readonly seq: number;
}

// ── Connection Manager Callbacks ──────────────────────────────

export interface ConnectionCallbacks {
  onStatusChange: (status: ConnectionStatus) => void;
  onMessage: (message: ServerMessage) => void;
  onTrace: (event: TraceEvent) => void;
}
