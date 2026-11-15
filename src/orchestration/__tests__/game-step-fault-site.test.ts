import type { ActionDef, CompiledGameModule, FlowNode, GameSession } from "#chaincraft/types.js";
import type { GameExecutionDeps, GameExecutionState } from "#chaincraft/orchestration/types.js";
import { step } from "#chaincraft/orchestration/game-step.js";
import { createFlowRunner } from "#chaincraft/orchestration/flow-runner.js";
import { resolveOptions } from "#chaincraft/orchestration/options.js";
import { GameRuntimeError } from "#chaincraft/errors.js";
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

function makeState(): GameExecutionState {
  return { session: makeSession(), queue: [], pending: undefined, flowStack: [], playerTurns: undefined, turn: undefined };
}

function action(id: string, effects: Record<string, unknown>[]): ActionDef {
  return { id, label: id, description: id, segments: [{ inputs: [], effects }] };
}

function makeDeps(flow: FlowNode, actions: Record<string, ActionDef>): GameExecutionDeps {
  const module: CompiledGameModule = {
    specId: "test-spec",
    metadata: { name: "test", playerCount: { min: 2, max: 2 } },
    createSession: () => makeSession(),
    flow,
    effects: {
      "spec-fault": {
        kind: "effect-executor",
        execute: async () => {
          throw new GameRuntimeError("expression-invalid", "bad expression");
        },
      },
      "type-error": {
        kind: "effect-executor",
        execute: async () => {
          throw new TypeError("not a runtime fault");
        },
      },
    },
    effectDefs: { named: { kind: "spec-fault" } },
    actions,
  };
  return { module, advanceFlow: createFlowRunner(module), resolveOptions };
}

function turnFlow(actionId: string): FlowNode {
  return {
    kind: "turn",
    id: "the-turn",
    label: "the turn",
    ordering: { kind: "round-robin" },
    grammar: { kind: "action", ref: actionId },
  };
}

const run = (deps: GameExecutionDeps) => step(makeState(), undefined, deps).catch((e: unknown) => e);

describe("fault site", () => {
  it("records the action and turn node for an inline action effect", async () => {
    const deps = makeDeps(turnFlow("boom"), { boom: action("boom", [{ kind: "spec-fault" }]) });
    const error = await run(deps);
    expect(error).toBeInstanceOf(GameRuntimeError);
    expect((error as GameRuntimeError).site).toEqual({ actionId: "boom", nodeId: "the-turn" });
  });

  it("records the named ref of a bare { ref } action step", async () => {
    const deps = makeDeps(turnFlow("boom"), { boom: action("boom", [{ ref: "named" }]) });
    const error = await run(deps);
    expect((error as GameRuntimeError).site).toEqual({
      actionId: "boom",
      effectRef: "named",
      nodeId: "the-turn",
    });
  });

  it("records only the node for a hook effect", async () => {
    const flow: FlowNode = {
      kind: "loop",
      id: "root",
      label: "root",
      count: 1,
      hooks: { onEnter: [{ kind: "spec-fault" }] },
      children: [],
    };
    const error = await run(makeDeps(flow, {}));
    const site = (error as GameRuntimeError).site;
    expect(site).toEqual({ nodeId: "root" });
    expect(site).not.toHaveProperty("actionId");
  });

  it("leaves a non-GameRuntimeError untouched", async () => {
    const deps = makeDeps(turnFlow("boom"), { boom: action("boom", [{ kind: "type-error" }]) });
    const error = await run(deps);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toHaveProperty("site");
  });
});
