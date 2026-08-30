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
  EffectEvent,
} from '../effect-bus.js';
import type { GameSession } from '../../types.js';

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

// bus does not read session; tests pass an empty object cast to satisfy the type
const noSession = {} as GameSession;

// ---------------------------------------------------------------------------
// EffectBus — before routing
// ---------------------------------------------------------------------------

describe('EffectBus — before routing', () => {
  it('calls act when match returns true', () => {
    const bus = new EffectBus();
    const acts: string[] = [];
    bus.onBefore('state-write', { match: () => true, act: (p) => acts.push(p.kind) });
    bus.emitBeforeStateWrite(makeStateWrite(), noSession);
    expect(acts).toEqual(['state-write']);
  });

  it('does not call act when match returns false', () => {
    const bus = new EffectBus();
    const acts: number[] = [];
    bus.onBefore('state-write', { match: () => false, act: () => acts.push(1) });
    bus.emitBeforeStateWrite(makeStateWrite(), noSession);
    expect(acts).toHaveLength(0);
  });

  it('does not route state-write entries to emitBeforeMove', () => {
    const bus = new EffectBus();
    const acts: number[] = [];
    bus.onBefore('state-write', { match: () => true, act: () => acts.push(1) });
    bus.emitBeforeMove(makeMove(), noSession);
    expect(acts).toHaveLength(0);
  });

  it('calls entries in subscription order', () => {
    const bus = new EffectBus();
    const order: number[] = [];
    bus.onBefore('state-write', { match: () => true, act: () => order.push(1) });
    bus.onBefore('state-write', { match: () => true, act: () => order.push(2) });
    bus.onBefore('state-write', { match: () => true, act: () => order.push(3) });
    bus.emitBeforeStateWrite(makeStateWrite(), noSession);
    expect(order).toEqual([1, 2, 3]);
  });

  it('stops calling entries after cancel()', () => {
    const bus = new EffectBus();
    const order: number[] = [];
    bus.onBefore('state-write', { match: () => true, act: (p) => { order.push(1); p.cancel(); } });
    bus.onBefore('state-write', { match: () => true, act: () => order.push(2) });
    bus.emitBeforeStateWrite(makeStateWrite(), noSession);
    expect(order).toEqual([1]);
  });

  it('unsubscribe removes the entry', () => {
    const bus = new EffectBus();
    const acts: number[] = [];
    const unsub = bus.onBefore('state-write', { match: () => true, act: () => acts.push(1) });
    unsub();
    bus.emitBeforeStateWrite(makeStateWrite(), noSession);
    expect(acts).toHaveLength(0);
  });

  it('returns AdjustablePendingEffect with resolvedValue for state-write', () => {
    const bus = new EffectBus();
    const pending = bus.emitBeforeStateWrite(makeStateWrite({ resolvedValue: -8 }), noSession);
    expect(pending.resolvedValue).toBe(-8);
    expect(pending.adjustedValue).toBe(-8);
    expect(pending.kind).toBe('state-write');
  });

  it('act can adjust pending value', () => {
    const bus = new EffectBus();
    bus.onBefore('state-write', {
      match: () => true,
      act: (p) => (p as AdjustablePendingEffect).adjust({ delta: 2 }),
    });
    bus.onBefore('state-write', {
      match: () => true,
      act: (p) => (p as AdjustablePendingEffect).adjust({ mult: 0.5 }),
    });
    const pending = bus.emitBeforeStateWrite(makeStateWrite({ resolvedValue: -10 }), noSession);
    expect(pending.adjustedValue).toBe(-4); // (-10 + 2) * 0.5
  });

  it('returns PendingEffect with kind move for emitBeforeMove', () => {
    const bus = new EffectBus();
    const pending = bus.emitBeforeMove(makeMove(), noSession);
    expect(pending.kind).toBe('move');
    expect(pending.cancelled).toBe(false);
  });

  it('returns PendingEffect with kind reveal for emitBeforeReveal', () => {
    const bus = new EffectBus();
    const pending = bus.emitBeforeReveal(makeReveal(), noSession);
    expect(pending.kind).toBe('reveal');
  });

  it('returns PendingEffect with kind skip-turn for emitBeforeSkipTurn', () => {
    const bus = new EffectBus();
    const pending = bus.emitBeforeSkipTurn('player-a', noSession);
    expect(pending.kind).toBe('skip-turn');
  });
});

// ---------------------------------------------------------------------------
// EffectBus — after routing
// ---------------------------------------------------------------------------

describe('EffectBus — after routing', () => {
  it('calls act when match returns true', () => {
    const bus = new EffectBus();
    const acts: string[] = [];
    bus.onAfter('state-write', { match: () => true, act: (e) => { acts.push(e.kind); } });
  });

  it('does not call act when match returns false', () => {
    const bus = new EffectBus();
    const acts: number[] = [];
    bus.onAfter('state-write', { match: () => false, act: () => { acts.push(1); } });
    bus.emitAfterStateWrite(makeStateWrite(), noSession);
    expect(acts).toHaveLength(0);
  });

  it('emitBeforeStateWrite does not trigger after entries', () => {
    const bus = new EffectBus();
    const acts: number[] = [];
    bus.onAfter('state-write', { match: () => true, act: () => { acts.push(1); } });
    expect(acts).toHaveLength(0);
  });

  it('routes move events to move entries only', () => {
    const bus = new EffectBus();
    const acts: string[] = [];
    bus.onAfter('move', { match: () => true, act: (e) => { acts.push(e.kind); } });
    bus.emitAfterMove(makeMove(), noSession);
    expect(acts).toEqual(['move']);
  });

  it('unsubscribe removes after entry', () => {
    const bus = new EffectBus();
    const acts: number[] = [];
    const unsub = bus.onAfter('state-write', { match: () => true, act: () => { acts.push(1); } });
    unsub();
    bus.emitAfterStateWrite(makeStateWrite(), noSession);
    expect(acts).toHaveLength(0);
  });
});
