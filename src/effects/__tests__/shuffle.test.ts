import type { GameSession, GameState, GameConfig, EffectContext } from '#chaincraft/types.js';
import { executeShuffle } from '../shuffle.js';
import { createSeededRng } from '#chaincraft/rng/seeded.js';
import { GameEventEmitter } from '#chaincraft/events/emitter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(): GameConfig {
  return {
    inventories: {
      deck: { structure: 'stack', scope: 'game', visibility: 'count-only', accepts: ['card'] },
      hand: { structure: 'none', scope: 'player', visibility: 'owner', accepts: ['card'] },
    },
    gamepieceTypes: { card: { category: 'card', properties: {} } },
    gameProperties: {},
    playerProperties: {},
    playerCount: { min: 2, max: 2 },
  };
}

function makeState(): GameState {
  return {
    gameProperties: {},
    gameInventories: {
      deck: { structure: 'stack', pieceIds: ['c1', 'c2', 'c3', 'c4', 'c5'] },
    },
    players: {
      p1: {
        roles: [],
        properties: {},
        inventories: {
          hand: { structure: 'none', pieceIds: ['c6', 'c7', 'c8'] },
        },
      },
      p2: { roles: [], properties: {}, inventories: { hand: { structure: 'none', pieceIds: [] } } },
    },
    gamepieces: {
      c1: { typeId: 'card', ownerId: 'game', properties: {}, faceUp: false, exhausted: false, visibleTo: null },
      c2: { typeId: 'card', ownerId: 'game', properties: {}, faceUp: false, exhausted: false, visibleTo: null },
      c3: { typeId: 'card', ownerId: 'game', properties: {}, faceUp: false, exhausted: false, visibleTo: null },
      c4: { typeId: 'card', ownerId: 'game', properties: {}, faceUp: false, exhausted: false, visibleTo: null },
      c5: { typeId: 'card', ownerId: 'game', properties: {}, faceUp: false, exhausted: false, visibleTo: null },
      c6: { typeId: 'card', ownerId: 'p1', properties: {}, faceUp: true, exhausted: false, visibleTo: null },
      c7: { typeId: 'card', ownerId: 'p1', properties: {}, faceUp: true, exhausted: false, visibleTo: null },
      c8: { typeId: 'card', ownerId: 'p1', properties: {}, faceUp: true, exhausted: false, visibleTo: null },
    },
  };
}

function makeSession(seed = 42): GameSession {
  return {
    gameId: 'test-game',
    specId: 'test-spec',
    config: makeConfig(),
    state: makeState(),
    players: ['p1', 'p2'],
    outbox: [],
    rng: createSeededRng(seed),
    events: new GameEventEmitter(),
    _inventoryCache: new Map(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(overrides?: Partial<EffectContext>): EffectContext<any> {
  return { actorId: 'p1', actionInputs: {}, effectDef: {}, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeShuffle — game-scoped inventory', () => {
  it('reorders pieces in a stack inventory', async () => {
    const session = makeSession();
    const before = [...(session.state.gameInventories['deck'] as any).pieceIds];
    await executeShuffle(session, makeCtx({ effectDef: { kind: 'shuffle', inventory: 'deck' } }));
    const after = (session.state.gameInventories['deck'] as any).pieceIds as string[];
    expect(after).toHaveLength(before.length);
    expect(after).toEqual(expect.arrayContaining(before));
    // With seed 42 + 5 cards the shuffle should produce a different order
    expect(after).not.toEqual(before);
  });

  it('produces a deterministic order for a given seed', async () => {
    const session1 = makeSession(7);
    const session2 = makeSession(7);
    await executeShuffle(session1, makeCtx({ effectDef: { kind: 'shuffle', inventory: 'deck' } }));
    await executeShuffle(session2, makeCtx({ effectDef: { kind: 'shuffle', inventory: 'deck' } }));
    expect(
      (session1.state.gameInventories['deck'] as any).pieceIds,
    ).toEqual(
      (session2.state.gameInventories['deck'] as any).pieceIds,
    );
  });

  it('produces different orders for different seeds', async () => {
    const session1 = makeSession(1);
    const session2 = makeSession(999);
    await executeShuffle(session1, makeCtx({ effectDef: { kind: 'shuffle', inventory: 'deck' } }));
    await executeShuffle(session2, makeCtx({ effectDef: { kind: 'shuffle', inventory: 'deck' } }));
    // Extremely unlikely to be equal with different seeds and 5 cards (1/120 chance)
    expect(
      (session1.state.gameInventories['deck'] as any).pieceIds,
    ).not.toEqual(
      (session2.state.gameInventories['deck'] as any).pieceIds,
    );
  });

  it('preserves all pieces after shuffle (no loss)', async () => {
    const session = makeSession();
    await executeShuffle(session, makeCtx({ effectDef: { kind: 'shuffle', inventory: 'deck' } }));
    const after = (session.state.gameInventories['deck'] as any).pieceIds as string[];
    expect(new Set(after)).toEqual(new Set(['c1', 'c2', 'c3', 'c4', 'c5']));
  });

  it('throws when inventory is not found', async () => {
    const session = makeSession();
    await expect(
      executeShuffle(session, makeCtx({ effectDef: { kind: 'shuffle', inventory: 'no-such-inv' } })),
    ).rejects.toThrow('not found');
  });
});

describe('executeShuffle — player-scoped inventory', () => {
  it('shuffles the acting player hand', async () => {
    const session = makeSession();
    const before = [...(session.state.players['p1'].inventories['hand'] as any).pieceIds];
    await executeShuffle(session, makeCtx({
      actorId: 'p1',
      effectDef: { kind: 'shuffle', inventory: 'hand' },
    }));
    const after = (session.state.players['p1'].inventories['hand'] as any).pieceIds as string[];
    expect(after).toHaveLength(before.length);
    expect(new Set(after)).toEqual(new Set(before));
  });

  it('does not affect other players\' inventories', async () => {
    const session = makeSession();
    await executeShuffle(session, makeCtx({
      actorId: 'p1',
      effectDef: { kind: 'shuffle', inventory: 'hand' },
    }));
    expect((session.state.players['p2'].inventories['hand'] as any).pieceIds).toEqual([]);
  });
});

describe('executeShuffle — bag inventory is a no-op', () => {
  it('leaves bag piece order unchanged (bags are unordered)', async () => {
    const session = makeSession();
    // Promote hand to a bag-structured config for this test
    session.config.inventories['hand'] = { structure: 'none', scope: 'player', visibility: 'owner', accepts: ['card'] };
    const before = [...(session.state.players['p1'].inventories['hand'] as any).pieceIds];
    await executeShuffle(session, makeCtx({
      actorId: 'p1',
      effectDef: { kind: 'shuffle', inventory: 'hand' },
    }));
    expect((session.state.players['p1'].inventories['hand'] as any).pieceIds).toEqual(before);
  });
});
