import type { GameSession, GameState, GameConfig, EffectContext } from '#chaincraft/types.js';
import { executeMove } from '../move.js';
import { createSeededRng } from '#chaincraft/rng/seeded.js';
import { GameEventEmitter } from '#chaincraft/events/emitter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(): GameConfig {
  return {
    inventories: {
      deck: { structure: 'stack', scope: 'game', visibility: 'never', countVisibility: 'always', accepts: ['card'] },
      hand: { structure: 'none', scope: 'player', visibility: 'owner', countVisibility: 'always', accepts: ['card'] },
      discard: { structure: 'stack', scope: 'game', visibility: 'always', countVisibility: 'always', accepts: ['card'] },
      'game:unassigned': { structure: 'none', scope: 'game', visibility: 'never', countVisibility: 'never', accepts: ['card', 'token'] },
    },
    gamepieceTypes: {
      card: { category: 'card', properties: {} },
      token: { category: 'token', properties: {} },
    },
    gameProperties: {
      roundLoser: { mutable: true },
    },
    playerProperties: {},
    playerCount: { min: 2, max: 2 },
  };
}

function makeState(): GameState {
  return {
    gameProperties: { roundLoser: '' },
    gameInventories: {
      deck: { structure: 'stack', pieceIds: ['card-1', 'card-2', 'card-3'] },
      discard: { structure: 'stack', pieceIds: [] },
      'game:unassigned': { structure: 'none', pieceIds: ['token-1'] },
    },
    players: {
      p1: {
        roles: [],
        properties: {},
        inventories: {
          hand: { structure: 'none', pieceIds: ['card-4'] },
        },
      },
      p2: {
        roles: [],
        properties: {},
        inventories: {
          hand: { structure: 'none', pieceIds: [] },
        },
      },
    },
    gamepieces: {
      'card-1': { typeId: 'card', ownerId: 'game', properties: {}, faceUp: false, exhausted: false, visibleTo: null },
      'card-2': { typeId: 'card', ownerId: 'game', properties: {}, faceUp: false, exhausted: false, visibleTo: null },
      'card-3': { typeId: 'card', ownerId: 'game', properties: {}, faceUp: false, exhausted: false, visibleTo: null },
      'card-4': { typeId: 'card', ownerId: 'p1', properties: {}, faceUp: true, exhausted: false, visibleTo: null },
      'token-1': { typeId: 'token', ownerId: 'game', properties: {}, faceUp: true, exhausted: false, visibleTo: null },
    },
  };
}

function makeSession(): GameSession {
  return {
    gameId: 'test-game',
    specId: 'test-spec',
    config: makeConfig(),
    state: makeState(),
    players: ['p1', 'p2'],
    outbox: [],
    rng: createSeededRng(42),
    events: new GameEventEmitter(),
    _inventoryCache: new Map(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(overrides?: Partial<EffectContext>): EffectContext<any> {
  return {
    actorId: 'p1',
    actionInputs: {},
    effectDef: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic moves
// ---------------------------------------------------------------------------

describe('executeMove — game to game', () => {
  it('moves top card from deck to discard', async () => {
    const session = makeSession();
    await executeMove(session, makeCtx({
      effectDef: {
        kind: 'move',
        from: { inventory: 'deck', select: 'top', count: 1 },
        to: { inventory: 'discard' },
      },
    }));
    const deck = session.state.gameInventories['deck'] as any;
    const discard = session.state.gameInventories['discard'] as any;
    expect(deck.pieceIds).not.toContain('card-1');
    expect(discard.pieceIds).toContain('card-1');
  });

  it('moves all cards from deck to discard', async () => {
    const session = makeSession();
    await executeMove(session, makeCtx({
      effectDef: {
        kind: 'move',
        from: { inventory: 'deck', select: 'all' },
        to: { inventory: 'discard' },
      },
    }));
    const deck = session.state.gameInventories['deck'] as any;
    const discard = session.state.gameInventories['discard'] as any;
    expect(deck.pieceIds).toHaveLength(0);
    expect(discard.pieceIds).toHaveLength(3);
  });

  it('moves a specific piece by id', async () => {
    const session = makeSession();
    await executeMove(session, makeCtx({
      effectDef: {
        kind: 'move',
        from: { inventory: 'deck', select: { id: 'card-2' } },
        to: { inventory: 'discard' },
      },
    }));
    const deck = session.state.gameInventories['deck'] as any;
    const discard = session.state.gameInventories['discard'] as any;
    expect(deck.pieceIds).not.toContain('card-2');
    expect(discard.pieceIds).toContain('card-2');
  });
});

// ---------------------------------------------------------------------------
// Player-scoped inventories
// ---------------------------------------------------------------------------

describe('executeMove — game to player', () => {
  it('moves top card from deck to acting player hand', async () => {
    const session = makeSession();
    await executeMove(session, makeCtx({
      actorId: 'p1',
      effectDef: {
        kind: 'move',
        from: { inventory: 'deck', select: 'top', count: 1 },
        to: { inventory: 'hand' },
      },
    }));
    const deck = session.state.gameInventories['deck'] as any;
    const hand = session.state.players['p1'].inventories['hand'] as any;
    expect(deck.pieceIds).not.toContain('card-1');
    expect(hand.pieceIds).toContain('card-1');
  });

  it('updates piece ownerId when moving to player inventory', async () => {
    const session = makeSession();
    await executeMove(session, makeCtx({
      actorId: 'p2',
      effectDef: {
        kind: 'move',
        from: { inventory: 'deck', select: 'top', count: 1 },
        to: { inventory: 'hand' },
      },
    }));
    expect(session.state.gamepieces['card-1'].ownerId).toBe('p2');
  });

  it('moves card from player hand to game discard', async () => {
    const session = makeSession();
    await executeMove(session, makeCtx({
      actorId: 'p1',
      effectDef: {
        kind: 'move',
        from: { inventory: 'hand', select: 'all' },
        to: { inventory: 'discard' },
      },
    }));
    const hand = session.state.players['p1'].inventories['hand'] as any;
    const discard = session.state.gameInventories['discard'] as any;
    expect(hand.pieceIds).toHaveLength(0);
    expect(discard.pieceIds).toContain('card-4');
  });
});

// ---------------------------------------------------------------------------
// Dynamic player targeting
// ---------------------------------------------------------------------------

describe('executeMove — dynamic player targeting', () => {
  it('moves from a player resolved via stateRef', async () => {
    const session = makeSession();
    // Set roundLoser to p1 so we remove a card from p1's hand
    session.state.gameProperties['roundLoser'] = 'p1';
    await executeMove(session, makeCtx({
      effectDef: {
        kind: 'move',
        from: {
          player: { stateRef: 'game.property.roundLoser' },
          inventory: 'hand',
          select: 'random',
          count: 1,
        },
        to: { inventory: 'game:unassigned' },
      },
    }));
    const hand = session.state.players['p1'].inventories['hand'] as any;
    const unassigned = session.state.gameInventories['game:unassigned'] as any;
    expect(hand.pieceIds).not.toContain('card-4');
    expect(unassigned.pieceIds).toContain('card-4');
  });

  it('moves to a specific player resolved via param', async () => {
    const session = makeSession();
    await executeMove(session, makeCtx({
      actorId: 'p1',
      actionInputs: { 'target-player': 'p2' },
      effectDef: {
        kind: 'move',
        from: { inventory: 'deck', select: 'top', count: 1 },
        to: { player: { param: 'target-player' }, inventory: 'hand' },
      },
    }));
    const p2Hand = session.state.players['p2'].inventories['hand'] as any;
    expect(p2Hand.pieceIds).toContain('card-1');
    expect(session.state.gamepieces['card-1'].ownerId).toBe('p2');
  });

  it('selects piece by param id', async () => {
    const session = makeSession();
    await executeMove(session, makeCtx({
      actorId: 'p1',
      actionInputs: { 'chosen-card': 'card-2' },
      effectDef: {
        kind: 'move',
        from: { inventory: 'deck', select: { id: { param: 'chosen-card' } } },
        to: { inventory: 'discard' },
      },
    }));
    const discard = session.state.gameInventories['discard'] as any;
    expect(discard.pieceIds).toContain('card-2');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('executeMove — edge cases', () => {
  it('is a no-op when selection is empty', async () => {
    const session = makeSession();
    const before = JSON.stringify(session.state);
    await executeMove(session, makeCtx({
      effectDef: {
        kind: 'move',
        from: { inventory: 'discard', select: 'top', count: 1 }, // discard is empty
        to: { inventory: 'deck' },
      },
    }));
    expect(JSON.stringify(session.state)).toBe(before);
  });

  it('moves from game:unassigned to player hand', async () => {
    const session = makeSession();
    await executeMove(session, makeCtx({
      actorId: 'p1',
      effectDef: {
        kind: 'move',
        from: { inventory: 'game:unassigned', select: 'random', count: 1 },
        to: { inventory: 'hand' },
      },
    }));
    const hand = session.state.players['p1'].inventories['hand'] as any;
    expect(hand.pieceIds).toContain('token-1');
    expect(session.state.gamepieces['token-1'].ownerId).toBe('p1');
  });
});
