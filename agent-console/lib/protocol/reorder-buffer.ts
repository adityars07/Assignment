// ─────────────────────────────────────────────────────────────
// ReorderBuffer
//
// Chaos mode can deliver messages out of order. This buffer
// re-sequences them using the monotonic `seq` field before
// handing them to the application layer.
//
// Design:
// - Maintains `nextExpectedSeq` (starts at 1).
// - Incoming messages with seq < nextExpectedSeq are duplicates → dropped.
// - Messages with seq == nextExpectedSeq are emitted immediately.
// - Messages with seq > nextExpectedSeq are buffered in a sorted array.
// - After emitting, we drain any contiguous messages from the buffer.
// - A `seenSeqs` Set catches duplicates of buffered-but-not-yet-emitted messages.
// - PING messages are also handled through the reorder queue for
//   correct timeline ordering; the connection layer responds to PINGs
//   immediately upon receipt (before reordering) to avoid heartbeat timeout.
// ─────────────────────────────────────────────────────────────

import type { ServerMessage } from "./types";

export type MessageHandler = (message: ServerMessage) => void;

export class ReorderBuffer {
  private nextExpectedSeq: number = 1;
  private buffer: ServerMessage[] = [];
  private seenSeqs: Set<number> = new Set();
  private handler: MessageHandler;

  /** Tracks stats for the trace timeline */
  public stats = {
    totalReceived: 0,
    duplicatesDropped: 0,
    reorderedMessages: 0,
  };

  constructor(handler: MessageHandler) {
    this.handler = handler;
  }

  /**
   * Ingest a server message. It will be emitted in-order via the handler,
   * buffered for later, or dropped as a duplicate.
   *
   * @returns 'emitted' | 'buffered' | 'duplicate'
   */
  ingest(message: ServerMessage): "emitted" | "buffered" | "duplicate" {
    const { seq } = message;
    this.stats.totalReceived++;

    // ── Duplicate check ─────────────────────────────────────
    if (seq < this.nextExpectedSeq || this.seenSeqs.has(seq)) {
      this.stats.duplicatesDropped++;
      return "duplicate";
    }

    this.seenSeqs.add(seq);

    // ── In-order: emit immediately then drain buffer ────────
    if (seq === this.nextExpectedSeq) {
      this.emit(message);
      this.drain();
      return "emitted";
    }

    // ── Out-of-order: insert into sorted buffer ─────────────
    this.stats.reorderedMessages++;
    this.insertSorted(message);
    return "buffered";
  }

  /**
   * Reset the buffer state (e.g. when a new USER_MESSAGE is sent
   * and the server resets its sequence counter).
   */
  reset(): void {
    this.nextExpectedSeq = 1;
    this.buffer = [];
    this.seenSeqs.clear();
    this.stats = {
      totalReceived: 0,
      duplicatesDropped: 0,
      reorderedMessages: 0,
    };
  }

  /**
   * Returns the last sequence number that was emitted in-order
   * to the application layer. Used for RESUME on reconnect.
   */
  get lastProcessedSeq(): number {
    return this.nextExpectedSeq - 1;
  }

  /**
   * Force-set the next expected sequence (used after RESUME replay
   * where the server sends messages with original seq numbers).
   */
  setNextExpectedSeq(seq: number): void {
    this.nextExpectedSeq = seq;
  }

  /** Number of messages currently buffered awaiting earlier seqs */
  get pendingCount(): number {
    return this.buffer.length;
  }

  // ── Internal helpers ────────────────────────────────────────

  private emit(message: ServerMessage): void {
    this.nextExpectedSeq = message.seq + 1;
    this.handler(message);
  }

  /**
   * Drain contiguous messages from the front of the sorted buffer.
   */
  private drain(): void {
    while (this.buffer.length > 0 && this.buffer[0].seq === this.nextExpectedSeq) {
      const msg = this.buffer.shift()!;
      this.emit(msg);
    }
  }

  /**
   * Binary-search insertion to keep buffer sorted by seq.
   */
  private insertSorted(message: ServerMessage): void {
    const { seq } = message;
    let lo = 0;
    let hi = this.buffer.length;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.buffer[mid].seq < seq) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    this.buffer.splice(lo, 0, message);
  }
}
