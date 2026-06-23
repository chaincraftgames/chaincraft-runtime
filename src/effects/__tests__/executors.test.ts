import type { GameSession, GameState, GameConfig, EffectContext } from '#chaincraft/types.js';
import { executeSetState } from '../set-state.js';
import { executeUpdate } from '../update.js';
import { executeSetRandom } from '../set-random.js';
import { executeMessage } from '../message.js';
import { executeFlip } from '../flip.js';
import { executeRoll } from '../roll.js';
import { createSeededRng } from '#chaincraft/rng/seeded.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<GameConfig>): GameConfig {
  return {
    inventories: {
      forge: {
        structure: 'stack',
        scope: 'player',
        visibility: 'owner',
        accepts: ['weapon'],
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
    gameProperties: {
      currentRound: { mutable: true, min: 0, max: 10 },
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
      p1: {
        properties: { roundsWon: 0 },
        inventories: {
          forge: { structure: 'stack', pieceIds: ['weapon-1'] },
        },
      },
      p2: {
        properties: { roundsWon: 0 },
        inventories: {
          forge: { structure: 'stack', pieceIds: [] },
        },
      },
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

function makeSession(seed = 42): GameSession {
  return {
    gameId: 'test-game',
    specId: 'test-spec',
    config: makeConfig(),
    state: makeState(),
    players: ['p1', 'p2'],
    outbox: [],
    rng: createSeededRng(seed),
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
// set-state
// ---------------------------------------------------------------------------

describe('executeSetState', () => {
  it('sets a game property to a literal value', async () => {
    const session = makeSession();
    await executeSetState(session, makeCtx({
      effectDef: { path: 'game.property.gameWinner', value: 'p1' },
    }));
    expect(session.state.gameProperties['gameWinner']).toBe('p1');
  });

  it('applies delta to a game property', async () => {
    const session = makeSession();
    await executeSetState(session, makeCtx({
      effectDef: { path: 'game.property.currentRound', value: { delta: 1 } },
    }));
    expect(session.state.gameProperties['currentRound']).toBe(1);
  });

  it('clamps delta to max', async () => {
    const session = makeSession();
    session.state.gameProperties['currentRound'] = 9;
    await executeSetState(session, makeCtx({
      effectDef: { path: 'game.property.currentRound', value: { delta: 5 } },
    }));
    expect(session.state.gameProperties['currentRound']).toBe(10);
  });

  it('clamps delta to min', async () => {
    const session = makeSession();
    session.state.gameProperties['currentRound'] = 1;
    await executeSetState(session, makeCtx({
      effectDef: { path: 'game.property.currentRound', value: { delta: -5 } },
    }));
    expect(session.state.gameProperties['currentRound']).toBe(0);
  });

  it('toggles a boolean game property', async () => {
    const session = makeSession();
    await executeSetState(session, makeCtx({
      effectDef: { path: 'game.property.includeReversal', value: { toggle: true } },
    }));
    expect(session.state.gameProperties['includeReversal']).toBe(true);
  });

  it('sets a player property to a literal value', async () => {
    const session = makeSession();
    await executeSetState(session, makeCtx({
      effectDef: { path: 'player.property.roundsWon', value: 3 },
    }));
    expect(session.state.players['p1'].properties['roundsWon']).toBe(3);
  });

  it('resolves param from action inputs', async () => {
    const session = makeSession();
    await executeSetState(session, makeCtx({
      actionInputs: { weaponName: 'Anvil Launcher' },
      effectDef: { path: 'game.property.gameWinner', value: { param: 'weaponName' } },
    }));
    expect(session.state.gameProperties['gameWinner']).toBe('Anvil Launcher');
  });

  it('resolves actor to the acting player ID', async () => {
    const session = makeSession();
    await executeSetState(session, makeCtx({
      effectDef: { path: 'game.property.gameWinner', value: { actor: true } },
    }));
    expect(session.state.gameProperties['gameWinner']).toBe('p1');
  });

  it('throws on invalid path', async () => {
    const session = makeSession();
    await expect(
      executeSetState(session, makeCtx({
        effectDef: { path: 'invalid.path', value: 0 },
      })),
    ).rejects.toThrow('Invalid set-state path');
  });

  it('throws when setting player property without actorId and no target', async () => {
    const session = makeSession();
    await expect(
      executeSetState(session, makeCtx({
        actorId: null,
        effectDef: { path: 'player.property.roundsWon', value: 1 },
      })),
    ).rejects.toThrow('requires an actorId');
  });

  // -- Player targeting --

  it('targets all players', async () => {
    const session = makeSession();
    await executeSetState(session, makeCtx({
      effectDef: {
        path: 'player.property.roundsWon',
        value: 5,
        target: { kind: 'all' },
      },
    }));
    expect(session.state.players['p1'].properties['roundsWon']).toBe(5);
    expect(session.state.players['p2'].properties['roundsWon']).toBe(5);
  });

  it('targets all-other players', async () => {
    const session = makeSession();
    session.state.players['p1'].properties['roundsWon'] = 10;
    await executeSetState(session, makeCtx({
      effectDef: {
        path: 'player.property.roundsWon',
        value: { delta: -1 },
        target: { kind: 'all-other' },
      },
    }));
    // p1 is actor, so unchanged
    expect(session.state.players['p1'].properties['roundsWon']).toBe(10);
    // p2 had 0, delta -1 clamped to min 0
    expect(session.state.players['p2'].properties['roundsWon']).toBe(0);
  });

  it('targets a player from action input (param)', async () => {
    const session = makeSession();
    await executeSetState(session, makeCtx({
      actionInputs: { targetPlayer: 'p2' },
      effectDef: {
        path: 'player.property.roundsWon',
        value: 99,
        target: { kind: 'param', inputId: 'targetPlayer' },
      },
    }));
    expect(session.state.players['p1'].properties['roundsWon']).toBe(0);
    expect(session.state.players['p2'].properties['roundsWon']).toBe(99);
  });

  it('targets a player from state ref', async () => {
    const session = makeSession();
    session.state.gameProperties['gameWinner'] = 'p2';
    await executeSetState(session, makeCtx({
      effectDef: {
        path: 'player.property.roundsWon',
        value: 100,
        target: { kind: 'stateRef', path: 'game.property.gameWinner' },
      },
    }));
    expect(session.state.players['p2'].properties['roundsWon']).toBe(100);
    expect(session.state.players['p1'].properties['roundsWon']).toBe(0);
  });

  it('targets players matching a property condition', async () => {
    const session = makeSession();
    session.state.players['p1'].properties['roundsWon'] = 3;
    session.state.players['p2'].properties['roundsWon'] = 1;
    await executeSetState(session, makeCtx({
      effectDef: {
        path: 'player.property.roundsWon',
        value: { delta: 1 },
        target: {
          kind: 'matching',
          condition: { '>=': [{ var: 'player.property.roundsWon' }, 2] },
        },
      },
    }));
    // Only p1 matches (3 >= 2), gets +1
    expect(session.state.players['p1'].properties['roundsWon']).toBe(4);
    // p2 doesn't match (1 < 2), unchanged
    expect(session.state.players['p2'].properties['roundsWon']).toBe(1);
  });

  it('targets players matching an inventory count condition', async () => {
    const session = makeSession();
    // p1 has 1 piece in forge, p2 has 0
    await executeSetState(session, makeCtx({
      effectDef: {
        path: 'player.property.roundsWon',
        value: 7,
        target: {
          kind: 'matching',
          condition: { '>=': [{ var: 'player.inventory.forge.count' }, 1] },
        },
      },
    }));
    expect(session.state.players['p1'].properties['roundsWon']).toBe(7);
    expect(session.state.players['p2'].properties['roundsWon']).toBe(0);
  });

  it('matching with no players matching returns empty (no-op)', async () => {
    const session = makeSession();
    await executeSetState(session, makeCtx({
      effectDef: {
        path: 'player.property.roundsWon',
        value: 999,
        target: {
          kind: 'matching',
          condition: { '>': [{ var: 'player.property.roundsWon' }, 100] },
        },
      },
    }));
    expect(session.state.players['p1'].properties['roundsWon']).toBe(0);
    expect(session.state.players['p2'].properties['roundsWon']).toBe(0);
  });
  // -- ref-type validation --

  it('accepts a valid player-id ref write', async () => {
    const session = makeSession();
    session.config.gameProperties['gameWinner'] = { mutable: true, refType: 'player-id' };
    await expect(
      executeSetState(session, makeCtx({
        effectDef: { path: 'game.property.gameWinner', value: 'p1' },
      }))
    ).resolves.toBeUndefined();
    expect(session.state.gameProperties['gameWinner']).toBe('p1');
  });

  it('throws when writing an unknown player ID to a player-id ref property', async () => {
    const session = makeSession();
    session.config.gameProperties['gameWinner'] = { mutable: true, refType: 'player-id' };
    await expect(
      executeSetState(session, makeCtx({
        effectDef: { path: 'game.property.gameWinner', value: 'p99' },
      }))
    ).rejects.toThrow('not a valid player ID');
  });

  it('accepts a valid gamepiece-id ref write', async () => {
    const session = makeSession();
    session.config.gameProperties['gameWinner'] = { mutable: true, refType: 'gamepiece-id' };
    session.state.gameProperties['gameWinner'] = '';
    await expect(
      executeSetState(session, makeCtx({
        effectDef: { path: 'game.property.gameWinner', value: 'weapon-1' },
      }))
    ).resolves.toBeUndefined();
    expect(session.state.gameProperties['gameWinner']).toBe('weapon-1');
  });

  it('throws when writing an unknown gamepiece ID to a gamepiece-id ref property', async () => {
    const session = makeSession();
    session.config.gameProperties['gameWinner'] = { mutable: true, refType: 'gamepiece-id' };
    await expect(
      executeSetState(session, makeCtx({
        effectDef: { path: 'game.property.gameWinner', value: 'no-such-piece' },
      }))
    ).rejects.toThrow('not a valid gamepiece ID');
  });

  it('accepts a valid player-role-id ref write when roles configured', async () => {
    const session = makeSession();
    session.config.roles = ['dealer', 'challenger'];
    session.config.gameProperties['gameWinner'] = { mutable: true, refType: 'player-role-id' };
    await expect(
      executeSetState(session, makeCtx({
        effectDef: { path: 'game.property.gameWinner', value: 'dealer' },
      }))
    ).resolves.toBeUndefined();
  });

  it('throws when writing an unknown role ID to a player-role-id ref property', async () => {
    const session = makeSession();
    session.config.roles = ['dealer', 'challenger'];
    session.config.gameProperties['gameWinner'] = { mutable: true, refType: 'player-role-id' };
    await expect(
      executeSetState(session, makeCtx({
        effectDef: { path: 'game.property.gameWinner', value: 'spy' },
      }))
    ).rejects.toThrow('not a valid player role ID');
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('executeUpdate', () => {
  it('sets a piece property to a literal value', async () => {
    const session = makeSession();
    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'rps',
        value: 'scissors',
      },
    }));
    expect(session.state.gamepieces['weapon-1'].properties['rps']).toBe('scissors');
  });

  it('applies delta to a numeric piece property', async () => {
    // Add a numeric property to test delta
    const session = makeSession();
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 10;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true, min: 0, max: 20 };

    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        value: { delta: -3 },
      },
    }));
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(7);
  });

  it('handles empty selection gracefully', async () => {
    const session = makeSession();
    // p2's forge is empty, so selecting top returns nothing
    await executeUpdate(session, makeCtx({
      actorId: 'p2',
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'rps',
        value: 'paper',
      },
    }));
    // Should not throw, just no-op
  });

  it('resolves var reference to game property', async () => {
    const session = makeSession();
    session.state.gameProperties['currentRound'] = 5;
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 10;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true };

    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        value: { var: 'game.property.currentRound' },
      },
    }));
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(5);
  });

  it('resolves var reference to player property', async () => {
    const session = makeSession();
    session.state.players['p1'].properties['roundsWon'] = 3;
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 10;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true };

    await executeUpdate(session, makeCtx({
      actorId: 'p1',
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        value: { var: 'player.property.roundsWon' },
      },
    }));
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(3);
  });

  it('applies delta with var reference', async () => {
    const session = makeSession();
    session.state.gameProperties['currentRound'] = 2;
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 10;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true };

    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        value: { delta: { var: 'game.property.currentRound' } },
      },
    }));
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(12);
  });

  it('applies delta with negated var reference (subtract positive value)', async () => {
    const session = makeSession();
    session.state.players['p1'].properties['roundsWon'] = 3;
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 10;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true };

    await executeUpdate(session, makeCtx({
      actorId: 'p1',
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        value: { delta: { var: 'player.property.roundsWon', negate: true } },
      },
    }));
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(7);
  });

  it('applies delta with negated var reference and clamping', async () => {
    const session = makeSession();
    session.state.gameProperties['currentRound'] = 15;
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 10;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true, min: 0, max: 20 };

    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        value: { delta: { var: 'game.property.currentRound', negate: true } },
      },
    }));
    // 10 + (-15) = -5, clamped to min 0
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(0);
  });

  it('applies mult with a literal factor (halve)', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 10;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true };

    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        value: { mult: 0.5 },
      },
    }));
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(5);
  });

  it('applies mult with a literal factor (double)', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 7;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true };

    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        value: { mult: 2 },
      },
    }));
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(14);
  });

  it('applies mult with var reference', async () => {
    const session = makeSession();
    session.state.gameProperties['currentRound'] = 3;
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 4;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true };

    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        value: { mult: { var: 'game.property.currentRound' } },
      },
    }));
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(12);
  });

  it('applies mult with clamping', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 15;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true, min: 0, max: 20 };

    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        value: { mult: 2 },
      },
    }));
    // 15 * 2 = 30, clamped to max 20
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(20);
  });

  it('rounds mult result to nearest integer', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 7;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true };

    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        value: { mult: 0.5 },
      },
    }));
    // 7 * 0.5 = 3.5 → rounds to 4
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// set-random
// ---------------------------------------------------------------------------

describe('executeSetRandom', () => {
  it('picks from equal-probability options (deterministic with seed)', async () => {
    const session = makeSession(100);
    await executeSetRandom(session, makeCtx({
      effectDef: {
        source: {
          kind: 'options',
          options: [
            { value: 'hearts' },
            { value: 'diamonds' },
            { value: 'clubs' },
            { value: 'spades' },
          ],
        },
        path: 'game.property.gameWinner',
      },
    }));
    const result = session.state.gameProperties['gameWinner'];
    expect(['hearts', 'diamonds', 'clubs', 'spades']).toContain(result);
  });

  it('picks from weighted options', async () => {
    // With seed 42, run multiple times to verify the weighting affects distribution
    const results: unknown[] = [];
    for (let seed = 0; seed < 100; seed++) {
      const session = makeSession(seed);
      await executeSetRandom(session, makeCtx({
        effectDef: {
          source: {
            kind: 'options',
            options: [
              { value: true, weight: 0.25 },
              { value: false, weight: 0.75 },
            ],
          },
          path: 'game.property.includeReversal',
        },
      }));
      results.push(session.state.gameProperties['includeReversal']);
    }
    const trueCount = results.filter((r) => r === true).length;
    // With 100 samples and 25% probability, we expect roughly 25 trues
    // Allow wide range for statistical validity
    expect(trueCount).toBeGreaterThan(5);
    expect(trueCount).toBeLessThan(60);
  });

  it('picks an integer from a range', async () => {
    const session = makeSession(42);
    await executeSetRandom(session, makeCtx({
      effectDef: {
        source: { kind: 'range', min: 1, max: 6 },
        path: 'game.property.currentRound',
      },
    }));
    const result = session.state.gameProperties['currentRound'] as number;
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(6);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('is deterministic — same seed produces same result', async () => {
    const results: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      const session = makeSession(999);
      await executeSetRandom(session, makeCtx({
        effectDef: {
          source: { kind: 'range', min: 1, max: 100 },
          path: 'game.property.currentRound',
        },
      }));
      results.push(session.state.gameProperties['currentRound']);
    }
    expect(results[0]).toBe(results[1]);
  });

  it('writes to a player property', async () => {
    const session = makeSession(42);
    await executeSetRandom(session, makeCtx({
      effectDef: {
        source: { kind: 'range', min: 0, max: 5 },
        path: 'player.property.roundsWon',
      },
    }));
    const result = session.state.players['p1'].properties['roundsWon'] as number;
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// message
// ---------------------------------------------------------------------------

describe('executeMessage', () => {
  it('pushes a public message to all', async () => {
    const session = makeSession();
    await executeMessage(session, makeCtx({
      effectDef: { template: 'Round begins!' },
    }));
    expect(session.outbox).toHaveLength(1);
    expect(session.outbox[0]).toEqual({
      to: 'all',
      content: 'Round begins!',
    });
  });

  it('pushes a private message to a specific player', async () => {
    const session = makeSession();
    await executeMessage(session, makeCtx({
      effectDef: { template: 'Your secret weapon is ready.', to: 'p1' },
    }));
    expect(session.outbox[0]).toEqual({
      to: 'p1',
      content: 'Your secret weapon is ready.',
    });
  });

  it('accumulates multiple messages', async () => {
    const session = makeSession();
    await executeMessage(session, makeCtx({
      effectDef: { template: 'First' },
    }));
    await executeMessage(session, makeCtx({
      effectDef: { template: 'Second' },
    }));
    expect(session.outbox).toHaveLength(2);
  });

  it('interpolates {{input.<id>}} tokens', async () => {
    const session = makeSession();
    await executeMessage(session, makeCtx({
      actionInputs: { weaponName: 'Anvil Launcher' },
      effectDef: { template: "Your weapon '{{input.weaponName}}' has been registered." },
    }));
    expect(session.outbox[0].content).toBe("Your weapon 'Anvil Launcher' has been registered.");
  });

  it('interpolates {{state.game.property.<id>}} tokens', async () => {
    const session = makeSession();
    session.state.gameProperties['currentRound'] = 3;
    await executeMessage(session, makeCtx({
      effectDef: { template: 'Round {{state.game.property.currentRound}} begins.' },
    }));
    expect(session.outbox[0].content).toBe('Round 3 begins.');
  });

  it('interpolates {{state.players.<id>.property.<id>}} tokens', async () => {
    const session = makeSession();
    session.state.players['p1'].properties['roundsWon'] = 2;
    await executeMessage(session, makeCtx({
      effectDef: { template: 'Player p1 has won {{state.players.p1.property.roundsWon}} rounds.' },
    }));
    expect(session.outbox[0].content).toBe('Player p1 has won 2 rounds.');
  });

  it('leaves unrecognised tokens as-is', async () => {
    const session = makeSession();
    await executeMessage(session, makeCtx({
      effectDef: { template: 'Hello {{llm.greeting}}' },
    }));
    expect(session.outbox[0].content).toBe('Hello {{llm.greeting}}');
  });
});

// ---------------------------------------------------------------------------
// flip
// ---------------------------------------------------------------------------

describe('executeFlip', () => {
  it('sets face-down piece to face-up', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].faceUp = false;
    await executeFlip(session, makeCtx({
      effectDef: { pieces: { inventory: 'forge', select: 'all' }, to: 'face-up' },
    }));
    expect(session.state.gamepieces['weapon-1'].faceUp).toBe(true);
  });

  it('sets face-up piece to face-down', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].faceUp = true;
    await executeFlip(session, makeCtx({
      effectDef: { pieces: { inventory: 'forge', select: 'all' }, to: 'face-down' },
    }));
    expect(session.state.gamepieces['weapon-1'].faceUp).toBe(false);
  });

  it('toggle flips face-up piece to face-down', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].faceUp = true;
    await executeFlip(session, makeCtx({
      effectDef: { pieces: { inventory: 'forge', select: 'all' }, to: 'toggle' },
    }));
    expect(session.state.gamepieces['weapon-1'].faceUp).toBe(false);
  });

  it('toggle flips face-down piece to face-up', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].faceUp = false;
    await executeFlip(session, makeCtx({
      effectDef: { pieces: { inventory: 'forge', select: 'all' }, to: 'toggle' },
    }));
    expect(session.state.gamepieces['weapon-1'].faceUp).toBe(true);
  });

  it('flips multiple pieces', async () => {
    const session = makeSession(42);
    session.state.players['p1'].inventories['forge'] = { structure: 'stack', pieceIds: ['weapon-1', 'weapon-2'] };
    session.state.gamepieces['weapon-2'] = {
      typeId: 'weapon', ownerId: 'p1',
      properties: { description: '', rps: 'paper', imageUrl: '' },
      faceUp: true, exhausted: false, visibleTo: null,
    };
    await executeFlip(session, makeCtx({
      effectDef: { pieces: { inventory: 'forge', select: 'all' }, to: 'face-down' },
    }));
    expect(session.state.gamepieces['weapon-1'].faceUp).toBe(false);
    expect(session.state.gamepieces['weapon-2'].faceUp).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// roll
// ---------------------------------------------------------------------------

function makeDiceSession(): GameSession {
  const session = makeSession();
  session.config.gamepieceTypes['die'] = { category: 'dice', faceCount: 6, properties: {} };
  session.config.inventories['dice-tray'] = {
    structure: 'none', scope: 'game', visibility: 'always', accepts: ['die'],
  };
  session.state.gameInventories['dice-tray'] = { structure: 'none', pieceIds: ['die-1', 'die-2'] };
  session.state.gamepieces['die-1'] = {
    typeId: 'die', ownerId: 'game', properties: {}, faceUp: true, exhausted: false, visibleTo: null,
  };
  session.state.gamepieces['die-2'] = {
    typeId: 'die', ownerId: 'game', properties: {}, faceUp: true, exhausted: false, visibleTo: null,
  };
  return session;
}

describe('executeRoll', () => {
  it('sets faceValue in [1, faceCount] for a single die', async () => {
    const session = makeDiceSession();
    await executeRoll(session, makeCtx({
      effectDef: { pieces: { inventory: 'dice-tray', select: 'top' } },
    }));
    const fv = session.state.gamepieces['die-1'].faceValue; // bag top = first
    expect(fv).toBeGreaterThanOrEqual(1);
    expect(fv).toBeLessThanOrEqual(6);
  });

  it('rolls all selected dice independently', async () => {
    const session = makeDiceSession();
    await executeRoll(session, makeCtx({
      effectDef: { pieces: { inventory: 'dice-tray', select: 'all' } },
    }));
    for (const id of ['die-1', 'die-2']) {
      const fv = session.state.gamepieces[id].faceValue;
      expect(fv).toBeGreaterThanOrEqual(1);
      expect(fv).toBeLessThanOrEqual(6);
    }
  });

  it('rolls are deterministic with the same seed', async () => {
    const a = makeDiceSession();
    const b = makeSession(); // fresh session with same seed (42)
    b.config.gamepieceTypes['die'] = { category: 'dice', faceCount: 6, properties: {} };
    b.config.inventories['dice-tray'] = { structure: 'none', scope: 'game', visibility: 'always', accepts: ['die'] };
    b.state.gameInventories['dice-tray'] = { structure: 'none', pieceIds: ['die-1', 'die-2'] };
    b.state.gamepieces['die-1'] = { typeId: 'die', ownerId: 'game', properties: {}, faceUp: true, exhausted: false, visibleTo: null };
    b.state.gamepieces['die-2'] = { typeId: 'die', ownerId: 'game', properties: {}, faceUp: true, exhausted: false, visibleTo: null };
    const def = { effectDef: { pieces: { inventory: 'dice-tray', select: 'all' } } };
    await executeRoll(a, makeCtx(def));
    await executeRoll(b, makeCtx(def));
    expect(a.state.gamepieces['die-1'].faceValue).toBe(b.state.gamepieces['die-1'].faceValue);
    expect(a.state.gamepieces['die-2'].faceValue).toBe(b.state.gamepieces['die-2'].faceValue);
  });

  it('skips pieces whose type has no faceCount', async () => {
    const session = makeSession();
    // weapon type has no faceCount
    await executeRoll(session, makeCtx({
      effectDef: { pieces: { inventory: 'forge', select: 'all' } },
    }));
    expect(session.state.gamepieces['weapon-1'].faceValue).toBeUndefined();
  });
});
