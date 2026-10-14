// ---------------------------------------------------------------------------
// Response sequences — a player answers their pending prompt plus the prompts
// that would follow within the same action, in one all-or-nothing submission.
// ---------------------------------------------------------------------------

import type { ActionDef, CompiledGameModule, FlowNode } from "#chaincraft/types.js";
import type { CollectedInputs, PlayerInputSuspension } from "#chaincraft/orchestration/types.js";
import { GameController } from "#chaincraft/api/game-controller.js";
import { IllegalActionError } from "#chaincraft/orchestration/errors.js";
import { createHighCardModule } from "../fixtures/high-card.js";

const PLAYERS = ["alice", "bob"];

/** Face must beat 3 unless the quantity is above 2. */
const bid: ActionDef = {
  id: "bid",
  label: "Bid",
  description: "Two dependent number inputs.",
  inputs: [
    { id: "quantity", type: { kind: "number", min: 1, max: 5 } },
    {
      id: "face",
      type: { kind: "number", min: 1, max: 6 },
      dependsOn: ["quantity"],
      validate: (_session, _actorId, inputs) =>
        (inputs.quantity as number) > 2 || (inputs.face as number) > 3,
      validationMessage: "Bid a higher face",
    },
  ],
  effects: [{ kind: "record" }],
};

/** High Card whose turn offers a choice of playCard or bid (or pass). */
function choiceModule(recorded: CollectedInputs[]): CompiledGameModule {
  const base = createHighCardModule();
  const game = base.flow as Extract<FlowNode, { kind: "game" }>;
  const loop = game.children[0] as Extract<FlowNode, { kind: "loop" }>;
  const turn = loop.children[0] as Extract<FlowNode, { kind: "turn" }>;
  return {
    ...base,
    actions: { ...base.actions, bid },
    effects: {
      ...base.effects,
      record: {
        kind: "effect-executor",
        execute: async (_session, ctx) => {
          recorded.push({ ...ctx.actionInputs });
        },
      },
    },
    flow: {
      ...game,
      children: [
        {
          ...loop,
          children: [
            { ...turn, grammar: { kind: "choice", actions: ["playCard", "bid"], passable: true } },
          ],
        },
      ],
    },
  };
}

async function started() {
  const recorded: CollectedInputs[] = [];
  const events: string[] = [];
  const prompts: PlayerInputSuspension[] = [];
  const controller = new GameController(choiceModule(recorded), {
    events: {
      onStateChange: () => events.push("state-change"),
      onMessage: () => events.push("message"),
      onPrompt: (p) => {
        events.push(`prompt:${p.awaiting}:${p.input.id}`);
        prompts.push(p);
      },
      onTurnStart: () => events.push("turn-start"),
      onTurnEnd: () => events.push("turn-end"),
    },
  });
  await controller.init("seq", PLAYERS);
  events.length = 0;
  prompts.length = 0;
  return { controller, recorded, events, prompts };
}

const act = (actionId: string) => ({ kind: "act", actionId });

describe("GameController.processResponses — valid sequences", () => {
  it("applies a complete sequence from action-select and reports only the final prompt", async () => {
    const { controller, recorded, events } = await started();

    await controller.processResponses("alice", [act("bid"), 3, 1]);

    expect(recorded).toEqual([{ quantity: 3, face: 1 }]);
    expect(controller.promptFor("alice")).toBeUndefined();
    expect(events.filter((e) => e.startsWith("prompt"))).toEqual(["prompt:bob:__action-select__"]);
  });

  it("stops at the next prompt for a partial sequence, with validation applied to its options", async () => {
    const { controller, recorded, events } = await started();

    await controller.processResponses("alice", [act("bid"), 1]);

    expect(recorded).toEqual([]);
    const next = controller.promptFor("alice")!;
    expect(next.input.id).toBe("face");
    expect(next.options).toEqual([4, 5, 6]);
    expect(events).toEqual(["prompt:alice:face"]);
  });

  it("continues a sequence anchored at a mid-action prompt", async () => {
    const { controller, recorded } = await started();
    await controller.processResponses("alice", [act("bid"), 1]);

    await controller.processResponses("alice", [5]);

    expect(recorded).toEqual([{ quantity: 1, face: 5 }]);
  });

  it("plays a card chosen in the same submission as the action", async () => {
    const { controller } = await started();
    const hand = controller.getState().players.alice.inventories.hand;
    const card = ("pieceIds" in hand ? hand.pieceIds : [])[0];

    await controller.processResponses("alice", [act("playCard"), card]);

    const table = controller.getState().gameInventories.table;
    expect("pieceIds" in table && table.pieceIds).toEqual([card]);
  });
});

describe("GameController.processResponses — illegal sequences change nothing", () => {
  async function expectRejected(
    responses: unknown[],
    expected: { index: number; inputId?: string; validationMessage?: string },
    setup?: (controller: GameController) => Promise<void>,
  ) {
    const { controller, recorded, events } = await started();
    await setup?.(controller);
    events.length = 0;
    const prompt = controller.promptFor("alice");
    const before = controller.getState();

    const rejected = controller.processResponses("alice", responses);
    await expect(rejected).rejects.toBeInstanceOf(IllegalActionError);
    await expect(rejected).rejects.toMatchObject({
      index: expected.index,
      inputId: expected.inputId,
      validationMessage: expected.validationMessage,
    });

    expect(events).toEqual([]);
    expect(recorded).toEqual([]);
    expect(controller.getState()).toEqual(before);
    expect(controller.promptFor("alice")).toBe(prompt);
  }

  it("rejects an action that was not offered", async () => {
    await expectRejected([act("steal"), 3], { index: 0 });
  });

  it("rejects a later answer that fails validation, with its message", async () => {
    await expectRejected([act("bid"), 1, 2], {
      index: 2,
      inputId: "face",
      validationMessage: "Bid a higher face",
    });
  });

  it("rejects a later answer outside its options", async () => {
    await expectRejected([act("bid"), 9, 1], { index: 1, inputId: "quantity" });
  });

  it("rejects answers after the action is complete", async () => {
    await expectRejected([act("bid"), 3, 1, 4], { index: 3 });
  });

  it("rejects answers after a pass", async () => {
    await expectRejected([{ kind: "pass" }, 3], { index: 1 });
  });

  it("rejects an empty submission", async () => {
    await expectRejected([], { index: 0 });
  });

  it("rejects a bad answer to a mid-action prompt, leaving that prompt pending", async () => {
    await expectRejected([2], { index: 0, inputId: "face", validationMessage: "Bid a higher face" }, (c) =>
      c.processResponses("alice", [act("bid"), 1]),
    );
  });

  it("can retry the same prompt after a rejection", async () => {
    const { controller, recorded } = await started();
    await expect(controller.processResponses("alice", [act("bid"), 1, 2])).rejects.toBeInstanceOf(
      IllegalActionError,
    );

    await controller.processResponses("alice", [act("bid"), 1, 4]);

    expect(recorded).toEqual([{ quantity: 1, face: 4 }]);
  });
});

describe("GameController.queryResponses", () => {
  it("predicts the next prompt of a partial sequence, with its options", async () => {
    const { controller } = await started();

    const result = controller.queryResponses("alice", [act("bid"), 1]);

    expect(result).toEqual({
      kind: "ok",
      next: { input: bid.inputs[1], options: [4, 5, 6] },
    });
  });

  it("reports a complete sequence", async () => {
    const { controller } = await started();

    expect(controller.queryResponses("alice", [act("bid"), 3, 1])).toEqual({
      kind: "ok",
      next: "complete",
    });
  });

  it("reports the rejected answer as processResponses would", async () => {
    const { controller } = await started();

    expect(controller.queryResponses("alice", [act("bid"), 1, 2])).toEqual({
      kind: "illegal",
      index: 2,
      inputId: "face",
      reason: expect.any(String),
      message: "Bid a higher face",
    });
  });

  it("changes nothing and fires no events", async () => {
    const { controller, recorded, events } = await started();
    const prompt = controller.promptFor("alice");
    const before = controller.getState();

    controller.queryResponses("alice", [act("bid"), 3, 1]);
    controller.queryResponses("alice", [act("bid"), 1]);
    controller.queryResponses("alice", [act("steal")]);

    expect(events).toEqual([]);
    expect(recorded).toEqual([]);
    expect(controller.getState()).toEqual(before);
    expect(controller.promptFor("alice")).toBe(prompt);
  });

  it("answers from a mid-action prompt", async () => {
    const { controller } = await started();
    await controller.processResponses("alice", [act("bid"), 1]);

    expect(controller.queryResponses("alice", [5])).toEqual({ kind: "ok", next: "complete" });
  });

  it("throws for a player with no pending prompt", async () => {
    const { controller } = await started();

    expect(() => controller.queryResponses("bob", [act("bid")])).toThrow(
      'No prompt is awaiting player "bob"',
    );
  });
});

describe("GameController.processResponses — walk/execution agreement", () => {
  it("fails loudly when execution stops at a different prompt than the walk predicted", async () => {
    // A rule that flips once the engine resolves an answer: the walk sees one option list,
    // execution another. Real rules only read state, so this models an engine divergence.
    let resolvedAnswer = false;
    const module = choiceModule([]);
    const inconsistentBid: ActionDef = {
      ...bid,
      inputs: [
        bid.inputs[0],
        {
          ...bid.inputs[1],
          validate: (_s, _a, inputs) =>
            resolvedAnswer ? (inputs.face as number) <= 3 : (inputs.face as number) > 3,
        },
      ],
    };
    const createSession = module.createSession;
    const controller = new GameController(
      {
        ...module,
        actions: { ...module.actions, bid: inconsistentBid },
        createSession: (gameId, players) => {
          const session = createSession(gameId, players);
          session.events.on("input:resolve", () => (resolvedAnswer = true));
          return session;
        },
      },
      {},
    );
    await controller.init("diverge", PLAYERS);

    await expect(controller.processResponses("alice", [act("bid"), 1])).rejects.toThrow(
      /walkResponses predicted prompt "face" for "alice" but execution produced "face" with different options/,
    );
  });
});
