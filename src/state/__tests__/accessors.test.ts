import type { GameSession, GameConfig, GameState } from '#chaincraft/types.js';
import {
  getGameState,
  setGameState,
  getPlayerState,
  setPlayerState,
  getPieceState,
  setPieceState,
  StateAccessError,
} from '#chaincraft/index.js';
import type {
  GameStateBase,
  PlayerStateBase,
  GamepieceStateBase,
} from '#chaincraft/types.js';
import { GameEventEmitter } from '#chaincraft/events/emitter.js';

// ---------------------------------------------------------------------------
// Test-scoped typed projections (mimicking compiler-generated interfaces)
// ---------------------------------------------------------------------------

interface TestGameState extends GameStateBase {
  currentRound: number;
  gameWinner: string;
  includeReversal: boolean;
}

interface TestPlayerState extends PlayerStateBase {
  roundsWon: number;
}

interface TestWeaponProps extends GamepieceStateBase {
  description: string;
  rps: 'rock' | 'paper' | 'scissors';
  imageUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<GameConfig>): GameConfig {
  return {
    inventories: {},
    gamepieceTypes: {
      weapon: {
        category: 'token',
        properties: {
          description: { mutable: true },
          rps: { mutable: true, enumValues: ['rock', 'paper', 'scissors'] },
          imageUrl: { mutable: true },
        },
      },
    },
    gameProperties: {
      currentRound: { mutable: true, min: 0 },
      gameWinner: { mutable: true },
      includeReversal: { mutable: true },
    },
    playerProperties: {
      roundsWon: { mutable: true, min: 0 },
    },
    playerCount: { min: 2, max: 2 },
    ...overrides,
  };
}

function makeState(overrides?: Partial<GameState>): GameState {
  return {
    gameProperties: { currentRound: 0, gameWinner: '', includeReversal: false },
    gameInventories: {},
    players: {
      p1: { roles: [], properties: { roundsWon: 0 }, inventories: {} },
      p2: { roles: [], properties: { roundsWon: 0 }, inventories: {} },
    },
    gamepieces: {
      'weapon-1': {
        typeId: 'weapon',
        ownerId: 'p1',
        properties: { description: 'A big hammer', rps: 'rock', imageUrl: '' },
        faceUp: true,
        exhausted: false,
        visibleTo: 'all',
      },
    },
    ...overrides,
  };
}

function makeSession(overrides?: {
  config?: Partial<GameConfig>;
  state?: Partial<GameState>;
}): GameSession {
  return {
    gameId: 'test-game',
    specId: 'test-spec',
    config: makeConfig(overrides?.config),
    state: makeState(overrides?.state),
    players: ['p1', 'p2'],
    outbox: [],
    rng: { nextFloat: () => 0.5 },
    events: new GameEventEmitter(),
    _inventoryCache: new Map(),
  };
}

// ---------------------------------------------------------------------------
// getGameState / setGameState
// ---------------------------------------------------------------------------

describe('getGameState', () => {
  it('returns game properties as a typed projection', () => {
    const session = makeSession();
    const state = getGameState<TestGameState>(session);
    expect(state.currentRound).toBe(0);
    expect(state.gameWinner).toBe('');
    expect(state.includeReversal).toBe(false);
  });
});

describe('setGameState', () => {
  it('writes a game property', () => {
    const session = makeSession();
    setGameState<TestGameState, 'currentRound'>(session, 'currentRound', 3);
    expect(session.state.gameProperties['currentRound']).toBe(3);
  });

  it('rejects values below min', () => {
    const session = makeSession();
    expect(() =>
      setGameState<TestGameState, 'currentRound'>(session, 'currentRound', -1),
    ).toThrow(StateAccessError);
    try {
      setGameState<TestGameState, 'currentRound'>(session, 'currentRound', -1);
    } catch (e) {
      expect(e).toBeInstanceOf(StateAccessError);
      expect((e as StateAccessError).kind).toBe('out-of-range');
      expect((e as StateAccessError).path).toBe('game.currentRound');
    }
  });

  it('allows writing when no config exists for the key', () => {
    const session = makeSession({
      config: { gameProperties: {} },
    });
    // No config entry for 'gameWinner', so no validation — just set it
    setGameState<TestGameState, 'gameWinner'>(session, 'gameWinner', 'p1');
    expect(session.state.gameProperties['gameWinner']).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// getPlayerState / setPlayerState
// ---------------------------------------------------------------------------

describe('getPlayerState', () => {
  it('returns player properties as a typed projection', () => {
    const session = makeSession();
    const state = getPlayerState<TestPlayerState>(session, 'p1');
    expect(state.roundsWon).toBe(0);
  });

  it('throws not-found for unknown player', () => {
    const session = makeSession();
    expect(() =>
      getPlayerState<TestPlayerState>(session, 'unknown'),
    ).toThrow(StateAccessError);
    try {
      getPlayerState<TestPlayerState>(session, 'unknown');
    } catch (e) {
      expect((e as StateAccessError).kind).toBe('not-found');
    }
  });
});

describe('setPlayerState', () => {
  it('writes a player property', () => {
    const session = makeSession();
    setPlayerState<TestPlayerState, 'roundsWon'>(session, 'p1', 'roundsWon', 2);
    expect(session.state.players['p1'].properties['roundsWon']).toBe(2);
  });

  it('rejects values below min', () => {
    const session = makeSession();
    expect(() =>
      setPlayerState<TestPlayerState, 'roundsWon'>(session, 'p1', 'roundsWon', -1),
    ).toThrow(StateAccessError);
  });

  it('throws not-found for unknown player', () => {
    const session = makeSession();
    expect(() =>
      setPlayerState<TestPlayerState, 'roundsWon'>(session, 'unknown', 'roundsWon', 1),
    ).toThrow(StateAccessError);
  });
});

// ---------------------------------------------------------------------------
// getPieceState / setPieceState
// ---------------------------------------------------------------------------

describe('getPieceState', () => {
  it('returns piece properties as a typed projection', () => {
    const session = makeSession();
    const state = getPieceState<TestWeaponProps>(session, 'weapon-1');
    expect(state.description).toBe('A big hammer');
    expect(state.rps).toBe('rock');
  });

  it('throws not-found for unknown piece', () => {
    const session = makeSession();
    expect(() =>
      getPieceState<TestWeaponProps>(session, 'nope'),
    ).toThrow(StateAccessError);
  });
});

describe('setPieceState', () => {
  it('writes a piece property', () => {
    const session = makeSession();
    setPieceState<TestWeaponProps, 'rps'>(session, 'weapon-1', 'rps', 'scissors');
    expect(session.state.gamepieces['weapon-1'].properties['rps']).toBe('scissors');
  });

  it('rejects invalid enum value', () => {
    const session = makeSession();
    expect(() =>
      setPieceState<TestWeaponProps, 'rps'>(
        session,
        'weapon-1',
        'rps',
        'fire' as 'rock',
      ),
    ).toThrow(StateAccessError);
    try {
      setPieceState<TestWeaponProps, 'rps'>(
        session,
        'weapon-1',
        'rps',
        'fire' as 'rock',
      );
    } catch (e) {
      expect((e as StateAccessError).kind).toBe('invalid-enum');
      expect((e as StateAccessError).path).toBe('piece.weapon-1.rps');
    }
  });

  it('throws not-found for unknown piece', () => {
    const session = makeSession();
    expect(() =>
      setPieceState<TestWeaponProps, 'description'>(
        session,
        'nope',
        'description',
        'x',
      ),
    ).toThrow(StateAccessError);
  });
});

// ---------------------------------------------------------------------------
// Immutability guard
// ---------------------------------------------------------------------------

describe('immutability guard', () => {
  it('rejects writes to immutable game properties', () => {
    const session = makeSession({
      config: {
        gameProperties: {
          currentRound: { mutable: false },
        },
      },
    });
    expect(() =>
      setGameState<TestGameState, 'currentRound'>(session, 'currentRound', 5),
    ).toThrow(StateAccessError);
    try {
      setGameState<TestGameState, 'currentRound'>(session, 'currentRound', 5);
    } catch (e) {
      expect((e as StateAccessError).kind).toBe('immutable');
    }
  });

  it('rejects writes to immutable piece properties', () => {
    const session = makeSession({
      config: {
        gamepieceTypes: {
          weapon: {
            category: 'token',
            properties: {
              description: { mutable: false },
              rps: { mutable: true, enumValues: ['rock', 'paper', 'scissors'] },
              imageUrl: { mutable: true },
            },
          },
        },
      },
    });
    expect(() =>
      setPieceState<TestWeaponProps, 'description'>(
        session,
        'weapon-1',
        'description',
        'changed',
      ),
    ).toThrow(StateAccessError);
  });
});

// ---------------------------------------------------------------------------
// Max range guard
// ---------------------------------------------------------------------------

describe('max range guard', () => {
  it('rejects values above max for game properties', () => {
    const session = makeSession({
      config: {
        gameProperties: {
          currentRound: { mutable: true, min: 0, max: 10 },
        },
      },
    });
    expect(() =>
      setGameState<TestGameState, 'currentRound'>(session, 'currentRound', 11),
    ).toThrow(StateAccessError);
  });

  it('allows values within range', () => {
    const session = makeSession({
      config: {
        gameProperties: {
          currentRound: { mutable: true, min: 0, max: 10 },
        },
      },
    });
    setGameState<TestGameState, 'currentRound'>(session, 'currentRound', 10);
    expect(session.state.gameProperties['currentRound']).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Computed properties
// ---------------------------------------------------------------------------

interface GameStateWithComputed extends GameStateBase {
  currentRound: number;
  weaponCount: number;
}

interface PlayerStateWithComputed extends PlayerStateBase {
  roundsWon: number;
  arsenalCount: number;
  hasWeapon: boolean;
  totalStrength: number;
}

describe('computed game properties', () => {
  function makeComputedSession() {
    return makeSession({
      config: {
        gameProperties: {
          currentRound: { mutable: true, min: 0 },
          weaponCount: {
            mutable: false,
            computed: {
              inventory: 'arena',
              ofType: 'weapon',
              aggregate: 'count',
            },
          },
        },
        gamepieceTypes: {
          weapon: {
            category: 'token',
            properties: {
              description: { mutable: true },
              rps: { mutable: true, enumValues: ['rock', 'paper', 'scissors'] },
              imageUrl: { mutable: true },
            },
          },
        },
        inventories: {
          arena: {
            structure: 'stack',
            scope: 'game',
            visibility: 'always',
            countVisibility: 'always',
            accepts: ['weapon'],
          },
        },
      },
      state: {
        gameProperties: { currentRound: 0 },
        gameInventories: {
          arena: { structure: 'stack', pieceIds: ['weapon-1', 'weapon-2'] },
        },
        players: {
          p1: { roles: [], properties: { roundsWon: 0 }, inventories: {} },
          p2: { roles: [], properties: { roundsWon: 0 }, inventories: {} },
        },
        gamepieces: {
          'weapon-1': {
            typeId: 'weapon',
            ownerId: 'p1',
            properties: { description: 'Hammer', rps: 'rock', imageUrl: '' },
            faceUp: true,
            exhausted: false,
            visibleTo: 'all',
          },
          'weapon-2': {
            typeId: 'weapon',
            ownerId: 'p2',
            properties: { description: 'Scissors', rps: 'scissors', imageUrl: '' },
            faceUp: true,
            exhausted: false,
            visibleTo: 'all',
          },
        },
      },
    });
  }

  it('evaluates count aggregate on read', () => {
    const session = makeComputedSession();
    const state = getGameState<GameStateWithComputed>(session);
    expect(state.weaponCount).toBe(2);
    expect(state.currentRound).toBe(0);
  });

  it('reflects live inventory changes', () => {
    const session = makeComputedSession();
    // Remove a weapon from the arena
    (session.state.gameInventories['arena'] as { pieceIds: string[] }).pieceIds = ['weapon-1'];
    const state = getGameState<GameStateWithComputed>(session);
    expect(state.weaponCount).toBe(1);
  });

  it('returns 0 for empty inventory', () => {
    const session = makeComputedSession();
    (session.state.gameInventories['arena'] as { pieceIds: string[] }).pieceIds = [];
    const state = getGameState<GameStateWithComputed>(session);
    expect(state.weaponCount).toBe(0);
  });

  it('rejects writes to computed properties', () => {
    const session = makeComputedSession();
    expect(() =>
      setGameState<GameStateWithComputed, 'weaponCount'>(session, 'weaponCount', 99),
    ).toThrow(StateAccessError);
    try {
      setGameState<GameStateWithComputed, 'weaponCount'>(session, 'weaponCount', 99);
    } catch (e) {
      expect((e as StateAccessError).kind).toBe('immutable');
    }
  });
});

describe('computed player properties', () => {
  function makeComputedPlayerSession() {
    return makeSession({
      config: {
        playerProperties: {
          roundsWon: { mutable: true, min: 0 },
          arsenalCount: {
            mutable: false,
            computed: { inventory: 'arsenal', aggregate: 'count' },
          },
          hasWeapon: {
            mutable: false,
            computed: { inventory: 'arsenal', ofType: 'weapon', aggregate: 'exists' },
          },
          totalStrength: {
            mutable: false,
            computed: { inventory: 'arsenal', property: 'strength', aggregate: 'sum' },
          },
        },
        gamepieceTypes: {
          weapon: {
            category: 'token',
            properties: {
              description: { mutable: true },
              strength: { mutable: true, min: 0 },
              rps: { mutable: true, enumValues: ['rock', 'paper', 'scissors'] },
              imageUrl: { mutable: true },
            },
          },
        },
        inventories: {
          arsenal: {
            structure: 'stack',
            scope: 'player',
            visibility: 'owner',
            countVisibility: 'always',
            accepts: ['weapon'],
          },
        },
      },
      state: {
        gameProperties: { currentRound: 0, gameWinner: '', includeReversal: false },
        gameInventories: {},
        players: {
          p1: {
            roles: [],
            properties: { roundsWon: 0 },
            inventories: {
              arsenal: { structure: 'stack', pieceIds: ['w1', 'w2'] },
            },
          },
          p2: {
            roles: [],
            properties: { roundsWon: 0 },
            inventories: {
              arsenal: { structure: 'stack', pieceIds: [] },
            },
          },
        },
        gamepieces: {
          w1: {
            typeId: 'weapon',
            ownerId: 'p1',
            properties: { description: 'Axe', strength: 5, rps: 'rock', imageUrl: '' },
            faceUp: true,
            exhausted: false,
            visibleTo: 'all',
          },
          w2: {
            typeId: 'weapon',
            ownerId: 'p1',
            properties: { description: 'Bow', strength: 3, rps: 'scissors', imageUrl: '' },
            faceUp: true,
            exhausted: false,
            visibleTo: 'all',
          },
        },
      },
    });
  }

  it('count: counts pieces in player inventory', () => {
    const session = makeComputedPlayerSession();
    const p1 = getPlayerState<PlayerStateWithComputed>(session, 'p1');
    expect(p1.arsenalCount).toBe(2);
    const p2 = getPlayerState<PlayerStateWithComputed>(session, 'p2');
    expect(p2.arsenalCount).toBe(0);
  });

  it('exists: returns true when pieces present', () => {
    const session = makeComputedPlayerSession();
    const p1 = getPlayerState<PlayerStateWithComputed>(session, 'p1');
    expect(p1.hasWeapon).toBe(true);
    const p2 = getPlayerState<PlayerStateWithComputed>(session, 'p2');
    expect(p2.hasWeapon).toBe(false);
  });

  it('sum: sums a numeric piece property', () => {
    const session = makeComputedPlayerSession();
    const p1 = getPlayerState<PlayerStateWithComputed>(session, 'p1');
    expect(p1.totalStrength).toBe(8); // 5 + 3
  });

  it('stored properties still work alongside computed', () => {
    const session = makeComputedPlayerSession();
    setPlayerState<PlayerStateWithComputed, 'roundsWon'>(session, 'p1', 'roundsWon', 7);
    const p1 = getPlayerState<PlayerStateWithComputed>(session, 'p1');
    expect(p1.roundsWon).toBe(7);
    expect(p1.arsenalCount).toBe(2);
  });

  it('rejects writes to computed player properties', () => {
    const session = makeComputedPlayerSession();
    expect(() =>
      setPlayerState<PlayerStateWithComputed, 'arsenalCount'>(session, 'p1', 'arsenalCount', 99),
    ).toThrow(StateAccessError);
  });
});
