import type { GameSession, GameState, GameConfig, EffectContext } from '#chaincraft/types.js';
import type { CompiledValueFn } from '../resolve-value.js';
import { executeSetState } from '../set-state.js';
import { executeUpdate } from '../update.js';
import { executeSetRandom } from '../set-random.js';
import { executeMessage } from '../message.js';
import { executeFlip } from '../flip.js';
import { executeRoll } from '../roll.js';
import { executeOrient } from '../orient.js';
import { executeReveal, executeHide } from '../reveal-hide.js';
import { createSeededRng } from '#chaincraft/rng/seeded.js';
import { GameEventEmitter } from '#chaincraft/events/emitter.js';
import { EffectBus } from '../index.js';
import { AdjustablePendingEffect } from '../effect-bus.js';

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
        countVisibility: 'always',
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
        roles: [],
        properties: { roundsWon: 0 },
        inventories: {
          forge: { structure: 'stack', pieceIds: ['weapon-1'] },
        },
      },
      p2: {
        roles: [],
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
          condition: (_s: GameSession, playerId: string) =>
            ((session.state.players[playerId]?.properties['roundsWon'] as number) ?? 0) >= 2,
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
          condition: (_s: GameSession, playerId: string) => {
            const inv = session.state.players[playerId]?.inventories['forge'];
            const count = inv && 'pieceIds' in inv ? inv.pieceIds.length : 0;
            return count >= 1;
          },
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
          condition: (_s: GameSession, playerId: string) =>
            ((session.state.players[playerId]?.properties['roundsWon'] as number) ?? 0) > 100,
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

  // -- Passive/Reactive effect interception --

  it('skips state-write when passive cancels', async () => {
    const session = makeSession();
    const bus = new EffectBus();
    session.bus = bus;
    session.state.players['p1'].properties['roundsWon'] = 5;

    // Register a passive that blocks damage (decrease)
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.roundsWon', direction: 'decrease' },
      'p1',
      (pending) => pending.cancel(),
    );

    // Try to decrease p1's roundsWon
    await executeSetState(session, makeCtx({
      effectDef: { path: 'player.property.roundsWon', value: { delta: -3 } },
    }));

    // Should be unchanged because passive cancelled
    expect(session.state.players['p1'].properties['roundsWon']).toBe(5);
  });

  it('adjusts state-write value with delta before writing', async () => {
    const session = makeSession();
    const bus = new EffectBus();
    session.bus = bus;
    session.state.players['p1'].properties['roundsWon'] = 10;

    // Register a passive that adds +2 to the resolved value (like a heal or buff)
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.roundsWon', direction: 'any' },
      'p1',
      (pending) => (pending as AdjustablePendingEffect).adjust({ delta: 2 }),
    );

    // Try to decrease by 5 → resolved = 10 - 5 = 5
    await executeSetState(session, makeCtx({
      effectDef: { path: 'player.property.roundsWon', value: { delta: -5 } },
    }));

    // Passive adjusts: 5 + 2 = 7
    expect(session.state.players['p1'].properties['roundsWon']).toBe(7);
  });

  it('adjusts state-write value with mult before writing', async () => {
    const session = makeSession();
    const bus = new EffectBus();
    session.bus = bus;
    session.state.players['p1'].properties['roundsWon'] = 10;

    // Register a passive that halves the resolved value
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.roundsWon', direction: 'any' },
      'p1',
      (pending) => (pending as AdjustablePendingEffect).adjust({ mult: 0.5 }),
    );

    // Try to decrease by 4 → resolved = 10 - 4 = 6
    await executeSetState(session, makeCtx({
      effectDef: { path: 'player.property.roundsWon', value: { delta: -4 } },
    }));

    // Passive adjusts: 6 * 0.5 = 3
    expect(session.state.players['p1'].properties['roundsWon']).toBe(3);
  });

  it('accumulates multiple passive adjustments', async () => {
    const session = makeSession();
    const bus = new EffectBus();
    session.bus = bus;
    session.state.players['p1'].properties['roundsWon'] = 20;

    // First passive: add 2 to the resolved value
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.roundsWon', direction: 'any' },
      'p1',
      (pending) => (pending as AdjustablePendingEffect).adjust({ delta: 2 }),
    );

    // Second passive: halve the result
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.roundsWon', direction: 'any' },
      'p1',
      (pending) => (pending as AdjustablePendingEffect).adjust({ mult: 0.5 }),
    );

    // Try to decrease by 10 → resolved = 20 - 10 = 10
    await executeSetState(session, makeCtx({
      effectDef: { path: 'player.property.roundsWon', value: { delta: -10 } },
    }));

    // First passive: 10 + 2 = 12
    // Second passive: 12 * 0.5 = 6
    expect(session.state.players['p1'].properties['roundsWon']).toBe(6);
  });

  // -- Reactive effect interception (after) --

  it('triggers after hook when state-write completes', async () => {
    const session = makeSession();
    const bus = new EffectBus();
    session.bus = bus;
    session.state.players['p1'].properties['roundsWon'] = 5;

    const afterCalls: Array<{ finalValue: number; direction: string }> = [];

    // Register a reactive that tracks state-writes
    bus.onAfter(
      { kind: 'state-write', scope: 'target', path: 'player.property.roundsWon', direction: 'any' },
      'p1',
      (event) => {
        afterCalls.push({
          finalValue: (event as any).resolvedValue,
          direction: (event as any).direction,
        });
      },
    );

    // Write to p1's roundsWon
    await executeSetState(session, makeCtx({
      effectDef: { path: 'player.property.roundsWon', value: { delta: 3 } },
    }));

    expect(afterCalls).toHaveLength(1);
    expect(afterCalls[0].finalValue).toBe(8);
    expect(afterCalls[0].direction).toBe('increase');
  });

  it('triggers after hook with adjusted value', async () => {
    const session = makeSession();
    const bus = new EffectBus();
    session.bus = bus;
    session.state.players['p1'].properties['roundsWon'] = 10;

    const beforeCalls: any[] = [];
    const afterCalls: any[] = [];

    // Register a passive that adjusts
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.roundsWon', direction: 'any' },
      'p1',
      (pending) => {
        beforeCalls.push((pending as AdjustablePendingEffect).resolvedValue);
        (pending as AdjustablePendingEffect).adjust({ delta: 2 });
      },
    );

    // Register a reactive that sees the adjusted value
    bus.onAfter(
      { kind: 'state-write', scope: 'target', path: 'player.property.roundsWon', direction: 'any' },
      'p1',
      (event) => {
        afterCalls.push((event as any).resolvedValue);
      },
    );

    // Try to decrease by 5 → resolved = 10 - 5 = 5 → adjusted to 7
    await executeSetState(session, makeCtx({
      effectDef: { path: 'player.property.roundsWon', value: { delta: -5 } },
    }));

    expect(beforeCalls).toEqual([5]); // Before sees original
    expect(afterCalls).toEqual([7]); // After sees adjusted value
    expect(session.state.players['p1'].properties['roundsWon']).toBe(7);
  });

  it('does not trigger after hook when passive cancels', async () => {
    const session = makeSession();
    const bus = new EffectBus();
    session.bus = bus;
    session.state.players['p1'].properties['roundsWon'] = 5;

    const afterCalls: any[] = [];

    // Register a passive that cancels
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'player.property.roundsWon', direction: 'decrease' },
      'p1',
      (pending) => pending.cancel(),
    );

    // Register a reactive that should NOT be called
    bus.onAfter(
      { kind: 'state-write', scope: 'target', path: 'player.property.roundsWon', direction: 'decrease' },
      'p1',
      () => {
        afterCalls.push('triggered');
      },
    );

    // Try to decrease (should be cancelled)
    await executeSetState(session, makeCtx({
      effectDef: { path: 'player.property.roundsWon', value: { delta: -3 } },
    }));

    expect(afterCalls).toHaveLength(0); // After not called
    expect(session.state.players['p1'].properties['roundsWon']).toBe(5); // Unchanged
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('executeUpdate', () => {
  it('updates a gamepiece property to a literal value', async () => {
    const session = makeSession();
    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'description',
        value: 'A mighty sword',
      },
    }));
    expect(session.state.gamepieces['weapon-1'].properties['description']).toBe('A mighty sword');
  });

  it('updates a gamepiece numeric property with delta', async () => {
    const session = makeSession();
    // First add a numeric property to the weapon
    session.state.gamepieces['weapon-1'].properties['power'] = 5;
    session.config.gamepieceTypes['weapon'].properties['power'] = { mutable: true };

    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'power',
        value: { delta: 3 },
      },
    }));

    expect(session.state.gamepieces['weapon-1'].properties['power']).toBe(8);
  });

  // -- Passive/Reactive effect interception --

  it('triggers before hook when update on numeric property', async () => {
    const session = makeSession();
    const bus = new EffectBus();
    session.bus = bus;
    session.state.gamepieces['weapon-1'].properties['power'] = 5;
    session.config.gamepieceTypes['weapon'].properties['power'] = { mutable: true };

    const beforeCalls: any[] = [];

    // Register a reactive that listens to updates
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'gamepiece.property.power', direction: 'any' },
      'weapon-1',
      (pending) => {
        beforeCalls.push((pending as AdjustablePendingEffect).resolvedValue);
      },
    );

    await executeUpdate(session, makeCtx({
      actorId: 'p1',
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'power',
        value: { delta: 2 },
      },
    }));

    expect(beforeCalls).toEqual([7]); // 5 + 2 = 7
  });

  it('cancels update when passive blocks', async () => {
    const session = makeSession();
    const bus = new EffectBus();
    session.bus = bus;
    session.state.gamepieces['weapon-1'].properties['power'] = 5;
    session.config.gamepieceTypes['weapon'].properties['power'] = { mutable: true };

    // Register a passive that blocks decreases
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'gamepiece.property.power', direction: 'decrease' },
      'weapon-1',
      (pending) => pending.cancel(),
    );

    await executeUpdate(session, makeCtx({
      actorId: 'p1',
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'power',
        value: { delta: -2 },
      },
    }));

    expect(session.state.gamepieces['weapon-1'].properties['power']).toBe(5); // Unchanged
  });

  it('adjusts update value with delta', async () => {
    const session = makeSession();
    const bus = new EffectBus();
    session.bus = bus;
    session.state.gamepieces['weapon-1'].properties['power'] = 10;
    session.config.gamepieceTypes['weapon'].properties['power'] = { mutable: true };

    // Register a passive that boosts all damage
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'gamepiece.property.power', direction: 'increase' },
      'weapon-1',
      (pending) => (pending as AdjustablePendingEffect).adjust({ delta: 2 }),
    );

    await executeUpdate(session, makeCtx({
      actorId: 'p1',
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'power',
        value: { delta: 5 },
      },
    }));

    // 10 + 5 = 15, then passive adds 2 → 17
    expect(session.state.gamepieces['weapon-1'].properties['power']).toBe(17);
  });

  it('triggers after hook when update completes', async () => {
    const session = makeSession();
    const bus = new EffectBus();
    session.bus = bus;
    session.state.gamepieces['weapon-1'].properties['power'] = 10;
    session.config.gamepieceTypes['weapon'].properties['power'] = { mutable: true };

    const afterCalls: any[] = [];

    // Register a reactive that triggers after updates
    bus.onAfter(
      { kind: 'state-write', scope: 'target', path: 'gamepiece.property.power', direction: 'any' },
      'weapon-1',
      (event) => {
        afterCalls.push((event as any).resolvedValue);
      },
    );

    await executeUpdate(session, makeCtx({
      actorId: 'p1',
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'power',
        value: { delta: 3 },
      },
    }));

    expect(afterCalls).toEqual([13]); // 10 + 3 = 13
  });

  it('after hook sees adjusted value from passive', async () => {
    const session = makeSession();
    const bus = new EffectBus();
    session.bus = bus;
    session.state.gamepieces['weapon-1'].properties['power'] = 10;
    session.config.gamepieceTypes['weapon'].properties['power'] = { mutable: true };

    const beforeCalls: any[] = [];
    const afterCalls: any[] = [];

    // Register a passive that halves
    bus.onBefore(
      { kind: 'state-write', scope: 'target', path: 'gamepiece.property.power', direction: 'any' },
      'weapon-1',
      (pending) => {
        beforeCalls.push((pending as AdjustablePendingEffect).resolvedValue);
        (pending as AdjustablePendingEffect).adjust({ mult: 0.5 });
      },
    );

    // Register a reactive that sees the adjusted value
    bus.onAfter(
      { kind: 'state-write', scope: 'target', path: 'gamepiece.property.power', direction: 'any' },
      'weapon-1',
      (event) => {
        afterCalls.push((event as any).resolvedValue);
      },
    );

    await executeUpdate(session, makeCtx({
      actorId: 'p1',
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'power',
        value: { delta: 4 },
      },
    }));

    expect(beforeCalls).toEqual([14]); // 10 + 4 = 14
    expect(afterCalls).toEqual([7]); // 14 * 0.5 = 7
    expect(session.state.gamepieces['weapon-1'].properties['power']).toBe(7);
  });

  // -- Original executeUpdate tests --
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

  it('applies delta with expr reference', async () => {
    const session = makeSession();
    session.state.gameProperties['currentRound'] = 3;
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 10;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true };

    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        // expr computes currentRound - 1 = 2; delta adds 2 → 12
        value: { delta: { expr: ((s) => (s.state.gameProperties['currentRound'] as number) - 1) as CompiledValueFn } },
      },
    }));
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(12);
  });

  it('applies mult with expr reference', async () => {
    const session = makeSession();
    session.state.gameProperties['currentRound'] = 3;
    session.state.gamepieces['weapon-1'].properties['hitPoints'] = 4;
    session.config.gamepieceTypes['weapon'].properties['hitPoints'] = { mutable: true };

    await executeUpdate(session, makeCtx({
      effectDef: {
        pieces: { inventory: 'forge', select: 'top' },
        property: 'hitPoints',
        // expr computes currentRound + 1 = 4; mult 4 → 16
        value: { mult: { expr: ((s) => (s.state.gameProperties['currentRound'] as number) + 1) as CompiledValueFn } },
      },
    }));
    expect(session.state.gamepieces['weapon-1'].properties['hitPoints']).toBe(16);
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
      recipients: ['p1', 'p2'],
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
      recipients: ['p1'],
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
    structure: 'none', scope: 'game', visibility: 'always', countVisibility: 'always', accepts: ['die'],
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
    b.config.inventories['dice-tray'] = { structure: 'none', scope: 'game', visibility: 'always', countVisibility: 'always', accepts: ['die'] };
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

// ---------------------------------------------------------------------------
// orient
// ---------------------------------------------------------------------------

function makeOrientSession(): GameSession {
  const session = makeSession();
  session.config.gamepieceTypes['tile'] = { category: 'tile', orientationCount: 4, properties: {} };
  session.config.inventories['board'] = {
    structure: 'none', scope: 'game', visibility: 'always', countVisibility: 'always', accepts: ['tile'],
  };
  session.state.gameInventories['board'] = { structure: 'none', pieceIds: ['tile-1'] };
  session.state.gamepieces['tile-1'] = {
    typeId: 'tile', ownerId: 'game', properties: {}, faceUp: true, exhausted: false, visibleTo: null,
  };
  return session;
}

const tileSel = { pieces: { inventory: 'board', select: 'all' } };

describe('executeOrient', () => {
  it('sets piece to a specific orientation index', async () => {
    const session = makeOrientSession();
    await executeOrient(session, makeCtx({ effectDef: { ...tileSel, to: 2 } }));
    expect(session.state.gamepieces['tile-1'].orientationIndex).toBe(2);
  });

  it('rotate-cw increments orientation, wrapping at orientationCount', async () => {
    const session = makeOrientSession();
    session.state.gamepieces['tile-1'].orientationIndex = 3;
    await executeOrient(session, makeCtx({ effectDef: { ...tileSel, to: 'rotate-cw' } }));
    expect(session.state.gamepieces['tile-1'].orientationIndex).toBe(0); // 3+1 mod 4
  });

  it('rotate-ccw decrements orientation, wrapping around 0', async () => {
    const session = makeOrientSession();
    session.state.gamepieces['tile-1'].orientationIndex = 0;
    await executeOrient(session, makeCtx({ effectDef: { ...tileSel, to: 'rotate-ccw' } }));
    expect(session.state.gamepieces['tile-1'].orientationIndex).toBe(3); // 0-1+4 mod 4
  });

  it('rotate-cw on undefined orientationIndex treats current as 0', async () => {
    const session = makeOrientSession();
    // orientationIndex is undefined by default
    await executeOrient(session, makeCtx({ effectDef: { ...tileSel, to: 'rotate-cw' } }));
    expect(session.state.gamepieces['tile-1'].orientationIndex).toBe(1);
  });

  it('direct set wraps if index >= orientationCount', async () => {
    const session = makeOrientSession();
    await executeOrient(session, makeCtx({ effectDef: { ...tileSel, to: 7 } })); // 7 % 4 = 3
    expect(session.state.gamepieces['tile-1'].orientationIndex).toBe(3);
  });

  it('skips pieces whose type has no orientationCount', async () => {
    const session = makeSession();
    await executeOrient(session, makeCtx({
      effectDef: { pieces: { inventory: 'forge', select: 'all' }, to: 'rotate-cw' },
    }));
    expect(session.state.gamepieces['weapon-1'].orientationIndex).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reveal / hide
// ---------------------------------------------------------------------------

describe('executeReveal', () => {
  it('sets visibleTo to "all" when to is "all"', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].visibleTo = null;
    await executeReveal(session, makeCtx({
      effectDef: { pieces: { inventory: 'forge', select: 'all' }, to: 'all' },
    }));
    expect(session.state.gamepieces['weapon-1'].visibleTo).toBe('all');
  });

  it('sets visibleTo to [actorId] when to is "actor"', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].visibleTo = null;
    await executeReveal(session, makeCtx({
      actorId: 'p1',
      effectDef: { pieces: { inventory: 'forge', select: 'all' }, to: 'actor' },
    }));
    expect(session.state.gamepieces['weapon-1'].visibleTo).toEqual(['p1']);
  });

  it('sets visibleTo to all players except actor when to is "opponents"', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].visibleTo = null;
    await executeReveal(session, makeCtx({
      actorId: 'p1',
      effectDef: { pieces: { inventory: 'forge', select: 'all' }, to: 'opponents' },
    }));
    expect(session.state.gamepieces['weapon-1'].visibleTo).toEqual(['p2']);
  });

  it('sets visibleTo to a specific player ID', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].visibleTo = null;
    await executeReveal(session, makeCtx({
      effectDef: { pieces: { inventory: 'forge', select: 'all' }, to: 'p2' },
    }));
    expect(session.state.gamepieces['weapon-1'].visibleTo).toEqual(['p2']);
  });

  it('sets visibleTo to players matching a role when to is "role:<id>"', async () => {
    const session = makeSession();
    session.state.players['p2'].properties['role'] = 'dealer';
    session.state.gamepieces['weapon-1'].visibleTo = null;
    await executeReveal(session, makeCtx({
      effectDef: { pieces: { inventory: 'forge', select: 'all' }, to: 'role:dealer' },
    }));
    expect(session.state.gamepieces['weapon-1'].visibleTo).toEqual(['p2']);
  });
});

describe('executeHide', () => {
  it('sets visibleTo to null, reverting to inventory default', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].visibleTo = 'all';
    await executeHide(session, makeCtx({
      effectDef: { pieces: { inventory: 'forge', select: 'all' } },
    }));
    expect(session.state.gamepieces['weapon-1'].visibleTo).toBeNull();
  });

  it('clears a player-specific reveal', async () => {
    const session = makeSession();
    session.state.gamepieces['weapon-1'].visibleTo = ['p1'];
    await executeHide(session, makeCtx({
      effectDef: { pieces: { inventory: 'forge', select: 'all' } },
    }));
    expect(session.state.gamepieces['weapon-1'].visibleTo).toBeNull();
  });
});
