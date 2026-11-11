import type { ActionDef, CompiledGameModule, FlowNode, GameSession } from "#chaincraft/types.js";
import type { GameExecutionDeps, GameExecutionState } from "#chaincraft/orchestration/types.js";
import { step } from "#chaincraft/orchestration/game-step.js";
import { createFlowRunner } from "#chaincraft/orchestration/flow-runner.js";
import { resolveOptions } from "#chaincraft/orchestration/options.js";
import { StepBudgetExceededError } from "#chaincraft/orchestration/errors.js";
import { createSeededRng } from "#chaincraft/rng/seeded.js";
import { GameEventEmitter } from "#chaincraft/events/emitter.js";

const PLAYERS = ["p1", "p2"];

function makeSession(): GameSession {
  return {
    gameId: "test-game",
    specId: "test-spec",
    config: {
      inventories: {},
      gamepieceTypes: {},
      gameProperties: {},
      playerProperties: {},
      playerCount: { min: 2, max: 2 },
    },
    state: {
      gameProperties: {},
      gameInventories: {},
      players: Object.fromEntries(PLAYERS.map((p) => [p, { roles: [], properties: {}, inventories: {} }])),
      gamepieces: {},
    },
    players: PLAYERS,
    outbox: [],
    rng: createSeededRng(42),
    events: new GameEventEmitter(),
    _inventoryCache: new Map(),
  };
}

function makeDeps(flow: FlowNode, maxStepWork?: number): GameExecutionDeps {
  const module: CompiledGameModule = {
    specId: "test-spec",
    metadata: { name: "test", playerCount: { min: 2, max: 2 } },
    createSession: () => makeSession(),
    flow,
    effects: {
      noop: { kind: "effect-executor", execute: async () => {} },
    },
    effectDefs: {},
    actions: {} as Record<string, ActionDef>,
  };
  return {
    module,
    advanceFlow: createFlowRunner(module),
    resolveOptions,
    ...(maxStepWork !== undefined && { maxStepWork }),
  };
}

function makeState(): GameExecutionState {
  return { session: makeSession(), queue: [], pending: undefined, flowStack: [], playerTurns: undefined, turn: undefined };
}

describe("step work budget", () => {
  it("throws with the loop's node id when a loop never prompts and never ends", async () => {
    const flow: FlowNode = {
      kind: "loop",
      id: "spin",
      label: "spin",
      endCondition: () => false,
      hooks: { onEnter: [{ kind: "noop" }] },
      children: [],
    };
    const error = await step(makeState(), undefined, makeDeps(flow)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StepBudgetExceededError);
    expect(error).toMatchObject({ nodeId: "spin", limit: 10_000 });
  });

  it("honors maxStepWork", async () => {
    const flow: FlowNode = {
      kind: "loop",
      id: "big",
      label: "big",
      count: 1000,
      hooks: { onEnter: [{ kind: "noop" }] },
      children: [],
    };
    await expect(step(makeState(), undefined, makeDeps(flow, 50))).rejects.toMatchObject({
      nodeId: "big",
      limit: 50,
    });
  });

  it("does not fire on a legitimately large non-prompting flow", async () => {
    const flow: FlowNode = {
      kind: "loop",
      id: "big",
      label: "big",
      count: 1000,
      hooks: { onEnter: [{ kind: "noop" }] },
      children: [],
    };
    const result = await step(makeState(), undefined, makeDeps(flow));
    expect(result.kind).toBe("complete");
  });
});
