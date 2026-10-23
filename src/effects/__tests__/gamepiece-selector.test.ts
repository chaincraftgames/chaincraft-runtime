import type { GameSession, GameState, GameConfig, EffectContext } from '#chaincraft/types.js';
import { selectGamepieces } from '../gamepiece-selector.js';
import { createSeededRng } from '#chaincraft/rng/seeded.js';
import { GameEventEmitter } from '#chaincraft/events/emitter.js';

const config: GameConfig = {
  inventories: {
    cup: { structure: 'none', scope: 'player', visibility: 'owner', countVisibility: 'always', accepts: ['die'] },
    pool: { structure: 'none', scope: 'game', visibility: 'always', countVisibility: 'always', accepts: ['die'] },
  },
  gamepieceTypes: { die: { category: 'dice', properties: {} } },
  gameProperties: { loser: { mutable: true } },
  playerProperties: {},
  playerCount: { min: 2, max: 2 },
};

function makeSession(): GameSession {
  const piece = (ownerId: string) => ({
    typeId: 'die', ownerId, properties: {}, faceUp: true, exhausted: false, visibleTo: null,
  });
  const state: GameState = {
    gameProperties: { loser: 'p2' },
    gameInventories: { pool: { structure: 'none', pieceIds: ['d-pool'] } },
    players: {
      p1: { roles: [], properties: {}, inventories: { cup: { structure: 'none', pieceIds: ['d1', 'd2'] } } },
      p2: { roles: [], properties: {}, inventories: { cup: { structure: 'none', pieceIds: ['d3'] } } },
    },
    gamepieces: { d1: piece('p1'), d2: piece('p1'), d3: piece('p2'), 'd-pool': piece('game') },
  };
  return {
    gameId: 'g', specId: 's', config, state, players: ['p1', 'p2'], outbox: [],
    rng: createSeededRng(1), events: new GameEventEmitter(), _inventoryCache: new Map(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctx(actorId: string | null): EffectContext<any> {
  return { actorId, actionInputs: {}, effectDef: {} };
}

describe('selectGamepieces — player targeting', () => {
  it('defaults to the actor for a player-scoped inventory', () => {
    const ids = selectGamepieces(makeSession(), ctx('p1'), { inventory: 'cup', select: 'all' });
    expect(ids.sort()).toEqual(['d1', 'd2']);
  });

  it('throws with no actor and no player instead of selecting every player', () => {
    expect(() => selectGamepieces(makeSession(), ctx(null), { inventory: 'cup', select: 'all' }))
      .toThrow('has no player and no actor');
  });

  it('player: all selects across every player', () => {
    const ids = selectGamepieces(makeSession(), ctx(null), {
      player: { kind: 'all' }, inventory: 'cup', select: 'all',
    });
    expect(ids.sort()).toEqual(['d1', 'd2', 'd3']);
  });

  it('count applies to each player inventory separately', () => {
    const ids = selectGamepieces(makeSession(), ctx(null), {
      player: { kind: 'all' }, inventory: 'cup', select: 'top', count: 1,
    });
    expect(ids).toHaveLength(2);
  });

  it('player: matching selects only matching players', () => {
    const ids = selectGamepieces(makeSession(), ctx(null), {
      player: { kind: 'matching', condition: (_s, pid) => pid === 'p2' }, inventory: 'cup', select: 'all',
    });
    expect(ids).toEqual(['d3']);
  });

  it('throws when a stateRef player is unresolved', () => {
    const session = makeSession();
    session.state.gameProperties['loser'] = '';
    expect(() => selectGamepieces(session, ctx(null), {
      player: { kind: 'stateRef', path: 'game.property.loser' }, inventory: 'cup', select: 'all',
    })).toThrow('unknown player');
  });

  it('ignores the player target and actor for a game-scoped inventory', () => {
    const ids = selectGamepieces(makeSession(), ctx(null), { inventory: 'pool', select: 'all' });
    expect(ids).toEqual(['d-pool']);
  });
});
