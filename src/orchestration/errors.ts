import { GameRuntimeError } from "#chaincraft/errors.js";

/** A player's response is not a legal answer to their pending prompt. Nothing was applied. */
export class IllegalActionError extends Error {
  override readonly name = "IllegalActionError";

  constructor(
    message: string,
    /** Position of the rejected response within the submitted sequence. */
    public readonly index: number,
    /** The input the rejected response answered; absent for action-select. */
    public readonly inputId?: string,
    /** The spec's player-facing validationMessage, when a validation rule rejected it. */
    public readonly validationMessage?: string,
  ) {
    super(message);
  }
}

/** One step() call exceeded its work budget: the spec loops without ever prompting or ending. */
export class StepBudgetExceededError extends GameRuntimeError {
  override name = "StepBudgetExceededError";

  constructor(
    public readonly limit: number,
    /** Innermost flow node at the moment the budget ran out. */
    public readonly nodeId: string | undefined,
  ) {
    super(
      "step-budget-exceeded",
      `step() exceeded its work budget of ${limit}` +
        (nodeId === undefined ? "" : ` in flow node "${nodeId}"`) +
        "; the flow appears to loop without prompting or ending",
    );
  }
}

/** The player has no answer to take back within the current action segment. Nothing was changed. */
export class UndoNotAllowedError extends Error {
  override readonly name = "UndoNotAllowedError";
}
