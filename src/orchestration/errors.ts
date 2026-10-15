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

/** The player has no answer to take back within the current action segment. Nothing was changed. */
export class UndoNotAllowedError extends Error {
  override readonly name = "UndoNotAllowedError";
}
