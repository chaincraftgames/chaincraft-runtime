// ---------------------------------------------------------------------------
// Undo — a player takes back their last answer within the current segment of
// an in-progress action. Nothing has executed since the segment's first input
// (its effects run only after all of its inputs), so undo just rewinds the
// player's queue and collected answers and re-prompts against unchanged state.
// In segment 0 of an action chosen via action-select, undo past the first
// answer returns to the action choice. Later segments start past a checkpoint.
// ---------------------------------------------------------------------------

import type {
  GameExecutionDeps,
  GameExecutionState,
  InputQueueItem,
  PlayerInputSuspension,
  PlayerTurnCursor,
  StepResult,
} from "#chaincraft/orchestration/types.js";
import { drainPlayerTurn } from "#chaincraft/orchestration/game-step.js";
import { isPlayerAnswered } from "#chaincraft/orchestration/input-check.js";
import { UndoNotAllowedError } from "#chaincraft/orchestration/errors.js";

type UndoTarget =
  /** Re-ask `answered[index]` (the last player answer of the current segment). */
  | { kind: "answer"; index: number }
  /** Return to the action-select that chose this action. */
  | { kind: "selection"; cursor: PlayerTurnCursor };

function undoTarget(state: GameExecutionState, playerId: string): UndoTarget | undefined {
  const pending = state.playerTurns?.[playerId]?.pending;
  if (
    !pending?.group ||
    pending.suspension.kind !== "player-input" ||
    pending.suspension.input.type.kind === "action-select"
  ) {
    return undefined;
  }
  const segment = pending.segment ?? 0;
  const answered = pending.group.answered ?? [];
  for (let i = answered.length - 1; i >= 0; i--) {
    const item = answered[i];
    if ((item.segment ?? 0) === segment && isPlayerAnswered(item.input)) {
      return { kind: "answer", index: i };
    }
  }
  if (segment === 0 && pending.group.selection) {
    return { kind: "selection", cursor: pending.group.selection.cursor };
  }
  return undefined;
}

/** Whether the player has an answer (or action choice) to take back. */
export function canUndo(state: GameExecutionState, playerId: string): boolean {
  return undoTarget(state, playerId) !== undefined;
}

/**
 * Takes back the player's last answer in the current segment and re-prompts it with
 * freshly computed options, or returns to the action-select that chose the action.
 * Throws UndoNotAllowedError (changing nothing) when there is nothing to take back.
 */
export async function undoLastAnswer(
  state: GameExecutionState,
  playerId: string,
  deps: GameExecutionDeps,
): Promise<StepResult> {
  const target = undoTarget(state, playerId);
  if (!target) {
    throw new UndoNotAllowedError(`Player "${playerId}" has no answer to undo in the current action segment`);
  }
  const playerTurn = state.playerTurns![playerId];
  const pending = playerTurn.pending!;
  const group = pending.group!;
  const queue = playerTurn.queue;

  let inputId: string;
  if (target.kind === "answer") {
    const popped = group.answered!.splice(target.index);
    for (const item of popped) delete group.collected[item.input.id];
    const pendingItem: InputQueueItem = {
      kind: "input",
      input: (pending.suspension as PlayerInputSuspension).input,
      group,
      segment: pending.segment,
    };
    queue.unshift(...popped, pendingItem);
    inputId = popped[0].input.id;
  } else {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].group === group) queue.splice(i, 1);
    }
    // In place: the cursor object is shared with the flow runner's turn frame.
    Object.assign(playerTurn.cursor, target.cursor);
    inputId = "__action-select__";
  }
  playerTurn.pending = undefined;
  state.session.events.emit({ kind: "input:undo", playerId, inputId });

  const result = await drainPlayerTurn(state, playerId, playerTurn, deps);
  if (result?.kind !== "suspended") {
    throw new Error(`Undo for "${playerId}" did not leave a pending prompt`);
  }
  return result;
}
