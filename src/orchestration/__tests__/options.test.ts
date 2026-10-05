import type { GameSession, GameConfig, GameState, CompiledGameModule } from '#chaincraft/types.js';
import type { GameExecutionState, EngineInput } from '#chaincraft/orchestration/types.js';
import { resolveOptions } from '#chaincraft/orchestration/options.js';
import { hasCompletion, pruneDeadEnds } from '#chaincraft/orchestration/input-completion.js';
import { nextPlayerTurnWork } from '#chaincraft/orchestration/player-effects-resolver.js';
import { createSeededRng } from '#chaincraft/rng/seeded.js';
import { GameEventEmitter } from '#chaincraft/events/emitter.js';

function makeConfig(): GameConfig {
  return {
    inventories: {
      field: { structure: 'none', scope: 'player', visibility: 'always', countVisibility: 'always', accepts: ['creature'] },
      'game:unassigned': { structure: 'none', scope: 'game', visibility: 'never', countVisibility: 'never', accepts: ['creature'] },
    },
    gamepieceTypes: {
      creature: { category: 'card', properties: {} },
    },
    gameProperties: {},
    playerProperties: {},
    playerCount: { min: 2, max: 2 },
  };
}

function makeState(fields: Record<string, string[]>): GameState {
  const creature = (ownerId: string) => ({
    typeId: 'creature', ownerId, properties: {}, faceUp: true, exhausted: false, visibleTo: null,
  });
  const players: GameState['players'] = {};
  const gamepieces: GameState['gamepieces'] = {};
  for (const [playerId, pieceIds] of Object.entries(fields)) {
    players[playerId] = { roles: [], properties: {}, inventories: { field: { structure: 'none', pieceIds } } };
    for (const id of pieceIds) gamepieces[id] = creature(playerId);
  }
  return {
    gameProperties: {},
    gameInventories: {
      'game:unassigned': { structure: 'none', pieceIds: [] },
    },
    players,
    gamepieces,
  };
}

function makeExecState(
  fields: Record<string, string[]> = { p1: ['a1', 'a2'], p2: ['b1'] },
): GameExecutionState {
  const session: GameSession = {
    gameId: 'test-game',
    specId: 'test-spec',
    config: makeConfig(),
    state: makeState(fields),
    players: Object.keys(fields),
    outbox: [],
    rng: createSeededRng(42),
    events: new GameEventEmitter(),
    _inventoryCache: new Map(),
  };
  return { session } as GameExecutionState;
}

const defenderInput: EngineInput = {
  id: 'defender',
  type: {
    kind: 'gamepiece-select',
    inventory: 'field',
    ofType: 'creature',
    fromPlayer: { param: 'defenderOwner' },
  },
};

describe('resolveOptions — gamepiece-select fromPlayer', () => {
  it('self resolves against the actor', () => {
    const input: EngineInput = {
      id: 'attacker',
      type: { kind: 'gamepiece-select', inventory: 'field', fromPlayer: 'self' },
    };
    expect(resolveOptions(makeExecState(), input, 'p1', {})).toEqual(['a1', 'a2']);
  });

  it('{ param } resolves against the player chosen by the earlier input', () => {
    const options = resolveOptions(makeExecState(), defenderInput, 'p1', { defenderOwner: 'p2' });
    expect(options).toEqual(['b1']);
  });

  it('{ param } throws when the referenced input has not been collected', () => {
    expect(() => resolveOptions(makeExecState(), defenderInput, 'p1', {})).toThrow(/defenderOwner/);
  });

  it('{ param } throws when the referenced value is not a player', () => {
    expect(() =>
      resolveOptions(makeExecState(), defenderInput, 'p1', { defenderOwner: 'nobody' }),
    ).toThrow(/defenderOwner/);
  });
});

// Shape of board-battler's attackCreature / castFreeze inputs.
const attackerInput: EngineInput = {
  id: 'attacker',
  type: { kind: 'gamepiece-select', inventory: 'field', ofType: 'creature', fromPlayer: 'self' },
};
const defenderOwnerInput: EngineInput = {
  id: 'defenderOwner',
  type: { kind: 'player-select', excludeSelf: true },
};
const attackInputs = [attackerInput, defenderOwnerInput, defenderInput];

describe('input look-ahead', () => {
  it('has a completion when the opponent has a creature', () => {
    expect(hasCompletion(makeExecState(), attackInputs, 'p1', {}, resolveOptions)).toBe(true);
  });

  it('has no completion when only the actor has creatures', () => {
    const state = makeExecState({ p1: ['a1'], p2: [] });
    expect(hasCompletion(state, attackInputs, 'p1', {}, resolveOptions)).toBe(false);
  });

  it('has no completion when the actor has no creatures', () => {
    const state = makeExecState({ p1: [], p2: ['b1'] });
    expect(hasCompletion(state, attackInputs, 'p1', {}, resolveOptions)).toBe(false);
  });

  it('prunes opponents whose field has no valid target', () => {
    const state = makeExecState({ p1: ['a1'], p2: [], p3: ['c1'] });
    const options = resolveOptions(state, defenderOwnerInput, 'p1', { attacker: 'a1' })!;
    expect(options).toEqual(['p2', 'p3']);
    expect(
      pruneDeadEnds(state, defenderOwnerInput, options, [defenderInput], 'p1', { attacker: 'a1' }, resolveOptions),
    ).toEqual(['p3']);
  });

  it('does not offer an action whose dependent input has no answer', () => {
    const module = {
      actions: {
        attack: { id: 'attack', inputs: attackInputs, effects: [] },
        wait: { id: 'wait', inputs: [], effects: [] },
      },
    } as unknown as CompiledGameModule;
    const signal = nextPlayerTurnWork(
      'p1',
      { sequenceIndex: 0, repeatCount: 0, done: false },
      { kind: 'choice', actions: ['attack', 'wait'], passable: true },
      makeExecState({ p1: ['a1'], p2: [] }),
      module,
    );
    expect(signal.kind).toBe('suspend');
    const type = (signal as Extract<typeof signal, { kind: 'suspend' }>).suspension.input.type;
    expect(type).toEqual({ kind: 'action-select', actions: ['wait'], canPass: true });
  });
});
