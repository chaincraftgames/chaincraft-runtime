// ---------------------------------------------------------------------------
// Player effects resolver — per-player work production during a turn node's
// acting phase.
//
// Given a grammar cursor and the player's position in it, produces the next
// unit of work: pre-loaded effect queue items (when no decision exists) or
// an action-select suspension (when the player must choose). The effects
// controller executes whatever this resolver produces.
// ---------------------------------------------------------------------------

import type {
  CompiledGameModule,
  Grammar,
  RepeatGrammar,
} from "#chaincraft/types.js";
import type {
  GameExecutionState,
  OptionsResolver,
  PlayerTurnCursor,
  PlayerInputSuspension,
  QueueGroup,
  QueueItem,
} from "#chaincraft/orchestration/types.js";
import {
  advanceGrammarCursor,
  resolveLegalActions,
} from "#chaincraft/orchestration/grammar.js";
import { hasCompletion } from "#chaincraft/orchestration/input-completion.js";
import { resolveOptions as defaultResolveOptions } from "#chaincraft/orchestration/options.js";
import { GameRuntimeError } from "#chaincraft/errors.js";

/** What a player runner should do next at its current cursor position. */
export type PlayerTurnSignal =
  | { kind: "enqueue"; items: QueueItem[] }
  | { kind: "suspend"; suspension: PlayerInputSuspension }
  | { kind: "done" };

/**
 * Computes the next unit of work for one player's runner.
 *
 * - Cursor done → 'done' (runner joins).
 * - The current sequence step is optional and its action is unavailable → skip it
 *   (no action:start) and continue with the next step.
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
  state: GameExecutionState,
  module: CompiledGameModule,
  nodeLabel?: string,
  resolveOptions: OptionsResolver = defaultResolveOptions,
): PlayerTurnSignal {
  return workAt(
    playerId,
    cursor,
    grammar,
    state,
    module,
    nodeLabel,
    resolveOptions,
    0,
  );
}

/** Whether the repeat finishes by counting iterations alone, even if every step is skipped. */
function endsByCounting(count: RepeatGrammar["count"]): boolean {
  if (typeof count === "number") return true;
  return count !== "until-pass" && count.max !== undefined;
}

/** `skipped` counts optional steps skipped so far in this call chain. */
function workAt(
  playerId: string,
  cursor: PlayerTurnCursor,
  grammar: Grammar,
  state: GameExecutionState,
  module: CompiledGameModule,
  nodeLabel: string | undefined,
  resolveOptions: OptionsResolver,
  skipped: number,
): PlayerTurnSignal {
  if (cursor.done) return { kind: "done" };

  // Runs when the queue is empty, so state already reflects the previous action's effects.
  // Checked only at an iteration boundary (sequenceIndex 0), i.e. after a whole sequence body.
  if (
    grammar.kind === "repeat" &&
    typeof grammar.count === "object" &&
    "endCondition" in grammar.count &&
    cursor.repeatCount > 0 &&
    cursor.sequenceIndex === 0 &&
    grammar.count.endCondition(state.session, playerId)
  ) {
    cursor.done = true;
    return { kind: "done" };
  }

  const { actions: structuralActions, canPass } = resolveLegalActions(
    grammar,
    cursor,
  );
  const sequence =
    grammar.kind === "sequence"
      ? grammar
      : grammar.kind === "repeat" && grammar.body.kind === "sequence"
        ? grammar.body
        : undefined;

  // Offer only actions whose precondition holds and whose inputs can all be answered.
  const actions = structuralActions.filter((id) => {
    const def = module.actions[id];
    if (def?.precondition && !def.precondition(state.session, playerId))
      return false;
    return (
      !def ||
      hasCompletion(
        state,
        def.segments[0]?.inputs ?? [],
        playerId,
        {},
        resolveOptions,
      )
    );
  });

  if (actions.length === 0 && sequence?.optional?.[cursor.sequenceIndex]) {
    // Skipping changes no state, so a repeat that only ends on pass or a predicate would spin.
    if (
      grammar.kind === "repeat" &&
      !endsByCounting(grammar.count) &&
      skipped + 1 >= sequence.actions.length
    ) {
      throw new GameRuntimeError(
        "no-legal-actions",
        `Player "${playerId}" has no legal actions at node "${nodeLabel ?? "unknown"}" — every step of a repeated sequence was skipped`,
      );
    }
    advanceGrammarCursor(cursor, grammar, false);
    return workAt(
      playerId,
      cursor,
      grammar,
      state,
      module,
      nodeLabel,
      resolveOptions,
      skipped + 1,
    );
  }

  if (actions.length === 0 && !canPass) {
    throw new GameRuntimeError(
      "no-legal-actions",
      `Player "${playerId}" has no legal actions at node "${nodeLabel ?? "unknown"}" — check spec preconditions`,
    );
  }

  // Singleton + no pass means no decision exists: auto-execute without prompting.
  if (actions.length === 1 && !canPass) {
    const actionId = actions[0];
    const items = explodeAction(actionId, playerId, module);
    advanceGrammarCursor(cursor, grammar, false, actionId);
    state.session.events.emit({
      kind: "action:start",
      playerId,
      actionId,
      auto: true,
    });
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
  const items: QueueItem[] = [];
  const action = module.actions[actionId];
  if (!action)
    throw new GameRuntimeError(
      "action-unknown",
      `Action "${actionId}" not found in module`,
    );
  const group: QueueGroup = { actorId, actionId, collected: {} };
  for (const [segmentIndex, segment] of action.segments.entries()) {
    for (const input of segment.inputs) {
      items.push({
        kind: "input" as const,
        input,
        group,
        segment: segmentIndex,
      });
    }
    for (const effect of segment.effects) {
      items.push({
        kind: "effect" as const,
        effect,
        group,
        segment: segmentIndex,
      });
    }
  }
  return items;
}
