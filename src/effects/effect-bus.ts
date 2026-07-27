// ---------------------------------------------------------------------------
// EffectBus — pub/sub intercept layer for structural events.
//
// Passives and reactives subscribe by structural trigger (state-write,
// move, reveal, skip-turn) with their owner's player ID. Subscriptions are
// registered when a piece enters a qualifying inventory (or a role is
// assigned) and removed when it leaves.
//
// Scope resolution:
//   'target' — ownerId matches the entity receiving the effect
//   'actor'  — ownerId matches the entity causing the effect
// The bus resolves scope at emit time by comparing ownerId to the event's
// targetId / actorId / pieceOwnerId fields.
//
// Two tiers of pending effect:
//   PendingEffect          — cancel-only (move, reveal, skip-turn)
//   ModifiablePendingEffect — also supports adjust() (state-write)
//
// Adjust semantics (state-write only):
//   delta — additive: modifiedValue += adj.delta
//   mult  — multiplicative: modifiedValue *= adj.mult
// Multiple adjustments accumulate in subscription order. Rounding is left
// to the executor.
//
// emitBefore* methods create the PendingEffect internally and return it.
// Executors check .cancelled before applying and use .modifiedValue for
// the final write.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Local trigger types
// (Mirror gamedef PassiveTrigger — local copies due to TypeScript rootDir
// constraint preventing cross-project path imports.)
// ---------------------------------------------------------------------------

export type StateWriteTrigger = {
  kind: 'state-write';
  scope: 'target' | 'actor';
  /** State path, e.g. 'player.property.hp'. */
  path: string;
  direction: 'increase' | 'decrease' | 'any';
};

export type MoveTrigger = {
  kind: 'move';
  scope: 'target' | 'actor';
  /** Restrict to moves from these inventory type IDs. Omit = any source. */
  fromInventory?: string[];
  /** Restrict to moves to these inventory type IDs. Omit = any destination. */
  toInventory?: string[];
};

export type RevealTrigger = {
  kind: 'reveal';
  scope: 'target' | 'actor';
  /** Restrict to pieces in these inventory type IDs. Omit = any. */
  inventory?: string[];
};

export type SkipTurnTrigger = {
  kind: 'skip-turn';
  // Always target-scoped — ownerId must match the skipped player.
};

export type PassiveTrigger = StateWriteTrigger | MoveTrigger | RevealTrigger | SkipTurnTrigger;

// ---------------------------------------------------------------------------
// Structural event types (emitted by executors)
// ---------------------------------------------------------------------------

export interface StateWriteEvent {
  kind: 'state-write';
  /** State path written, e.g. 'player.property.hp'. */
  path: string;
  /** Whether the new value is higher or lower than the old value. */
  direction: 'increase' | 'decrease';
  /** ID of the player/piece whose property was written. */
  targetId: string;
  /** ID of the player/piece who caused the write. */
  actorId: string;
  /** The numeric value before any passive modifications. */
  resolvedValue: number;
}

export interface MoveEvent {
  kind: 'move';
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
  kind: 'reveal';
  /** Inventory type ID where the revealed piece lives. */
  inventoryType: string;
  /** Player ID who owns the piece being revealed. */
  pieceOwnerId: string;
  /** Player ID who initiated the reveal. */
  actorId: string;
}

export interface SkipTurnEvent {
  kind: 'skip-turn';
  /** Player whose turn is being skipped. */
  targetId: string;
}

export type EffectEvent = StateWriteEvent | MoveEvent | RevealEvent | SkipTurnEvent;

// ---------------------------------------------------------------------------
// Pending effect interfaces
// ---------------------------------------------------------------------------

export type EventKind = 'state-write' | 'move' | 'reveal' | 'skip-turn';

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
// Handler types
// ---------------------------------------------------------------------------

export type BeforeHandler = (pending: PendingEffect) => void;
export type AfterHandler  = (event: EffectEvent) => void;

// ---------------------------------------------------------------------------
// Concrete implementations
// ---------------------------------------------------------------------------

class PendingEffectImpl implements PendingEffect {
  private _cancelled = false;
  constructor(readonly kind: EventKind) {}
  cancel(): void { this._cancelled = true; }
  get cancelled(): boolean { return this._cancelled; }
}

class AdjustablePendingEffectImpl extends PendingEffectImpl implements AdjustablePendingEffect {
  private _modifiedValue: number;

  constructor(kind: EventKind, readonly resolvedValue: number) {
    super(kind);
    this._modifiedValue = resolvedValue;
  }

  adjust(adj: { delta: number } | { mult: number }): void {
    if ('delta' in adj) {
      this._modifiedValue += adj.delta;
    } else {
      this._modifiedValue *= adj.mult;
    }
  }

  get adjustedValue(): number { return this._modifiedValue; }
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
// Trigger matching
// ---------------------------------------------------------------------------

function matchesTrigger(
  trigger: PassiveTrigger,
  ownerId: string,
  event: EffectEvent,
): boolean {
  if (trigger.kind !== event.kind) return false;

  // skip-turn is always target-scoped — ownerId must be the skipped player
  if (trigger.kind === 'skip-turn') {
    return (event as SkipTurnEvent).targetId === ownerId;
  }

  const isTarget =
    event.kind === 'state-write' ? event.targetId === ownerId :
    event.kind === 'move'        ? event.pieceOwnerId === ownerId :
    event.kind === 'reveal'      ? event.pieceOwnerId === ownerId :
    false;

  const isActor =
    event.kind === 'state-write' ? event.actorId === ownerId :
    event.kind === 'move'        ? event.actorId === ownerId :
    event.kind === 'reveal'      ? event.actorId === ownerId :
    false;

  if (trigger.scope === 'target' && !isTarget) return false;
  if (trigger.scope === 'actor'  && !isActor)  return false;

  // Kind-specific filter matching
  if (trigger.kind === 'state-write' && event.kind === 'state-write') {
    if (trigger.path !== event.path) return false;
    if (trigger.direction !== 'any' && trigger.direction !== event.direction) return false;
  }

  if (trigger.kind === 'move' && event.kind === 'move') {
    if (trigger.fromInventory && !trigger.fromInventory.includes(event.fromInventoryType)) return false;
    if (trigger.toInventory   && !trigger.toInventory.includes(event.toInventoryType))     return false;
  }

  if (trigger.kind === 'reveal' && event.kind === 'reveal') {
    if (trigger.inventory && !trigger.inventory.includes(event.inventoryType)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Subscription entry (internal)
// ---------------------------------------------------------------------------

interface SubscriptionEntry<H> {
  trigger: PassiveTrigger;
  ownerId: string;
  handler: H;
}

// ---------------------------------------------------------------------------
// EffectBus
// ---------------------------------------------------------------------------

export class EffectBus {
  private readonly before: SubscriptionEntry<BeforeHandler>[] = [];
  private readonly after:  SubscriptionEntry<AfterHandler>[]  = [];

  /**
   * Subscribe to before-signals matching the given structural trigger.
   * ownerId is the player holding the passive/reactive piece — used to resolve
   * trigger.scope (target vs actor) at match time.
   * Returns an unsubscribe function; call it when the passive deactivates.
   */
  onBefore(trigger: PassiveTrigger, ownerId: string, handler: BeforeHandler): () => void {
    const entry: SubscriptionEntry<BeforeHandler> = { trigger, ownerId, handler };
    this.before.push(entry);
    return () => {
      const idx = this.before.indexOf(entry);
      if (idx >= 0) this.before.splice(idx, 1);
    };
  }

  /**
   * Subscribe to after-signals matching the given structural trigger.
   * Returns an unsubscribe function.
   */
  onAfter(trigger: PassiveTrigger, ownerId: string, handler: AfterHandler): () => void {
    const entry: SubscriptionEntry<AfterHandler> = { trigger, ownerId, handler };
    this.after.push(entry);
    return () => {
      const idx = this.after.indexOf(entry);
      if (idx >= 0) this.after.splice(idx, 1);
    };
  }

  // ---------------------------------------------------------------------------
  // Before emitters — called by executors before applying the effect.
  // Creates and returns the PendingEffect; executor checks .cancelled and
  // uses .modifiedValue for the final write.
  // ---------------------------------------------------------------------------

  emitBeforeStateWrite(event: StateWriteEvent): AdjustablePendingEffect {
    const pending = new AdjustablePendingEffectImpl('state-write', event.resolvedValue);
    for (const sub of [...this.before]) {  // ← shallow copy
        if (pending.cancelled) break;
        if (matchesTrigger(sub.trigger, sub.ownerId, event)) sub.handler(pending);
    }
    return pending;
  }

  emitBeforeMove(event: MoveEvent): PendingEffect {
    const pending = new PendingEffectImpl('move');
    for (const sub of [...this.before]) {  // ← shallow copy
        if (pending.cancelled) break;
        if (matchesTrigger(sub.trigger, sub.ownerId, event)) sub.handler(pending);
    }
    return pending;
  }

  emitBeforeReveal(event: RevealEvent): PendingEffect {
    const pending = new PendingEffectImpl('reveal');
    for (const sub of [...this.before]) {  // ← shallow copy
        if (pending.cancelled) break;
        if (matchesTrigger(sub.trigger, sub.ownerId, event)) sub.handler(pending);
    }
    return pending;
  }

  emitBeforeSkipTurn(targetId: string): PendingEffect {
    const event: SkipTurnEvent = { kind: 'skip-turn', targetId };
    const pending = new PendingEffectImpl('skip-turn');
    for (const sub of [...this.before]) {  // ← shallow copy
        if (pending.cancelled) break;
        if (matchesTrigger(sub.trigger, sub.ownerId, event)) sub.handler(pending);
    }
    return pending;
  }

  // ---------------------------------------------------------------------------
  // After emitters — called by executors after successfully applying the effect.
  // ---------------------------------------------------------------------------

  emitAfterStateWrite(event: StateWriteEvent): void {
    for (const sub of [...this.after]) {  // ← shallow copy
      if (matchesTrigger(sub.trigger, sub.ownerId, event)) sub.handler(event);
    }
  }

  emitAfterMove(event: MoveEvent): void {
    for (const sub of [...this.after]) {  // ← shallow copy
      if (matchesTrigger(sub.trigger, sub.ownerId, event)) sub.handler(event);
    }
  }

  emitAfterReveal(event: RevealEvent): void {
    for (const sub of [...this.after]) {  // ← shallow copy
      if (matchesTrigger(sub.trigger, sub.ownerId, event)) sub.handler(event);
    }
  }

  emitAfterSkipTurn(targetId: string): void {
    const event: SkipTurnEvent = { kind: 'skip-turn', targetId };
    for (const sub of [...this.after]) {  // ← shallow copy
      if (matchesTrigger(sub.trigger, sub.ownerId, event)) sub.handler(event);
    }
  }
}
