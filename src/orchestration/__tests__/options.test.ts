import type { GameSession, GameConfig, GameState, CompiledGameModule } from '#chaincraft/types.js';
import type { GameExecutionState, EngineInput } from '#chaincraft/orchestration/types.js';
import { resolveOptions, MAX_NUMBER_OPTIONS } from '#chaincraft/orchestration/options.js';
import { hasCompletion, pruneDeadEnds } from '#chaincraft/orchestration/input-completion.js';
import { inputOptions } from "#chaincraft/orchestration/input-check.js";
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
  dependsOn: ['defenderOwner'],
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

describe("resolveOptions — number", () => {
  const numberOptions = (type: Partial<{ min: number; max: number; integer: boolean }>) =>
    resolveOptions(makeExecState(), { id: "n", type: { kind: "number", ...type } }, "p1", {});

  it("lists every whole number in a bounded range", () => {
    expect(numberOptions({ min: 1, max: 6 })).toEqual([1, 2, 3, 4, 5, 6]);
    expect(numberOptions({ min: 0, max: 0 })).toEqual([0]);
  });

  it("lists only the whole numbers inside fractional bounds", () => {
    expect(numberOptions({ min: 0.5, max: 3.2 })).toEqual([1, 2, 3]);
  });

  it("lists a range of exactly MAX_NUMBER_OPTIONS values", () => {
    expect(numberOptions({ min: 1, max: MAX_NUMBER_OPTIONS })).toHaveLength(MAX_NUMBER_OPTIONS);
  });

  it("has no list when the range is too wide, unbounded, or fractional", () => {
    expect(numberOptions({ min: 1, max: MAX_NUMBER_OPTIONS + 1 })).toBeUndefined();
    expect(numberOptions({ min: 1 })).toBeUndefined();
    expect(numberOptions({ max: 6 })).toBeUndefined();
    expect(numberOptions({ min: 1, max: 6, integer: false })).toBeUndefined();
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

  it("looks ahead only through declared dependsOn", () => {
    const state = makeExecState({ p1: ["a1"], p2: [], p3: ["c1"] });
    const { dependsOn: _dependsOn, ...undeclared } = defenderInput as typeof defenderInput & {
      dependsOn?: string[];
    };
    expect(
      pruneDeadEnds(state, defenderOwnerInput, ["p2", "p3"], [undeclared], "p1", { attacker: "a1" }, resolveOptions),
    ).toEqual(["p2", "p3"]);
  });

  it('does not offer an action whose dependent input has no answer', () => {
    const module = {
      actions: {
        attack: { id: 'attack', segments: [{ inputs: attackInputs, effects: [] }] },
        wait: { id: 'wait', segments: [{ inputs: [], effects: [] }] },
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

describe("inputOptions", () => {
  it("resolves and prunes dead ends against later inputs", () => {
    const state = makeExecState({ p1: ["a1"], p2: [], p3: ["c1"] });
    expect(
      inputOptions(state, defenderOwnerInput, "p1", { attacker: "a1" }, [defenderInput], resolveOptions),
    ).toEqual(["p3"]);
  });

  it("returns undefined for inputs with no finite list", () => {
    const stringInput: EngineInput = { id: "s", type: { kind: "string" } };
    expect(inputOptions(makeExecState(), stringInput, "p1", {}, [], resolveOptions)).toBeUndefined();
  });
});

describe("filters and validation read earlier answers", () => {
  it("passes collected answers to a gamepiece selection's validation", () => {
    const otherCreature: EngineInput = {
      id: "defender",
      type: {
        kind: "gamepiece-select",
        inventory: "field",
        fromPlayer: "self",
      },
      validate: (_session, _actorId, inputs) => inputs.defender !== inputs.attacker,
      dependsOn: ["attacker"],
    };
    expect(resolveOptions(makeExecState(), otherCreature, "p1", { attacker: "a1" })).toEqual(["a2"]);
  });

  // Liar's Dice: the bid rule lives on faceValue and reads the earlier quantity.
  const quantityInput: EngineInput = { id: "quantity", type: { kind: "number", min: 1, max: 30 } };
  const faceValueInput: EngineInput = {
    id: "faceValue",
    type: { kind: "number", min: 1, max: 6 },
    dependsOn: ["quantity"],
    validate: (session, _actorId, inputs) => {
      const { bidQuantity, bidFace } = session.state.gameProperties as Record<string, number>;
      const quantity = inputs.quantity as number;
      const face = inputs.faceValue as number;
      return quantity > bidQuantity || (quantity === bidQuantity && face > bidFace);
    },
  };
  const range = (low: number, high: number) =>
    Array.from({ length: high - low + 1 }, (_, i) => low + i);

  function bidState(bidQuantity: number, bidFace: number): GameExecutionState {
    const state = makeExecState();
    state.session.state.gameProperties = { bidQuantity, bidFace };
    return state;
  }

  it("filters a listed input's options by its validation", () => {
    expect(resolveOptions(bidState(5, 3), faceValueInput, "p1", { quantity: 5 })).toEqual([4, 5, 6]);
    expect(resolveOptions(bidState(5, 3), faceValueInput, "p1", { quantity: 6 })).toEqual(range(1, 6));
  });

  it("prunes quantities that leave no legal face value", () => {
    expect(
      inputOptions(bidState(5, 6), quantityInput, "p1", {}, [faceValueInput], resolveOptions),
    ).toEqual(range(6, 30));
    expect(
      inputOptions(bidState(5, 3), quantityInput, "p1", {}, [faceValueInput], resolveOptions),
    ).toEqual(range(5, 30));
  });

  it("finds no complete bid above 30 x sixes", () => {
    expect(hasCompletion(bidState(30, 6), [quantityInput, faceValueInput], "p1", {}, resolveOptions)).toBe(false);
    expect(hasCompletion(bidState(30, 5), [quantityInput, faceValueInput], "p1", {}, resolveOptions)).toBe(true);
  });
});
