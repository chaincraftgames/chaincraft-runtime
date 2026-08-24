import type { GameSession, GameState, GameConfig, EffectContext } from '#chaincraft/types.js';
import { executeDistribute } from '../distribute.js';
import { createSeededRng } from '#chaincraft/rng/seeded.js';
import { GameEventEmitter } from '#chaincraft/events/emitter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(): GameConfig {
  return {
    inventories: {
      deck:  { structure: 'stack', scope: 'game',   visibility: 'never', countVisibility: 'always', accepts: ['card'] },
      hand:  { structure: 'none',  scope: 'player', visibility: 'owner',  countVisibility: 'always', accepts: ['card'] },
      supply: { structure: 'none', scope: 'game',   visibility: 'always', countVisibility: 'always', accepts: ['token'] },
      chest: { structure: 'none',  scope: 'player', visibility: 'owner',  countVisibility: 'always', accepts: ['token'] },
    },
    gamepieceTypes: {
      card:  { category: 'card',  properties: {} },
      token: { category: 'token', properties: {} },
    },
    gameProperties: {},
    playerProperties: {},
    playerCount: { min: 3, max: 3 },
  };
}

// 15-card deck + 6 tokens in supply; 3 players each with empty hand/chest
function makeState(): GameState {
  const cards: GameState['gamepieces'] = {};
  const cardIds: string[] = [];
  for (let i = 1; i <= 15; i++) {
    const id = `c${i}`;
    cardIds.push(id);
    cards[id] = { typeId: 'card', ownerId: 'game', properties: {}, faceUp: false, exhausted: false, visibleTo: null };
  }
  const tokens: GameState['gamepieces'] = {};
  const tokenIds: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const id = `t${i}`;
    tokenIds.push(id);
    tokens[id] = { typeId: 'token', ownerId: 'game', properties: {}, faceUp: true, exhausted: false, visibleTo: null };
  }

  return {
    gameProperties: {},
    gameInventories: {
      deck:   { structure: 'stack', pieceIds: [...cardIds] },
      supply: { structure: 'none',  pieceIds: [...tokenIds] },
    },
    players: {
      p1: { roles: ['mafia'],   properties: { role: 'mafia' },   inventories: { hand: { structure: 'none', pieceIds: [] }, chest: { structure: 'none', pieceIds: [] } } },
      p2: { roles: ['citizen'], properties: { role: 'citizen' }, inventories: { hand: { structure: 'none', pieceIds: [] }, chest: { structure: 'none', pieceIds: [] } } },
      p3: { roles: ['citizen'], properties: { role: 'citizen' }, inventories: { hand: { structure: 'none', pieceIds: [] }, chest: { structure: 'none', pieceIds: [] } } },
    },
    gamepieces: { ...cards, ...tokens },
  };
}

function makeSession(): GameSession {
  return {
    gameId: 'test-game',
    specId: 'test-spec',
    config: makeConfig(),
    state: makeState(),
    players: ['p1', 'p2', 'p3'],
    outbox: [],
    rng: createSeededRng(42),
    events: new GameEventEmitter(),
    _inventoryCache: new Map(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(overrides?: Partial<EffectContext>): EffectContext<any> {
  return { actorId: 'p1', actionInputs: {}, effectDef: {}, ...overrides };
}

function hand(session: GameSession, playerId: string): string[] {
  return (session.state.players[playerId].inventories['hand'] as any).pieceIds as string[];
}
function chest(session: GameSession, playerId: string): string[] {
  return (session.state.players[playerId].inventories['chest'] as any).pieceIds as string[];
}
function deckPieceIds(session: GameSession): string[] {
  return (session.state.gameInventories['deck'] as any).pieceIds as string[];
}

// ---------------------------------------------------------------------------
// round-robin
// ---------------------------------------------------------------------------

describe('executeDistribute — round-robin (default)', () => {
  it('deals 5 cards to each of 3 players in round-robin order', async () => {
    const session = makeSession();
    await executeDistribute(session, makeCtx({
      effectDef: {
        kind: 'distribute',
        from: { inventory: 'deck', select: 'top' },
        to: { inventory: 'hand' },
        count: 5,
        style: 'round-robin',
      },
    }));
    expect(hand(session, 'p1')).toHaveLength(5);
    expect(hand(session, 'p2')).toHaveLength(5);
    expect(hand(session, 'p3')).toHaveLength(5);
    expect(deckPieceIds(session)).toHaveLength(0); // 15 dealt out, none remain
  });

  it('assigns ownerId correctly after dealing', async () => {
    const session = makeSession();
    await executeDistribute(session, makeCtx({
      effectDef: {
        kind: 'distribute',
        from: { inventory: 'deck', select: 'top' },
        to: { inventory: 'hand' },
        count: 1,
        style: 'round-robin',
      },
    }));
    expect(session.state.gamepieces[hand(session, 'p1')[0]].ownerId).toBe('p1');
    expect(session.state.gamepieces[hand(session, 'p2')[0]].ownerId).toBe('p2');
    expect(session.state.gamepieces[hand(session, 'p3')[0]].ownerId).toBe('p3');
  });

  it('round-robin interleaves: c1→p1, c2→p2, c3→p3, c4→p1, c5→p2, c6→p3', async () => {
    const session = makeSession();
    await executeDistribute(session, makeCtx({
      effectDef: {
        kind: 'distribute',
        from: { inventory: 'deck', select: 'top' },
        to: { inventory: 'hand' },
        count: 2,
        style: 'round-robin',
      },
    }));
    // Cards from top of deck: c1, c2, ..., c6
    expect(hand(session, 'p1')).toContain('c1');
    expect(hand(session, 'p1')).toContain('c4');
    expect(hand(session, 'p2')).toContain('c2');
    expect(hand(session, 'p2')).toContain('c5');
    expect(hand(session, 'p3')).toContain('c3');
    expect(hand(session, 'p3')).toContain('c6');
  });
});

// ---------------------------------------------------------------------------
// batch
// ---------------------------------------------------------------------------

describe('executeDistribute — batch', () => {
  it('deals 5 cards to p1 first, then p2, then p3', async () => {
    const session = makeSession();
    await executeDistribute(session, makeCtx({
      effectDef: {
        kind: 'distribute',
        from: { inventory: 'deck', select: 'top' },
        to: { inventory: 'hand' },
        count: 5,
        style: 'batch',
      },
    }));
    expect(hand(session, 'p1')).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(hand(session, 'p2')).toEqual(['c6', 'c7', 'c8', 'c9', 'c10']);
    expect(hand(session, 'p3')).toEqual(['c11', 'c12', 'c13', 'c14', 'c15']);
  });

  it('batch: 2 cards each, deck exhausts after p2 gets 1', async () => {
    const session = makeSession();
    // Only 3 cards available (c1–c3), 3 players × 2 = 6 needed
    (session.state.gameInventories['deck'] as any).pieceIds = ['c1', 'c2', 'c3'];
    await executeDistribute(session, makeCtx({
      effectDef: {
        kind: 'distribute',
        from: { inventory: 'deck', select: 'top' },
        to: { inventory: 'hand' },
        count: 2,
        style: 'batch',
      },
    }));
    expect(hand(session, 'p1')).toEqual(['c1', 'c2']);
    expect(hand(session, 'p2')).toEqual(['c3']);
    expect(hand(session, 'p3')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// role filtering
// ---------------------------------------------------------------------------

describe('executeDistribute — role filtering', () => {
  it('deals only to players whose role property matches', async () => {
    const session = makeSession();
    // p1 has role: 'mafia', p2 and p3 have role: 'citizen'
    await executeDistribute(session, makeCtx({
      effectDef: {
        kind: 'distribute',
        from: { inventory: 'deck', select: 'top' },
        to: { inventory: 'hand', roles: ['mafia'] },
        count: 2,
      },
    }));
    expect(hand(session, 'p1')).toHaveLength(2);
    expect(hand(session, 'p2')).toHaveLength(0);
    expect(hand(session, 'p3')).toHaveLength(0);
  });

  it('deals to all matching roles when multiple match', async () => {
    const session = makeSession();
    await executeDistribute(session, makeCtx({
      effectDef: {
        kind: 'distribute',
        from: { inventory: 'deck', select: 'top' },
        to: { inventory: 'hand', roles: ['citizen'] },
        count: 2,
      },
    }));
    expect(hand(session, 'p1')).toHaveLength(0);
    expect(hand(session, 'p2')).toHaveLength(2);
    expect(hand(session, 'p3')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// edge cases
// ---------------------------------------------------------------------------

describe('executeDistribute — edge cases', () => {
  it('is a no-op when source is empty', async () => {
    const session = makeSession();
    (session.state.gameInventories['deck'] as any).pieceIds = [];
    const before = JSON.stringify(session.state);
    await executeDistribute(session, makeCtx({
      effectDef: {
        kind: 'distribute',
        from: { inventory: 'deck', select: 'top' },
        to: { inventory: 'hand' },
        count: 3,
      },
    }));
    expect(JSON.stringify(session.state)).toBe(before);
  });

  it('defaults to round-robin when style is omitted', async () => {
    const session = makeSession();
    await executeDistribute(session, makeCtx({
      effectDef: {
        kind: 'distribute',
        from: { inventory: 'deck', select: 'top' },
        to: { inventory: 'hand' },
        count: 1,
        // style omitted
      },
    }));
    // Round-robin: c1→p1, c2→p2, c3→p3
    expect(hand(session, 'p1')).toContain('c1');
    expect(hand(session, 'p2')).toContain('c2');
    expect(hand(session, 'p3')).toContain('c3');
  });
});
