// ---------------------------------------------------------------------------
// EffectBus — pub/sub intercept layer for structural events.
//
// A dumb router: indexes BeforeEntry/AfterEntry records by event kind and
// dispatches them at emit time. All scope/owner/trigger matching is the
// caller's responsibility (see passive-matcher.ts).
//
// Registration:
//   bus.onBefore(kind, { match, act }) — returns an unsubscribe fn
//   bus.onAfter(kind,  { match, act }) — returns an unsubscribe fn
//
// Dispatch (before):
//   Iterates entries registered for the event kind. Calls match(event,
//   session); if true, calls act(pending, event, session). Short-circuits
//   once pending.cancelled is true.
//
// Dispatch (after):
//   Iterates entries registered for the event kind. Calls match then act.
//   No cancel concept.
//
// Two tiers of pending effect:
//   PendingEffect          — cancel-only (move, reveal, skip-turn)
//   AdjustablePendingEffect — also supports adjust() (state-write)
//
// Adjust semantics (state-write only):
//   delta — additive: modifiedValue += adj.delta
//   mult  — multiplicative: modifiedValue *= adj.mult
// Multiple adjustments accumulate in entry order. Rounding is left to the executor.
//
// emitBefore* methods create the PendingEffect internally and return it.
// Executors check .cancelled before applying and use .adjustedValue for
// the final write.
// ---------------------------------------------------------------------------

import type { GameSession } from "#chaincraft/types.js";

// ---------------------------------------------------------------------------
// Local trigger types
// (Mirror gamedef PassiveTrigger — local copies due to TypeScript rootDir
// constraint preventing cross-project path imports.)
// ---------------------------------------------------------------------------

export type StateWriteTrigger = {
  kind: "state-write";
  scope: "target" | "actor";
  /** State path, e.g. 'player.property.hp'. */
  path: string;
  direction: "increase" | "decrease" | "any";
};

export type MoveTrigger = {
  kind: "move";
  scope: "target" | "actor";
  /** Restrict to moves from these inventory type IDs. Omit = any source. */
  fromInventory?: string[];
  /** Restrict to moves to these inventory type IDs. Omit = any destination. */
  toInventory?: string[];
};

export type RevealTrigger = {
  kind: "reveal";
  scope: "target" | "actor";
  /** Restrict to pieces in these inventory type IDs. Omit = any. */
  inventory?: string[];
};

export type SkipTurnTrigger = {
  kind: "skip-turn";
  // Always target-scoped — ownerId must match the skipped player.
};

export type PassiveTrigger =
  | StateWriteTrigger
  | MoveTrigger
  | RevealTrigger
  | SkipTurnTrigger;

// ---------------------------------------------------------------------------
// Structural event types (emitted by executors)
// ---------------------------------------------------------------------------

export interface StateWriteEvent {
  kind: "state-write";
  /** State path written, e.g. 'player.property.hp'. */
  path: string;
  /** Whether the new value is higher or lower than the old value. */
  direction: "increase" | "decrease";
  /** ID of the player/piece whose property was written. */
  targetId: string;
  /** ID of the player/piece who caused the write. */
  actorId: string;
  /** The numeric value before any passive modifications. */
  resolvedValue: number;
}

export interface MoveEvent {
  kind: "move";
  /** Inventory type ID the piece came from. */
  fromInventoryType: string;
  /** Inventory type ID the piece was moved to. */
  toInventoryType: string;
  /** Player ID who owns the piece being moved. */
  pieceOwnerId: string;
  /** Player ID who initiated the move. */
  actorId: string;
}

export interface RevealEvent {
  kind: "reveal";
  /** Inventory type ID where the revealed piece lives. */
  inventoryType: string;
  /** Player ID who owns the piece being revealed. */
  pieceOwnerId: string;
  /** Player ID who initiated the reveal. */
  actorId: string;
}

export interface SkipTurnEvent {
  kind: "skip-turn";
  /** Player whose turn is being skipped. */
  targetId: string;
}

export type EffectEvent =
  | StateWriteEvent
  | MoveEvent
  | RevealEvent
  | SkipTurnEvent;

// ---------------------------------------------------------------------------
// Pending effect interfaces
// ---------------------------------------------------------------------------

export type EventKind = "state-write" | "move" | "reveal" | "skip-turn";

export interface PendingEffect {
  /** The structural kind of event being intercepted. */
  readonly kind: EventKind;
  /** Prevent the effect from executing. Idempotent. */
  cancel(): void;
  /** True if cancel() has been called by any subscriber. */
  readonly cancelled: boolean;
}

export interface AdjustablePendingEffect extends PendingEffect {
  /** The numeric value resolved before any modifications. */
  readonly resolvedValue: number;
  /**
   * Adjust the value before it is written to state.
   *   delta — additive (positive augments, negative reduces)
   *   mult  — multiplicative (e.g. 0.5 halves, 2 doubles)
   * Multiple calls accumulate. Rounding is left to the executor.
   */
  adjust(adj: { delta: number } | { mult: number }): void;
  /** The value after all adjust() calls — what the executor will write. */
  readonly adjustedValue: number;
}

// ---------------------------------------------------------------------------
// Handler entry types
// ---------------------------------------------------------------------------

export interface BeforeEntry {
  match: (event: EffectEvent, session: GameSession) => boolean;
  act: (
    pending: PendingEffect,
    event: EffectEvent,
    session: GameSession,
  ) => void;
}

export interface AfterEntry {
  match: (event: EffectEvent, session: GameSession) => boolean;
  // may return a Promise; bus calls without await (inline-pragmatic for demo scope)
  act: (event: EffectEvent, session: GameSession) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Concrete implementations
// ---------------------------------------------------------------------------

class PendingEffectImpl implements PendingEffect {
  private _cancelled = false;
  constructor(readonly kind: EventKind) {}
  cancel(): void {
    this._cancelled = true;
  }
  get cancelled(): boolean {
    return this._cancelled;
  }
}

class AdjustablePendingEffectImpl
  extends PendingEffectImpl
  implements AdjustablePendingEffect
{
  private _modifiedValue: number;

  constructor(
    kind: EventKind,
    readonly resolvedValue: number,
  ) {
    super(kind);
    this._modifiedValue = resolvedValue;
  }

  adjust(adj: { delta: number } | { mult: number }): void {
    if ("delta" in adj) {
      this._modifiedValue += adj.delta;
    } else {
      this._modifiedValue *= adj.mult;
    }
  }

  get adjustedValue(): number {
    return this._modifiedValue;
  }
}

// ---------------------------------------------------------------------------
// Factory functions (useful for testing handlers in isolation)
// ---------------------------------------------------------------------------

export function createPendingEffect(kind: EventKind): PendingEffect {
  return new PendingEffectImpl(kind);
}

export function createAdjustablePendingEffect(
  kind: EventKind,
  resolvedValue: number,
): AdjustablePendingEffect {
  return new AdjustablePendingEffectImpl(kind, resolvedValue);
}

// ---------------------------------------------------------------------------
// EffectBus
// ---------------------------------------------------------------------------

export class EffectBus {
  private readonly before: Partial<Record<EventKind, BeforeEntry[]>> = {};
  private readonly after: Partial<Record<EventKind, AfterEntry[]>> = {};

  /** Returns an unsubscribe function. */
  onBefore(kind: EventKind, entry: BeforeEntry): () => void {
    const list = (this.before[kind] ??= []);
    list.push(entry);
    return () => {
      const idx = list.indexOf(entry);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  /** Returns an unsubscribe function. */
  onAfter(kind: EventKind, entry: AfterEntry): () => void {
    const list = (this.after[kind] ??= []);
    list.push(entry);
    return () => {
      const idx = list.indexOf(entry);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  // ---------------------------------------------------------------------------
  // Before emitters — called by executors before applying the effect.
  // Creates and returns the PendingEffect; executor checks .cancelled and
  // uses .adjustedValue for the final write.
  // ---------------------------------------------------------------------------

  emitBeforeStateWrite(
    event: StateWriteEvent,
    session: GameSession,
  ): AdjustablePendingEffect {
    const pending = new AdjustablePendingEffectImpl(
      "state-write",
      event.resolvedValue,
    );
    for (const entry of [...(this.before["state-write"] ?? [])]) {
      if (pending.cancelled) break;
      if (entry.match(event, session)) entry.act(pending, event, session);
    }
    return pending;
  }

  emitBeforeMove(event: MoveEvent, session: GameSession): PendingEffect {
    const pending = new PendingEffectImpl("move");
    for (const entry of [...(this.before["move"] ?? [])]) {
      if (pending.cancelled) break;
      if (entry.match(event, session)) entry.act(pending, event, session);
    }
    return pending;
  }

  emitBeforeReveal(event: RevealEvent, session: GameSession): PendingEffect {
    const pending = new PendingEffectImpl("reveal");
    for (const entry of [...(this.before["reveal"] ?? [])]) {
      if (pending.cancelled) break;
      if (entry.match(event, session)) entry.act(pending, event, session);
    }
    return pending;
  }

  emitBeforeSkipTurn(targetId: string, session: GameSession): PendingEffect {
    const event: SkipTurnEvent = { kind: "skip-turn", targetId };
    const pending = new PendingEffectImpl("skip-turn");
    for (const entry of [...(this.before["skip-turn"] ?? [])]) {
      if (pending.cancelled) break;
      if (entry.match(event, session)) entry.act(pending, event, session);
    }
    return pending;
  }

  // ---------------------------------------------------------------------------
  // After emitters — called by executors after successfully applying the effect.
  // ---------------------------------------------------------------------------

  async emitAfterStateWrite(event: StateWriteEvent, session: GameSession): Promise<void> {
    for (const entry of [...(this.after["state-write"] ?? [])]) {
      if (entry.match(event, session)) {
        const r = entry.act(event, session);
        if (r) await r;
      }
    }
  }

  async emitAfterMove(event: MoveEvent, session: GameSession): Promise<void> {
    for (const entry of [...(this.after["move"] ?? [])]) {
      if (entry.match(event, session)) {
        const r = entry.act(event, session);
        if (r) await r;
      }
    }
  }

  async emitAfterReveal(event: RevealEvent, session: GameSession): Promise<void> {
    for (const entry of [...(this.after["reveal"] ?? [])]) {
      if (entry.match(event, session)) {
        const r = entry.act(event, session);
        if (r) await r;
      }
    }
  }

  async emitAfterSkipTurn(targetId: string, session: GameSession): Promise<void> {
    const event: SkipTurnEvent = { kind: "skip-turn", targetId };
    for (const entry of [...(this.after["skip-turn"] ?? [])]) {
      if (entry.match(event, session)) {
        const r = entry.act(event, session);
        if (r) await r;
      }
    }
  }
}
