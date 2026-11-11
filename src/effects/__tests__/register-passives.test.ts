import type { GameSession, PassiveActivation } from "#chaincraft/types.js";
import type { StateWriteEvent } from "../effect-bus.js";
import { EffectBus } from "../effect-bus.js";
import { registerPassiveActivations } from "../register-passives.js";
import { GameEventEmitter } from "#chaincraft/events/emitter.js";
import type { GameEvent } from "#chaincraft/events/emitter.js";

function makeSession(): { session: GameSession; fired: GameEvent[] } {
  const events = new GameEventEmitter();
  const fired: GameEvent[] = [];
  events.on((e) => {
    if (e.kind === "passive:fire") fired.push(e);
  });
  const session = {
    events,
    state: {
      gamepieces: { "piece-1": { ownerId: "p1" } },
      players: { p1: { roles: ["warden"] }, p2: { roles: [] } },
    },
  } as unknown as GameSession;
  return { session, fired };
}

const hpDecrease = (targetId: string): StateWriteEvent => ({
  kind: "state-write",
  path: "player.property.hp",
  direction: "decrease",
  targetId,
  actorId: "p2",
  resolvedValue: 3,
  previousValue: 10,
});

const trigger = {
  kind: "state-write",
  scope: "target",
  path: "player.property.hp",
  direction: "decrease",
} as const;

describe("registerPassiveActivations — passive:fire", () => {
  it("emits for a before-passive bound to a piece, with the owning piece id", () => {
    const { session, fired } = makeSession();
    const bus = new EffectBus();
    const activation: PassiveActivation = {
      binding: { kind: "piece", pieceId: "piece-1" },
      passiveId: "shield",
      trigger,
      timing: "before",
      compiledEffects: [{ kind: "cancel-effect" }],
    };
    registerPassiveActivations(bus, [activation], session);

    const pending = bus.emitBeforeStateWrite(hpDecrease("p1"), session);

    expect(pending.cancelled).toBe(true);
    expect(fired).toEqual([{ kind: "passive:fire", passiveId: "shield", ownerPieceId: "piece-1" }]);
  });

  it("emits for an after-passive bound to a role, without ownerPieceId", async () => {
    const { session, fired } = makeSession();
    const bus = new EffectBus();
    const activation: PassiveActivation = {
      binding: { kind: "role", roleId: "warden" },
      passiveId: "retaliate",
      trigger,
      timing: "after",
      compiledEffects: [{ kind: "noop" }],
    };
    registerPassiveActivations(bus, [activation], session, {
      noop: { kind: "effect-executor", execute: async () => {} },
    });

    await bus.emitAfterStateWrite(hpDecrease("p1"), session);

    expect(fired).toEqual([{ kind: "passive:fire", passiveId: "retaliate" }]);
  });

  it("does not emit when the passive does not match the event", async () => {
    const { session, fired } = makeSession();
    const bus = new EffectBus();
    const activation: PassiveActivation = {
      binding: { kind: "piece", pieceId: "piece-1" },
      passiveId: "shield",
      trigger,
      timing: "before",
      compiledEffects: [{ kind: "cancel-effect" }],
    };
    registerPassiveActivations(bus, [activation], session);

    bus.emitBeforeStateWrite(hpDecrease("p2"), session);

    expect(fired).toEqual([]);
  });
});
