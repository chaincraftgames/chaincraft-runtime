// ---------------------------------------------------------------------------
// Response sequences — a player answers their pending prompt plus the prompts
// that would follow within the same action, in one all-or-nothing submission.
// ---------------------------------------------------------------------------

import type { ActionDef, CompiledGameModule, FlowNode } from "#chaincraft/types.js";
import type { CollectedInputs, PlayerInputSuspension } from "#chaincraft/orchestration/types.js";
import { GameController } from "#chaincraft/api/game-controller.js";
import { IllegalActionError, UndoNotAllowedError } from "#chaincraft/orchestration/errors.js";
import { createHighCardModule } from "../fixtures/high-card.js";

const PLAYERS = ["alice", "bob"];

/** Face must beat 3 unless the quantity is above 2. */
const bid: ActionDef = {
  id: "bid",
  label: "Bid",
  description: "Two dependent number inputs.",
  segments: [
    {
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
    },
  ],
};

const handSelect = {
  kind: "gamepiece-select",
  inventory: "hand",
  ofType: "card",
  fromPlayer: "self",
} as const;

const moveParam = (param: string, inventory: string) =>
  ({
    kind: "move",
    from: { inventory: "hand", select: { id: { param } } },
    to: { inventory },
  }) as const;

/** Two segments: keep a card (moved to the table), then discard another from the remaining hand. */
const keepThenDiscard: ActionDef = {
  id: "keepThenDiscard",
  label: "Keep then discard",
  description: "The discard options depend on the keep effect having run.",
  segments: [
    { inputs: [{ id: "keep", type: handSelect }], effects: [moveParam("keep", "table")] },
    { inputs: [{ id: "discard", type: handSelect }], effects: [moveParam("discard", "discard")] },
  ],
};

/** Like keepThenDiscard, plus a third segment that can never be answered (empty deck). */
const keepDiscardPick: ActionDef = {
  id: "keepDiscardPick",
  label: "Keep, discard, pick",
  description: "Later segments depend on earlier answers but are not looked ahead across.",
  segments: [
    { inputs: [{ id: "keep", type: handSelect }], effects: [moveParam("keep", "table")] },
    {
      inputs: [{ id: "discard", type: handSelect, dependsOn: ["keep"] }],
      effects: [moveParam("discard", "discard")],
    },
    {
      inputs: [
        {
          id: "pick",
          type: { kind: "gamepiece-select", inventory: "deck", ofType: "card" },
          dependsOn: ["discard"],
        },
      ],
      effects: [{ kind: "record" }],
    },
  ],
};

type TurnNode = Extract<FlowNode, { kind: "turn" }>;

const distinct =
  (ids: string[]) =>
  (_session: unknown, _actorId: unknown, inputs: CollectedInputs): boolean =>
    new Set(ids.map((id) => inputs[id])).size === ids.length;

/** Three pairwise-distinct numbers in 1..3, one segment. */
const triple: ActionDef = {
  id: "triple",
  label: "Triple",
  description: "Each answer narrows the options of the next.",
  segments: [
    {
      inputs: [
        { id: "a", type: { kind: "number", min: 1, max: 3 } },
        { id: "b", type: { kind: "number", min: 1, max: 3 }, dependsOn: ["a"], validate: distinct(["a", "b"]) },
        {
          id: "c",
          type: { kind: "number", min: 1, max: 3 },
          dependsOn: ["a", "b"],
          validate: distinct(["a", "b", "c"]),
        },
      ],
      effects: [{ kind: "record" }],
    },
  ],
};

/** High Card whose turn offers a choice of playCard or the given actions (or pass). */
function choiceModule(
  recorded: CollectedInputs[],
  actions: Record<string, ActionDef> = { bid },
  turnOverrides: Partial<TurnNode> = {},
): CompiledGameModule {
  const base = createHighCardModule();
  const game = base.flow as Extract<FlowNode, { kind: "game" }>;
  const loop = game.children[0] as Extract<FlowNode, { kind: "loop" }>;
  const turn = loop.children[0] as TurnNode;
  return {
    ...base,
    actions: { ...base.actions, ...actions },
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
            {
              ...turn,
              grammar: { kind: "choice", actions: ["playCard", ...Object.keys(actions)], passable: true },
              ...turnOverrides,
            },
          ],
        },
      ],
    },
  };
}

async function started(actions?: Record<string, ActionDef>, turnOverrides?: Partial<TurnNode>) {
  const recorded: CollectedInputs[] = [];
  const events: string[] = [];
  const prompts: PlayerInputSuspension[] = [];
  const controller = new GameController(choiceModule(recorded, actions, turnOverrides), {
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
      next: { input: bid.segments[0].inputs[1], options: [4, 5, 6] },
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

describe("multi-segment actions", () => {
  const handOf = (controller: GameController, playerId: string): string[] => {
    const hand = controller.getState().players[playerId].inventories.hand;
    return "pieceIds" in hand ? [...hand.pieceIds] : [];
  };
  const piecesIn = (controller: GameController, inventory: string): string[] => {
    const inv = controller.getState().gameInventories[inventory];
    return "pieceIds" in inv ? [...inv.pieceIds] : [];
  };
  const sorted = (ids: unknown): string[] => [...(ids as string[])].sort();

  it("walks to the segment boundary, then prompts the next segment against post-effect state", async () => {
    const { controller } = await started({ keepThenDiscard });
    const [a, b, c] = handOf(controller, "alice");

    expect(controller.queryResponses("alice", [act("keepThenDiscard"), a])).toEqual({
      kind: "ok",
      next: "boundary",
    });

    await controller.processResponses("alice", [act("keepThenDiscard"), a]);

    expect(piecesIn(controller, "table")).toEqual([a]);
    const prompt = controller.promptFor("alice")!;
    expect(prompt.input.id).toBe("discard");
    expect(sorted(prompt.options)).toEqual(sorted([b, c]));
    expect(controller.queryResponses("alice", [b])).toEqual({ kind: "ok", next: "complete" });

    await controller.processResponses("alice", [b]);

    expect(piecesIn(controller, "discard")).toEqual([b]);
    expect(controller.promptFor("alice")).toBeUndefined();
  });

  it("rejects responses past the boundary without changing anything", async () => {
    const { controller, events } = await started({ keepThenDiscard });
    const [a, b] = handOf(controller, "alice");
    const prompt = controller.promptFor("alice");
    const before = controller.getState();

    const rejected = controller.processResponses("alice", [act("keepThenDiscard"), a, b]);
    await expect(rejected).rejects.toBeInstanceOf(IllegalActionError);
    await expect(rejected).rejects.toMatchObject({ index: 2 });
    await expect(rejected).rejects.toThrow(/can only be answered after the action's effects run/);

    expect(events).toEqual([]);
    expect(controller.getState()).toEqual(before);
    expect(controller.promptFor("alice")).toBe(prompt);
  });

  it("does not look ahead across segments when offering or prompting", async () => {
    const { controller } = await started({ keepDiscardPick });
    const hand = handOf(controller, "alice");
    const [a, b, c] = hand;

    await controller.processResponses("alice", [act("keepDiscardPick")]);
    const keepPrompt = controller.promptFor("alice")!;
    expect(keepPrompt.input.id).toBe("keep");
    expect(sorted(keepPrompt.options)).toEqual(sorted(hand));

    await controller.processResponses("alice", [a]);
    const discardPrompt = controller.promptFor("alice")!;
    expect(discardPrompt.input.id).toBe("discard");
    expect(sorted(discardPrompt.options)).toEqual(sorted([b, c]));
  });

  it("reports a boundary from a mid-action prompt and rejects answers past it", async () => {
    const { controller } = await started({ keepDiscardPick });
    const [a, b, c] = handOf(controller, "alice");
    await controller.processResponses("alice", [act("keepDiscardPick"), a]);

    expect(controller.queryResponses("alice", [b])).toEqual({ kind: "ok", next: "boundary" });
    expect(controller.queryResponses("alice", [b, c])).toEqual({
      kind: "illegal",
      index: 1,
      reason: "the remaining inputs can only be answered after the action's effects run",
    });
  });
});

describe("multi-segment actions — forfeit", () => {
  it("forfeits when a later segment's input has no valid answer after earlier effects ran", async () => {
    const recorded: CollectedInputs[] = [];
    const forfeits: unknown[] = [];
    const events: string[] = [];
    const controller = new GameController(choiceModule(recorded, { keepDiscardPick }), {
      events: {
        onActionForfeit: (f) => {
          forfeits.push(f);
          events.push("forfeit");
        },
        onStateChange: () => events.push("state-change"),
        onPrompt: (p) => events.push(`prompt:${p.awaiting}:${p.input.id}`),
      },
    });
    await controller.init("forfeit", PLAYERS);
    const hand = controller.getState().players.alice.inventories.hand;
    const [a, b] = "pieceIds" in hand ? hand.pieceIds : [];
    events.length = 0;

    await controller.processResponses("alice", [act("keepDiscardPick"), a]);
    await controller.processResponses("alice", [b]);

    expect(forfeits).toEqual([{ playerId: "alice", actionId: "keepDiscardPick", inputId: "pick" }]);
    const inventory = (id: string) => {
      const inv = controller.getState().gameInventories[id];
      return "pieceIds" in inv ? [...inv.pieceIds] : [];
    };
    expect(inventory("table")).toEqual([a]);
    expect(inventory("discard")).toEqual([b]);
    expect(recorded).toEqual([]);
    expect(controller.promptFor("alice")).toBeUndefined();
    expect(controller.promptFor("bob")?.input.id).toBe("__action-select__");
    expect(events).toEqual([
      "state-change",
      "prompt:alice:discard",
      "state-change",
      "forfeit",
      "prompt:bob:__action-select__",
    ]);
  });
});

describe("GameController.undo", () => {
  it("re-prompts the segment's answers last-first, then returns to the action choice", async () => {
    const { controller, recorded, events } = await started({ triple });
    await controller.processResponses("alice", [act("triple"), 1, 2]);
    expect(controller.promptFor("alice")?.options).toEqual([3]);
    expect(controller.canUndo("alice")).toBe(true);
    events.length = 0;

    await controller.undo("alice");
    expect(controller.promptFor("alice")?.input.id).toBe("b");
    expect(controller.promptFor("alice")?.options).toEqual([2, 3]);
    expect(events).toEqual(["prompt:alice:b"]);
    expect(controller.queryResponses("alice", [3])).toEqual({
      kind: "ok",
      next: { input: triple.segments[0].inputs[2], options: [2] },
    });

    await controller.undo("alice");
    expect(controller.promptFor("alice")?.input.id).toBe("a");
    expect(controller.promptFor("alice")?.options).toEqual([1, 2, 3]);
    expect(controller.canUndo("alice")).toBe(true);

    await controller.undo("alice");
    expect(controller.promptFor("alice")?.input.id).toBe("__action-select__");
    expect(controller.canUndo("alice")).toBe(false);

    await controller.processResponses("alice", [act("triple"), 2, 3, 1]);
    expect(recorded).toEqual([{ a: 2, b: 3, c: 1 }]);
  });

  it("drops the undone answer so the re-answer replaces it", async () => {
    const { controller, recorded } = await started({ triple });
    await controller.processResponses("alice", [act("triple"), 1, 2]);

    await controller.undo("alice");
    await controller.processResponses("alice", [3, 2]);

    expect(recorded).toEqual([{ a: 1, b: 3, c: 2 }]);
  });

  it("restores the grammar cursor when returning to the action choice", async () => {
    const { controller, recorded } = await started(
      { bid },
      { grammar: { kind: "repeat", body: { kind: "choice", actions: ["playCard", "bid"] }, count: 2 } },
    );
    await controller.processResponses("alice", [act("bid")]);
    await controller.undo("alice");
    expect(controller.promptFor("alice")?.input.id).toBe("__action-select__");

    await controller.processResponses("alice", [act("bid"), 3, 1]);
    // Still the second of two repetitions: the undone choice did not count.
    expect(controller.promptFor("alice")?.input.id).toBe("__action-select__");
    await controller.processResponses("alice", [act("bid"), 4, 2]);

    expect(recorded).toEqual([
      { quantity: 3, face: 1 },
      { quantity: 4, face: 2 },
    ]);
    expect(controller.promptFor("alice")).toBeUndefined();
    expect(controller.promptFor("bob")?.input.id).toBe("__action-select__");
  });

  it("cannot undo past a segment boundary", async () => {
    const { controller, events } = await started({ keepThenDiscard });
    const hand = controller.getState().players.alice.inventories.hand;
    const [a] = "pieceIds" in hand ? hand.pieceIds : [];
    await controller.processResponses("alice", [act("keepThenDiscard"), a]);
    const prompt = controller.promptFor("alice");
    expect(prompt?.input.id).toBe("discard");
    const before = controller.getState();
    events.length = 0;

    expect(controller.canUndo("alice")).toBe(false);
    await expect(controller.undo("alice")).rejects.toBeInstanceOf(UndoNotAllowedError);

    expect(events).toEqual([]);
    expect(controller.getState()).toEqual(before);
    expect(controller.promptFor("alice")).toBe(prompt);
  });

  it("cannot return to an action-select when the action was chosen automatically", async () => {
    const { controller } = await started({ bid }, { grammar: { kind: "action", ref: "bid" } });
    expect(controller.promptFor("alice")?.input.id).toBe("quantity");
    expect(controller.canUndo("alice")).toBe(false);

    await controller.processResponses("alice", [1]);
    expect(controller.canUndo("alice")).toBe(true);
    await controller.undo("alice");

    expect(controller.promptFor("alice")?.input.id).toBe("quantity");
    expect(controller.canUndo("alice")).toBe(false);
    await expect(controller.undo("alice")).rejects.toBeInstanceOf(UndoNotAllowedError);
  });

  it("has nothing to undo at an action-select or without a prompt", async () => {
    const { controller } = await started();

    expect(controller.canUndo("alice")).toBe(false);
    expect(controller.canUndo("bob")).toBe(false);
    await expect(controller.undo("alice")).rejects.toBeInstanceOf(UndoNotAllowedError);
    await expect(controller.undo("bob")).rejects.toThrow('No prompt is awaiting player "bob"');
  });

  it("simultaneous: undo by one player leaves the other's prompt untouched", async () => {
    const { controller, recorded, events } = await started(
      { triple },
      { ordering: { kind: "simultaneous" } },
    );
    await controller.processResponses("alice", [act("triple"), 1, 2]);
    await controller.processResponses("bob", [act("triple"), 3]);
    const bobPrompt = controller.promptFor("bob");
    expect(bobPrompt?.input.id).toBe("b");
    events.length = 0;

    await controller.undo("alice");

    expect(events).toEqual(["prompt:alice:b"]);
    expect(controller.promptFor("bob")).toBe(bobPrompt);
    // Stop before the join: High Card's trick hook needs a played card.
    await controller.processResponses("alice", [3, 2]);
    expect(recorded).toEqual([{ a: 1, b: 3, c: 2 }]);
    expect(controller.promptFor("bob")).toBe(bobPrompt);
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
      segments: [
        {
          ...bid.segments[0],
          inputs: [
            bid.segments[0].inputs[0],
            {
              ...bid.segments[0].inputs[1],
              validate: (_s, _a, inputs) =>
                resolvedAnswer ? (inputs.face as number) <= 3 : (inputs.face as number) > 3,
            },
          ],
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
