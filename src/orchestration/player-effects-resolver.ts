// ---------------------------------------------------------------------------
// Player effects resolver — per-player work production during a turn node's
// acting phase.
//
// Given a grammar cursor and the player's position in it, produces the next
// unit of work: pre-loaded effect queue items (when no decision exists) or
// an action-select suspension (when the player must choose). The effects
// controller executes whatever this resolver produces.
// ---------------------------------------------------------------------------

import type { CompiledGameModule, Grammar } from "#chaincraft/types.js";
import type {
  GameExecutionState,
  PlayerTurnCursor,
  PlayerInputSuspension,
  QueueGroup,
  QueueItem,
} from "./types.js";
import {
  advanceGrammarCursor,
  resolveLegalActions,
} from "./grammar.js";

/** What a player runner should do next at its current cursor position. */
export type PlayerTurnSignal =
  | { kind: "enqueue"; items: QueueItem[] }
  | { kind: "suspend"; suspension: PlayerInputSuspension }
  | { kind: "done" };

/**
 * Computes the next unit of work for one player's runner.
 *
 * - Cursor done → 'done' (runner joins).
 * - Legal actions is a singleton with canPass=false → no decision exists;
 *   explode the action into queue items and advance the cursor immediately
 *   (no player response needed).
 * - Otherwise → produce an action-select suspension; the cursor is advanced
 *   later via advanceGrammarCursor when the response arrives.
 */
export function nextPlayerTurnWork(
  playerId: string,
  cursor: PlayerTurnCursor,
  grammar: Grammar,
  _state: GameExecutionState,
  module: CompiledGameModule,
  nodeLabel?: string,
): PlayerTurnSignal {
  if (cursor.done) return { kind: "done" };

  const { actions: structuralActions, canPass } = resolveLegalActions(grammar, cursor);

  // Filter actions whose precondition is not satisfied at the current state.
  const actions = structuralActions.filter((id) => {
    const def = module.actions[id];
    return !def?.precondition || def.precondition(_state.session, playerId);
  });

  if (actions.length === 0 && !canPass) {
    throw new Error(
      `Player "${playerId}" has no legal actions at node "${nodeLabel ?? "unknown"}" — check spec preconditions`,
    );
  }

  // Singleton + no pass means no decision exists: auto-execute without prompting.
  if (actions.length === 1 && !canPass) {
    const actionId = actions[0];
    const items = explodeAction(actionId, playerId, module);
    advanceGrammarCursor(cursor, grammar, false, actionId);
    return { kind: "enqueue", items };
  }

  return {
    kind: "suspend",
    suspension: {
      kind: "player-input",
      awaiting: playerId,
      response: undefined,
      input: {
        id: "__action-select__",
        type: { kind: "action-select", actions, canPass },
        label: nodeLabel,
      },
    },
  };
}

/**
 * Explodes an action into its constituent input and effect queue items.
 * All items share one QueueGroup so that input items can write resolved values
 * into group.collected and effect items can read them. actorId on the group
 * identifies who is performing the action.
 */
export function explodeAction(
  actionId: string,
  actorId: string,
  module: CompiledGameModule,
): QueueItem[] {
  const action = module.actions[actionId];
  if (!action) throw new Error(`Action "${actionId}" not found in module`);
  const group: QueueGroup = { actorId, collected: {} };
  return [
    ...action.inputs.map((input) => ({ kind: "input" as const, input, group })),
    ...action.effects.map((effect) => ({ kind: "effect" as const, effect, group })),
  ];
}
