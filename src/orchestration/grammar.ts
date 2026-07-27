// ---------------------------------------------------------------------------
// Grammar — pure cursor/grammar queries.
//
// Given a cursor and a grammar, answers two questions:
//   - What may the player choose right now, and may they pass? (resolveLegalActions)
//   - How does the cursor move after an action or pass? (advanceGrammarCursor)
//
// Whether to auto-execute vs. prompt is a runner concern (player-runner.ts),
// derived from the LegalActions result: singleton actions + canPass=false
// means no decision exists and the runner can execute immediately.
//
// Precondition filtering against game state is also a runner concern; the
// runner may filter LegalActions.actions before issuing the suspension.
// ---------------------------------------------------------------------------

import type { Grammar } from "#chaincraft/types.js";
import type { PlayerTurnCursor } from "./types.js";

/**
 * Advances a player's grammar cursor after actionId was submitted (or forced).
 * Mutates cursor in place (shared reference with TurnFrameState.cursors[playerId]
 * so the flow runner sees the update on the next advanceFlow call).
 * Marks cursor.done when the grammar is fully satisfied.
 *
 * @param passed - true when the player elected to pass rather than act.
 *   Only meaningful for grammars where canPass can be true (choice with
 *   passable, repeat with until-pass or range count past min).
 */
export function advanceGrammarCursor(
  cursor: PlayerTurnCursor,
  grammar: Grammar,
  passed: boolean,
  _actionId?: string,
): void {
  switch (grammar.kind) {
    case "action":
    case "choice":
      cursor.done = true;
      break;
    case "sequence":
      cursor.sequenceIndex++;
      if (cursor.sequenceIndex >= grammar.actions.length) cursor.done = true;
      break;
    case "repeat": {
      const count = grammar.count;
      if (count === "until-pass") {
        cursor.done = passed;
        if (!cursor.done) cursor.repeatCount++;
      } else if (typeof count === "number") {
        cursor.repeatCount++;
        cursor.done = cursor.repeatCount >= count;
      } else {
        // { min?, max? } range.
        if (passed) {
          cursor.done = true;
        } else {
          cursor.repeatCount++;
          cursor.done = count.max !== undefined && cursor.repeatCount >= count.max;
        }
      }
      break;
    }
  }
}

/** The legal actions at a cursor position plus whether passing is permitted. */
export interface LegalActions {
  /** Action IDs the player may choose from (never includes a pass sentinel). */
  actions: string[];
  /** Whether the player may elect no action (pass / stop repeating). */
  canPass: boolean;
}

/**
 * Returns the actions structurally available to a player at their current
 * cursor position and whether passing is permitted.
 *
 * - For repeat with { min?, max? } range: canPass is false until repeatCount
 *   >= min, then true (the player may stop or continue up to max).
 * - For repeat with count: 'until-pass': canPass is always true.
 * - For choice with passable: true: canPass is true.
 *
 * Structural only — precondition filtering against game state is the
 * caller's responsibility.
 */
export function resolveLegalActions(
  grammar: Grammar,
  cursor: PlayerTurnCursor,
): LegalActions {
  switch (grammar.kind) {
    case "action":
      return { actions: [grammar.ref], canPass: false };
    case "choice":
      return { actions: [...grammar.actions], canPass: grammar.passable ?? false };
    case "sequence":
      return { actions: [grammar.actions[cursor.sequenceIndex]], canPass: false };
    case "repeat": {
      const body = resolveLegalActions(grammar.body, cursor);
      if (grammar.count === "until-pass") {
        // The pass option is a property of the repeat count, not the body.
        return { actions: body.actions, canPass: true };
      }
      if (typeof grammar.count === "number") {
        return { actions: body.actions, canPass: false };
      }
      // { min?, max? } range.
      const min = grammar.count.min ?? 0;
      return { actions: body.actions, canPass: cursor.repeatCount >= min };
    }
  }
}


