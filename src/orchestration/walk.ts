// ---------------------------------------------------------------------------
// Response walk — judges a sequence of answers to a player's pending prompt
// without mutating anything. An action's inputs are collected a segment at a
// time, with its effects running between segments, so state is fixed only
// WITHIN a segment. The walk stops at the segment boundary ("boundary"); each
// answer before it is judged exactly as step() would judge it when applied.
// ---------------------------------------------------------------------------

import type {
  CollectedInputs,
  EngineInput,
  GameExecutionDeps,
  GameExecutionState,
  InputOption,
  InputQueueItem,
  PlayerInputSuspension,
  QueueGroup,
} from "#chaincraft/orchestration/types.js";
import {
  NO_AUTO_VALUE,
  autoInputValue,
  inputOptions,
  getAnswerRejectionReason,
  isPlayerAnswered,
} from "#chaincraft/orchestration/input-check.js";
import type { Rejection } from "#chaincraft/orchestration/input-check.js";

/** The prompt that would follow the walked answers. */
export interface NextInput {
  input: EngineInput;
  options?: InputOption[];
}

export type WalkResult =
  /** "boundary": the remaining inputs can only be answered after the segment's effects run. */
  | { kind: "ok"; next: NextInput | "complete" | "boundary" }
  | {
      kind: "illegal";
      /** Position of the first rejected answer in the submitted sequence. */
      index: number;
      /** The input that answer was for; absent for action-select. */
      inputId?: string;
      reason: string;
      message?: string;
    };

/**
 * Walk `responses` from the player's pending prompt to the end of the current action.
 * The first answer is judged against the pending prompt as shown to the player.
 */
export function walkResponses(
  state: GameExecutionState,
  playerId: string,
  responses: readonly unknown[],
  deps: Pick<GameExecutionDeps, "module" | "resolveOptions">,
): WalkResult {
  const playerTurn = state.playerTurns?.[playerId];
  const pending = playerTurn?.pending;
  if (!playerTurn || pending?.suspension.kind !== "player-input") {
    throw new Error(`Player "${playerId}" has no pending prompt`);
  }
  if (responses.length === 0) {
    return { kind: "illegal", index: 0, reason: "no responses submitted" };
  }

  const suspension = pending.suspension as PlayerInputSuspension;
  const answer = (
    input: EngineInput,
    collected: CollectedInputs,
    options: InputOption[] | undefined,
    value: unknown,
  ) =>
    getAnswerRejectionReason(input, options, value, {
      session: state.session,
      actorId: playerId,
      collected,
    });

  const first = responses[0];
  const firstRejectionReason = answer(
    suspension.input,
    pending.group?.collected ?? {},
    suspension.options,
    first,
  );
  if (firstRejectionReason)
    return illegal(0, suspension.input, firstRejectionReason);

  // The rest of the action the first answer commits to, with a private copy of its answers.
  let group: QueueGroup;
  let upcoming: readonly EngineInput[];
  let hasMore: boolean; // player inputs remain after the current segment's effects
  if (suspension.input.type.kind === "action-select") {
    const choice = first as
      | { kind: "act"; actionId: string }
      | { kind: "pass" };
    group = { actorId: playerId, collected: {} };
    const segments =
      choice.kind === "act" ? deps.module.actions[choice.actionId].segments : [];
    upcoming = segments[0]?.inputs ?? [];
    // hasMore is true if there is more than 1 segment and it's input is not auto
    hasMore = segments.slice(1).some((s) => s.inputs.some(isPlayerAnswered));
  } else {
    group = {
      ...pending.group!,
      collected: { ...pending.group!.collected, [suspension.input.id]: first },
    };
    const segment = pending.segment ?? 0;
    const groupInputs = playerTurn.queue.filter(
      (item): item is InputQueueItem =>
        item.kind === "input" && item.group === pending.group,
    );
    upcoming = groupInputs
      .filter((item) => (item.segment ?? 0) === segment)
      .map((item) => item.input);
    hasMore = groupInputs.some(
      (item) => (item.segment ?? 0) > segment && isPlayerAnswered(item.input),
    );
  }

  let index = 1;
  for (let i = 0; i < upcoming.length; i++) {
    const input = upcoming[i];
    const auto = autoInputValue(input, group);
    if (auto !== NO_AUTO_VALUE) {
      group.collected[input.id] = auto;
      continue;
    }
    const options = inputOptions(
      state,
      input,
      playerId,
      group.collected,
      upcoming.slice(i + 1),
      deps.resolveOptions,
    );
    if (index === responses.length) {
      return {
        kind: "ok",
        next: { input, ...(options !== undefined && { options }) },
      };
    }
    const rejection = answer(input, group.collected, options, responses[index]);
    if (rejection) return illegal(index, input, rejection);
    group.collected[input.id] = responses[index];
    index++;
  }

  if (index < responses.length) {
    return {
      kind: "illegal",
      index,
      reason: hasMore
        ? "the remaining inputs can only be answered after the action's effects run"
        : "the action is already complete",
    };
  }
  return { kind: "ok", next: hasMore ? "boundary" : "complete" };
}

function illegal(
  index: number,
  input: EngineInput,
  rejection: Rejection,
): WalkResult {
  return {
    kind: "illegal",
    index,
    ...(input.type.kind !== "action-select" && { inputId: input.id }),
    reason: rejection.reason,
    ...(rejection.message !== undefined && { message: rejection.message }),
  };
}
