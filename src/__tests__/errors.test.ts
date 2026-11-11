import { GameRuntimeError, isGameRuntimeError } from "#chaincraft/errors.js";
import { StepBudgetExceededError } from "#chaincraft/orchestration/errors.js";
import { resolvePlayerTarget } from "#chaincraft/effects/player-target.js";
import type { EffectContext, GameSession } from "#chaincraft/types.js";

describe("GameRuntimeError", () => {
  it("derives origin from the code", () => {
    expect(new GameRuntimeError("no-legal-actions", "x").origin).toBe("spec");
    expect(new GameRuntimeError("walk-mismatch", "x").origin).toBe("engine");
    expect(new GameRuntimeError("no-custom-handler", "x").origin).toBe("host");
  });

  it("keeps message and name", () => {
    const error = new GameRuntimeError("action-unknown", "Action \"x\" not found in module");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Action \"x\" not found in module");
    expect(error.name).toBe("GameRuntimeError");
  });

  it("StepBudgetExceededError is a spec fault with its own name", () => {
    const error = new StepBudgetExceededError(10, "loop-1");
    expect(error).toBeInstanceOf(GameRuntimeError);
    expect(error).toMatchObject({ name: "StepBudgetExceededError", code: "step-budget-exceeded", origin: "spec" });
  });

  it("isGameRuntimeError checks structure, not identity", () => {
    const copy = Object.assign(new Error("x"), { code: "action-unknown", origin: "spec" });
    expect(isGameRuntimeError(copy)).toBe(true);
    expect(isGameRuntimeError(Object.assign(new Error("x"), { code: "ENOENT", origin: "spec" }))).toBe(false);
    expect(isGameRuntimeError(new Error("x"))).toBe(false);
    expect(isGameRuntimeError("x")).toBe(false);
  });

  it("throw sites raise tagged errors", () => {
    const session = { players: ["p1"], state: { players: { p1: {} } } } as unknown as GameSession;
    const ctx = { actorId: null, actionInputs: {}, effectDef: {} } as unknown as EffectContext;
    let thrown: unknown;
    try {
      resolvePlayerTarget(session, ctx, "actor");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "player-target-no-actor", origin: "spec" });
  });
});
