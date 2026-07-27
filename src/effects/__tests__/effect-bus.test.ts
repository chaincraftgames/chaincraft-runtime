import {
  EffectBus,
  createPendingEffect,
  createAdjustablePendingEffect,
} from '../effect-bus.js';
import type {
  PendingEffect,
  AdjustablePendingEffect,
  StateWriteEvent,
  MoveEvent,
  RevealEvent,
} from '../effect-bus.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStateWrite(overrides: Partial<StateWriteEvent> = {}): StateWriteEvent {
  return {
    kind: 'state-write',
    path: 'player.property.hp',
    direction: 'decrease',
    targetId: 'player-a',
    actorId: 'player-b',
    resolvedValue: -5,
    ...overrides,
  };
}

function makeMove(overrides: Partial<MoveEvent> = {}): MoveEvent {
  return {
    kind: 'move',
    fromInventoryType: 'hand',
    toInventoryType: 'discard',
    pieceOwnerId: 'player-a',
    actorId: 'player-b',
    ...overrides,
  };
}

function makeReveal(overrides: Partial<RevealEvent> = {}): RevealEvent {
  return {
    kind: 'reveal',
    inventoryType: 'hand',
    pieceOwnerId: 'player-a',
    actorId: 'player-b',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PendingEffect
// ---------------------------------------------------------------------------

describe('createPendingEffect', () => {
  it('exposes kind', () => {
    const p = createPendingEffect('state-write');
    expect(p.kind).toBe('state-write');
  });

  it('starts not cancelled', () => {
    const p = createPendingEffect('move');
    expect(p.cancelled).toBe(false);
  });

  it('cancel() sets cancelled to true', () => {
    const p = createPendingEffect('state-write');
    p.cancel();
    expect(p.cancelled).toBe(true);
  });

  it('cancel() is idempotent', () => {
    const p = createPendingEffect('reveal');
    p.cancel();
    p.cancel();
    expect(p.cancelled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ModifiablePendingEffect
// ---------------------------------------------------------------------------

describe('createAdjustablePendingEffect', () => {
  it('exposes resolvedValue', () => {
    const p = createAdjustablePendingEffect('state-write', -5);
    expect(p.resolvedValue).toBe(-5);
  });

  it('modifiedValue starts equal to resolvedValue', () => {
    const p = createAdjustablePendingEffect('state-write', -5);
    expect(p.adjustedValue).toBe(-5);
  });

  it('adjust({ delta }) adds to modifiedValue', () => {
    const p = createAdjustablePendingEffect('state-write', -5);
    p.adjust({ delta: 2 }); // armor: reduce damage by 2
    expect(p.adjustedValue).toBe(-3);
  });

  it('adjust({ mult }) scales modifiedValue', () => {
    const p = createAdjustablePendingEffect('state-write', -6);
    p.adjust({ mult: 0.5 }); // shield: halve damage
    expect(p.adjustedValue).toBe(-3);
  });

  it('multiple adjust() calls accumulate', () => {
    const p = createAdjustablePendingEffect('state-write', -10);
    p.adjust({ delta: 2 });  // armor: -10 + 2 = -8
    p.adjust({ mult: 0.5 }); // shield: -8 * 0.5 = -4
    expect(p.adjustedValue).toBe(-4);
  });

  it('adjust({ delta }) with negative delta amplifies', () => {
    const p = createAdjustablePendingEffect('state-write', -5);
    p.adjust({ delta: -3 }); // curse: increase damage by 3
    expect(p.adjustedValue).toBe(-8);
  });

  it('resolvedValue is unchanged after adjust()', () => {
    const p = createAdjustablePendingEffect('state-write', -5);
    p.adjust({ delta: 2 });
    expect(p.resolvedValue).toBe(-5);
  });

  it('inherits cancel() from PendingEffect', () => {
    const p = createAdjustablePendingEffect('state-write', -5);
    p.cancel();
    expect(p.cancelled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EffectBus — state-write before events
// ---------------------------------------------------------------------------

describe('EffectBus — emitBeforeStateWrite', () => {
  it('calls handler when trigger matches (target scope, path, direction)', () => {
    const bus = new EffectBus();
    const calls: string[] = [];
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.hp', direction: 'decrease' },
      'player-a',
      (p) => calls.push(p.kind),
    );
    bus.emitBeforeStateWrite(makeStateWrite());
    expect(calls).toEqual(['state-write']);
  });

  it('does not call handler when ownerId is actor but scope is target', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.hp', direction: 'any' },
      'player-b', // player-b is actorId in event, not targetId
      () => calls.push(1),
    );
    bus.emitBeforeStateWrite(makeStateWrite({ targetId: 'player-a', actorId: 'player-b' }));
    expect(calls).toHaveLength(0);
  });

  it('calls handler when ownerId is actor and scope is actor', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore(
      { kind: 'state-write', scope: 'actor', path: 'player.property.hp', direction: 'decrease' },
      'player-b',
      () => calls.push(1),
    );
    bus.emitBeforeStateWrite(makeStateWrite({ targetId: 'player-a', actorId: 'player-b' }));
    expect(calls).toEqual([1]);
  });

  it('does not call handler when path does not match', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.mp', direction: 'any' },
      'player-a',
      () => calls.push(1),
    );
    bus.emitBeforeStateWrite(makeStateWrite({ path: 'player.property.hp' }));
    expect(calls).toHaveLength(0);
  });

  it('does not call handler when direction filter does not match', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.hp', direction: 'decrease' },
      'player-a',
      () => calls.push(1),
    );
    bus.emitBeforeStateWrite(makeStateWrite({ direction: 'increase' }));
    expect(calls).toHaveLength(0);
  });

  it('calls handler for both directions when direction is "any"', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.hp', direction: 'any' },
      'player-a',
      () => calls.push(1),
    );
    bus.emitBeforeStateWrite(makeStateWrite({ direction: 'increase' }));
    bus.emitBeforeStateWrite(makeStateWrite({ direction: 'decrease' }));
    expect(calls).toHaveLength(2);
  });

  it('returns ModifiablePendingEffect with resolvedValue', () => {
    const bus = new EffectBus();
    const pending = bus.emitBeforeStateWrite(makeStateWrite({ resolvedValue: -8 }));
    expect(pending.resolvedValue).toBe(-8);
    expect(pending.adjustedValue).toBe(-8);
  });

  it('handler can adjust modifiedValue', () => {
    const bus = new EffectBus();
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.hp', direction: 'decrease' },
      'player-a',
      (p) => (p as AdjustablePendingEffect).adjust({ delta: 2 }),
    );
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.hp', direction: 'decrease' },
      'player-a',
      (p) => (p as AdjustablePendingEffect).adjust({ mult: 0.5 }),
    );
    const pending = bus.emitBeforeStateWrite(makeStateWrite({ resolvedValue: -10 }));
    expect(pending.adjustedValue).toBe(-4); // (-10 + 2) * 0.5
  });

  it('calls multiple handlers in subscription order', () => {
    const bus = new EffectBus();
    const order: number[] = [];
    const trigger = { kind: 'state-write' as const, scope: 'target' as const, path: 'player.property.hp', direction: 'any' as const };
    bus.onBefore(trigger, 'player-a', () => order.push(1));
    bus.onBefore(trigger, 'player-a', () => order.push(2));
    bus.onBefore(trigger, 'player-a', () => order.push(3));
    bus.emitBeforeStateWrite(makeStateWrite());
    expect(order).toEqual([1, 2, 3]);
  });

  it('stops calling handlers after cancel()', () => {
    const bus = new EffectBus();
    const order: number[] = [];
    const trigger = { kind: 'state-write' as const, scope: 'target' as const, path: 'player.property.hp', direction: 'any' as const };
    bus.onBefore(trigger, 'player-a', (p) => { order.push(1); p.cancel(); });
    bus.onBefore(trigger, 'player-a', () => order.push(2));
    bus.emitBeforeStateWrite(makeStateWrite());
    expect(order).toEqual([1]);
  });

  it('unsubscribe removes the handler', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    const unsub = bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.hp', direction: 'any' },
      'player-a',
      () => calls.push(1),
    );
    unsub();
    bus.emitBeforeStateWrite(makeStateWrite());
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// EffectBus — move before events
// ---------------------------------------------------------------------------

describe('EffectBus — emitBeforeMove', () => {
  it('calls handler when move trigger matches (target scope)', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore({ kind: 'move', scope: 'target' }, 'player-a', () => calls.push(1));
    bus.emitBeforeMove(makeMove({ pieceOwnerId: 'player-a' }));
    expect(calls).toEqual([1]);
  });

  it('does not call handler when ownerId does not match pieceOwnerId', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore({ kind: 'move', scope: 'target' }, 'player-b', () => calls.push(1));
    bus.emitBeforeMove(makeMove({ pieceOwnerId: 'player-a' }));
    expect(calls).toHaveLength(0);
  });

  it('calls handler when scope is actor and ownerId matches actorId', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore({ kind: 'move', scope: 'actor' }, 'player-b', () => calls.push(1));
    bus.emitBeforeMove(makeMove({ actorId: 'player-b' }));
    expect(calls).toEqual([1]);
  });

  it('filters by fromInventory', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore({ kind: 'move', scope: 'target', fromInventory: ['hand'] }, 'player-a', () => calls.push(1));
    bus.emitBeforeMove(makeMove({ fromInventoryType: 'battlefield', pieceOwnerId: 'player-a' }));
    expect(calls).toHaveLength(0);
  });

  it('calls handler when fromInventory matches', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore({ kind: 'move', scope: 'target', fromInventory: ['hand'] }, 'player-a', () => calls.push(1));
    bus.emitBeforeMove(makeMove({ fromInventoryType: 'hand', pieceOwnerId: 'player-a' }));
    expect(calls).toEqual([1]);
  });

  it('filters by toInventory', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore({ kind: 'move', scope: 'target', toInventory: ['graveyard'] }, 'player-a', () => calls.push(1));
    bus.emitBeforeMove(makeMove({ toInventoryType: 'discard', pieceOwnerId: 'player-a' }));
    expect(calls).toHaveLength(0);
  });

  it('returns PendingEffect that can be cancelled', () => {
    const bus = new EffectBus();
    bus.onBefore({ kind: 'move', scope: 'target' }, 'player-a', (p) => p.cancel());
    const pending = bus.emitBeforeMove(makeMove({ pieceOwnerId: 'player-a' }));
    expect(pending.cancelled).toBe(true);
    expect(pending.kind).toBe('move');
  });
});

// ---------------------------------------------------------------------------
// EffectBus — reveal before events
// ---------------------------------------------------------------------------

describe('EffectBus — emitBeforeReveal', () => {
  it('calls handler when reveal trigger matches', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore({ kind: 'reveal', scope: 'target' }, 'player-a', () => calls.push(1));
    bus.emitBeforeReveal(makeReveal({ pieceOwnerId: 'player-a' }));
    expect(calls).toEqual([1]);
  });

  it('filters by inventory type', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore({ kind: 'reveal', scope: 'target', inventory: ['battlefield'] }, 'player-a', () => calls.push(1));
    bus.emitBeforeReveal(makeReveal({ inventoryType: 'hand', pieceOwnerId: 'player-a' }));
    expect(calls).toHaveLength(0);
  });

  it('returns PendingEffect with kind reveal', () => {
    const bus = new EffectBus();
    const pending = bus.emitBeforeReveal(makeReveal());
    expect(pending.kind).toBe('reveal');
    expect(pending.cancelled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EffectBus — skip-turn before events
// ---------------------------------------------------------------------------

describe('EffectBus — emitBeforeSkipTurn', () => {
  it('calls handler when ownerId matches targetId', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore({ kind: 'skip-turn' }, 'player-a', () => calls.push(1));
    bus.emitBeforeSkipTurn('player-a');
    expect(calls).toEqual([1]);
  });

  it('does not call handler when ownerId does not match targetId', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onBefore({ kind: 'skip-turn' }, 'player-b', () => calls.push(1));
    bus.emitBeforeSkipTurn('player-a');
    expect(calls).toHaveLength(0);
  });

  it('returns PendingEffect with kind skip-turn', () => {
    const bus = new EffectBus();
    const pending = bus.emitBeforeSkipTurn('player-a');
    expect(pending.kind).toBe('skip-turn');
  });
});

// ---------------------------------------------------------------------------
// EffectBus — after events
// ---------------------------------------------------------------------------

describe('EffectBus — after handlers', () => {
  it('calls after handler with the structural event when trigger matches', () => {
    const bus = new EffectBus();
    const received: string[] = [];
    bus.onAfter(
      { kind: 'state-write', scope: 'target', path: 'player.property.hp', direction: 'decrease' },
      'player-a',
      (ev) => received.push(ev.kind),
    );
    bus.emitAfterStateWrite(makeStateWrite());
    expect(received).toEqual(['state-write']);
  });

  it('does not call after handler when trigger does not match', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onAfter(
      { kind: 'state-write', scope: 'target', path: 'player.property.mp', direction: 'any' },
      'player-a',
      () => calls.push(1),
    );
    bus.emitAfterStateWrite(makeStateWrite({ path: 'player.property.hp' }));
    expect(calls).toHaveLength(0);
  });

  it('emitBeforeStateWrite does not trigger after handlers', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    bus.onAfter(
      { kind: 'state-write', scope: 'target', path: 'player.property.hp', direction: 'any' },
      'player-a',
      () => calls.push(1),
    );
    bus.emitBeforeStateWrite(makeStateWrite());
    expect(calls).toHaveLength(0);
  });

  it('calls after handler for move event', () => {
    const bus = new EffectBus();
    const received: string[] = [];
    bus.onAfter({ kind: 'move', scope: 'target' }, 'player-a', (ev) => received.push(ev.kind));
    bus.emitAfterMove(makeMove({ pieceOwnerId: 'player-a' }));
    expect(received).toEqual(['move']);
  });

  it('unsubscribe removes after handler', () => {
    const bus = new EffectBus();
    const calls: number[] = [];
    const unsub = bus.onAfter(
      { kind: 'state-write', scope: 'target', path: 'player.property.hp', direction: 'any' },
      'player-a',
      () => calls.push(1),
    );
    unsub();
    bus.emitAfterStateWrite(makeStateWrite());
    expect(calls).toHaveLength(0);
  });
});

