import type { GameSession } from "#chaincraft/types.js";
import type { EngineInput } from "#chaincraft/orchestration/types.js";
import { getAnswerRejectionReason } from "#chaincraft/orchestration/input-check.js";
import type { AnswerContext } from "#chaincraft/orchestration/input-check.js";

const context: AnswerContext = {
  session: {} as GameSession,
  actorId: "p1",
  collected: {},
};

const reason = (input: EngineInput, options: unknown[] | undefined, value: unknown) =>
  getAnswerRejectionReason(input, options, value, context)?.reason;

const actionSelect = (canPass: boolean): EngineInput => ({
  id: "__action-select__",
  type: { kind: "action-select", actions: ["draw", "play"], canPass },
});

const numberInput = (type: Partial<{ min: number; max: number; integer: boolean }> = {}): EngineInput => ({
  id: "n",
  type: { kind: "number", ...type },
});

describe("rejectAnswer — action-select", () => {
  it("accepts an offered action and a permitted pass", () => {
    expect(reason(actionSelect(true), undefined, { kind: "act", actionId: "play" })).toBeUndefined();
    expect(reason(actionSelect(true), undefined, { kind: "pass" })).toBeUndefined();
  });

  it("rejects a pass when passing is not allowed", () => {
    expect(reason(actionSelect(false), undefined, { kind: "pass" })).toBe("passing is not allowed");
  });

  it("rejects an action that was not offered", () => {
    expect(reason(actionSelect(true), undefined, { kind: "act", actionId: "steal" })).toBe(
      'action "steal" is not offered',
    );
    expect(reason(actionSelect(true), undefined, { kind: "act", actionId: 7 })).toBe(
      'action "7" is not offered',
    );
  });

  it("rejects malformed responses", () => {
    for (const value of [undefined, null, "play", { kind: "other" }, ["act"]]) {
      expect(reason(actionSelect(true), undefined, value)).toBe("malformed action-select response");
    }
  });
});

describe("rejectAnswer — inputs with options", () => {
  const cardInput: EngineInput = {
    id: "card",
    type: { kind: "gamepiece-select", inventory: "hand" },
  };

  it("accepts only listed values", () => {
    expect(reason(cardInput, ["c1", "c2"], "c2")).toBeUndefined();
    expect(reason(cardInput, ["c1", "c2"], "c3")).toBe("not in allowed options");
  });

  it("rejects everything when the list is empty", () => {
    expect(reason(cardInput, [], "c1")).toBe("not in allowed options");
  });
});

describe("rejectAnswer — number", () => {
  it("accepts a whole number within bounds", () => {
    expect(reason(numberInput({ min: 1, max: 6 }), undefined, 1)).toBeUndefined();
    expect(reason(numberInput({ min: 1, max: 6 }), undefined, 6)).toBeUndefined();
  });

  it("rejects non-numbers and non-finite numbers", () => {
    for (const value of ["5", null, undefined, true, Infinity, -Infinity, NaN]) {
      expect(reason(numberInput(), undefined, value)).toBe("expected a finite number");
    }
  });

  it("rejects fractions unless integer is false", () => {
    expect(reason(numberInput(), undefined, 1.5)).toBe("expected a whole number");
    expect(reason(numberInput({ integer: false }), undefined, 1.5)).toBeUndefined();
  });

  it("rejects values outside min/max", () => {
    expect(reason(numberInput({ min: 1, max: 6 }), undefined, 0)).toBe("must be at least 1");
    expect(reason(numberInput({ min: 1, max: 6 }), undefined, 7)).toBe("must be at most 6");
  });
});

describe("rejectAnswer — string", () => {
  const stringInput: EngineInput = { id: "s", type: { kind: "string" } };

  it("accepts strings and rejects other values", () => {
    expect(reason(stringInput, undefined, "")).toBeUndefined();
    expect(reason(stringInput, undefined, 5)).toBe("expected a string");
  });
});

describe("rejectAnswer — validation", () => {
  const seen: Array<Readonly<Record<string, unknown>>> = [];
  const weaponName: EngineInput = {
    id: "name",
    type: { kind: "string" },
    validate: (_session, _actorId, inputs) => {
      seen.push(inputs);
      return inputs.name !== "";
    },
    validationMessage: "Name your weapon",
  };

  it("runs validation on inputs with no list, with earlier answers and the candidate", () => {
    seen.length = 0;
    const withEarlier = { ...context, collected: { kind: "sword" } };
    expect(getAnswerRejectionReason(weaponName, undefined, "toast", withEarlier)).toBeUndefined();
    expect(seen).toEqual([{ kind: "sword", name: "toast" }]);
  });

  it("returns the validation message when validation fails", () => {
    expect(getAnswerRejectionReason(weaponName, undefined, "", context)).toEqual({
      reason: "failed validation",
      message: "Name your weapon",
    });
  });

  it("does not run validation when the type check fails", () => {
    expect(getAnswerRejectionReason(weaponName, undefined, 5, context)).toEqual({ reason: "expected a string" });
  });

  it("adds the message when a listed input's value fails validation", () => {
    const face: EngineInput = {
      id: "face",
      type: { kind: "number", min: 1, max: 6 },
      validate: (_s, _a, inputs) => (inputs.face as number) > 3,
      validationMessage: "Bid higher",
    };
    expect(getAnswerRejectionReason(face, [4, 5, 6], 2, context)).toEqual({
      reason: "not in allowed options",
      message: "Bid higher",
    });
    expect(getAnswerRejectionReason(face, [4, 5, 6], 9, context)).toEqual({ reason: "not in allowed options" });
  });
});
