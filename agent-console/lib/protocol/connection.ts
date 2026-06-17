// ─────────────────────────────────────────────────────────────
// AgentConnectionManager
//
// Manages the WebSocket lifecycle: connect, heartbeat response,
// reconnection with exponential backoff, RESUME-based state
// recovery, and message routing through the ReorderBuffer.
//
// This is a pure TypeScript class with no React dependency.
// React components interact with it via callbacks.
// ─────────────────────────────────────────────────────────────

import type {
  ServerMessage,
  ClientMessage,
  ConnectionStatus,
  ConnectionCallbacks,
  TraceEvent,
} from "./types";
import { ReorderBuffer } from "./reorder-buffer";

let traceIdCounter = 0;
function nextTraceId(): string {
  return `t_${++traceIdCounter}_${Date.now()}`;
}

export class AgentConnectionManager {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "disconnected";
  private url: string;
  private callbacks: ConnectionCallbacks;

  // ── Reconnection ────────────────────────────────────────────
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly MAX_BACKOFF_MS = 8000;
  private readonly BASE_BACKOFF_MS = 500;
  private intentionalClose: boolean = false;
  private hasConnectedBefore: boolean = false;

  // ── Reorder buffer ─────────────────────────────────────────
  private reorderBuffer: ReorderBuffer;

  // ── Ping/Pong tracking (client-side latency) ───────────────
  private lastPingReceivedAt: number = 0;

  constructor(url: string, callbacks: ConnectionCallbacks) {
    this.url = url;
    this.callbacks = callbacks;
    this.reorderBuffer = new ReorderBuffer((msg) => this.handleOrderedMessage(msg));
  }

  // ─────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────

  updateCallbacks(callbacks: ConnectionCallbacks): void {
    this.callbacks = callbacks;
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.intentionalClose = false;
    this.setStatus(this.hasConnectedBefore ? "reconnecting" : "connecting");
    this.createSocket();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close(1000, "client_disconnect");
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  sendUserMessage(content: string): void {
    // Reset the reorder buffer because the server resets its seq on each USER_MESSAGE
    this.reorderBuffer.reset();
    this.send({ type: "USER_MESSAGE", content });
  }

  sendToolAck(callId: string): void {
    this.send({ type: "TOOL_ACK", call_id: callId });
    this.trace("tool", "TOOL_ACK Sent", `Acknowledged tool call ${callId}`);
  }

  /** Current last-processed sequence number for display/debug */
  get lastProcessedSeq(): number {
    return this.reorderBuffer.lastProcessedSeq;
  }

  get bufferStats(): { totalReceived: number; duplicatesDropped: number; reorderedMessages: number; pending: number } {
    return {
      ...this.reorderBuffer.stats,
      pending: this.reorderBuffer.pendingCount,
    };
  }

  get currentStatus(): ConnectionStatus {
    return this.status;
  }

  // ─────────────────────────────────────────────────────────
  // Socket lifecycle
  // ─────────────────────────────────────────────────────────

  private createSocket(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.trace("error", "Connection Failed", `Could not create WebSocket to ${this.url}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.trace("connection", "Connected", `WebSocket connected to ${this.url}`);

      // If we had prior state, send RESUME
      if (this.hasConnectedBefore && this.reorderBuffer.lastProcessedSeq > 0) {
        const lastSeq = this.reorderBuffer.lastProcessedSeq;
        this.send({ type: "RESUME", last_seq: lastSeq });
        this.trace("connection", "RESUME Sent", `Requested replay from seq ${lastSeq}`);
      }

      this.hasConnectedBefore = true;
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleRawMessage(event.data as string);
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.trace(
        "connection",
        "Disconnected",
        `Code: ${event.code}, Reason: ${event.reason || "none"}, Clean: ${event.wasClean}`
      );

      const isReplaced = event.reason === "replaced";

      if (!this.intentionalClose && !isReplaced) {
        this.setStatus("reconnecting");
        this.scheduleReconnect();
      } else {
        this.setStatus("disconnected");
        if (isReplaced) {
          this.trace("connection", "Replaced", "Connection replaced by another client session");
        }
      }
    };

    this.ws.onerror = () => {
      this.trace("error", "WebSocket Error", "Connection error occurred");
      // onclose will fire after onerror, which handles reconnect
    };
  }

  // ─────────────────────────────────────────────────────────
  // Reconnection with exponential backoff
  // ─────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const delay = Math.min(
      this.BASE_BACKOFF_MS * Math.pow(2, this.reconnectAttempts),
      this.MAX_BACKOFF_MS
    );

    // Add jitter (±25%)
    const jitter = delay * (0.75 + Math.random() * 0.5);

    this.trace("connection", "Reconnecting", `Attempt ${this.reconnectAttempts + 1} in ${Math.round(jitter)}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.createSocket();
    }, jitter);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─────────────────────────────────────────────────────────
  // Raw message handling (pre-reorder)
  // ─────────────────────────────────────────────────────────

  private handleRawMessage(data: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      this.trace("error", "Parse Error", `Failed to parse: ${data.slice(0, 100)}`);
      return;
    }

    // ── Respond to PING immediately (before reorder buffer) ──
    // This ensures we never miss the 3-second PONG deadline due
    // to waiting for earlier sequence numbers.
    if (message.type === "PING") {
      this.lastPingReceivedAt = Date.now();
      this.send({ type: "PONG", echo: message.challenge });
      // Still route through reorder buffer for correct timeline ordering
    }

    // ── Feed into reorder buffer ────────────────────────────
    const result = this.reorderBuffer.ingest(message);

    if (result === "duplicate") {
      this.trace("reorder", "Duplicate Dropped", `seq=${message.seq} type=${message.type}`);
    } else if (result === "buffered") {
      this.trace(
        "reorder",
        "Out-of-Order Buffered",
        `seq=${message.seq} type=${message.type} (waiting for seq=${this.reorderBuffer.lastProcessedSeq + 1})`,
        message.seq
      );
    }
  }

  // ─────────────────────────────────────────────────────────
  // Ordered message handling (post-reorder)
  // ─────────────────────────────────────────────────────────

  private handleOrderedMessage(message: ServerMessage): void {
    // Generate trace events for the timeline
    switch (message.type) {
      case "TOKEN":
        // Don't trace every single token (too noisy) — we batch them
        break;
      case "TOOL_CALL":
        this.trace("tool", "Tool Call", `${message.tool_name} (${message.call_id})`, message.seq);
        break;
      case "TOOL_RESULT":
        this.trace("tool", "Tool Result", `Result for ${message.call_id}`, message.seq);
        break;
      case "CONTEXT_SNAPSHOT":
        this.trace("context", "Context Snapshot", `ID: ${message.context_id}`, message.seq);
        break;
      case "PING":
        this.trace("ping", "PING", `Challenge: ${message.challenge || "(empty)"}`, message.seq);
        break;
      case "STREAM_END":
        this.trace("stream", "Stream End", `Stream ${message.stream_id} completed`, message.seq);
        break;
      case "ERROR":
        this.trace("error", "Server Error", `[${message.code}] ${message.message}`, message.seq);
        break;
    }

    // Forward to the React layer
    this.callbacks.onMessage(message);
  }

  // ─────────────────────────────────────────────────────────
  // Send helper
  // ─────────────────────────────────────────────────────────

  private send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  // ─────────────────────────────────────────────────────────
  // Status & Trace helpers
  // ─────────────────────────────────────────────────────────

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.callbacks.onStatusChange(status);
    }
  }

  private trace(category: TraceEvent["category"], label: string, detail: string, seq?: number): void {
    this.callbacks.onTrace({
      id: nextTraceId(),
      timestamp: Date.now(),
      category,
      label,
      detail,
      seq,
    });
  }
}
