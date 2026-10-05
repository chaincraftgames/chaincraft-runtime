// ---------------------------------------------------------------------------
// Input completion — look-ahead over an action's remaining inputs.
// Sound because all inputs are collected before any effect runs: state is
// fixed while answering, so option lists depend only on (state, actor, collected).
// ---------------------------------------------------------------------------

import type {
  CollectedInputs,
  EngineInput,
  GameExecutionState,
  OptionsResolver,
} from "#chaincraft/orchestration/types.js";

/** Earlier input ids whose answers this input's options depend on. */
// TODO: replace with compiler-emitted ActionInputDef.dependsOn once filters can read param.*.
function referencedInputs(input: EngineInput): string[] {
  const fromPlayer = (input.type as { fromPlayer?: unknown }).fromPlayer;
  if (
    typeof fromPlayer === "object" &&
    fromPlayer !== null &&
    "param" in fromPlayer
  ) {
    return [String((fromPlayer as { param: unknown }).param)];
  }
  return [];
}

function hasDependents(
  inputId: string,
  later: readonly EngineInput[],
): boolean {
  return later.some((input) => referencedInputs(input).includes(inputId));
}

/** Whether at least one complete set of answers exists for `inputs`. */
export function hasCompletion(
  state: GameExecutionState,
  inputs: readonly EngineInput[],
  actorId: string,
  collected: CollectedInputs,
  resolveOptions: OptionsResolver,
): boolean {
  if (inputs.length === 0) return true;
  const [input, ...rest] = inputs;
  const options = resolveOptions(state, input, actorId, collected);

  // If options are undefined, treat it as having no finite list to check and continue
  // with the rest of the inputs.
  if (options === undefined) {
    return hasCompletion(state, rest, actorId, collected, resolveOptions);
  }

  // If the input has no dependents among the remaining inputs, we can check if the
  // current options are sufficient to satisfy the input's requirements.
  if (!hasDependents(input.id, rest)) {
    const required = (input.type as { count?: number }).count ?? 1;
    return (
      options.length >= required &&
      hasCompletion(state, rest, actorId, collected, resolveOptions)
    );
  }

  // If the input has dependents among the remaining inputs, we need to check each option
  // to see if it can lead to a complete set of answers.
  // TODO: memoize + node budget once filters can read earlier answers.
  return options.some((value) =>
    hasCompletion(
      state,
      rest,
      actorId,
      { ...collected, [input.id]: value },
      resolveOptions,
    ),
  );
}

/** Drop options from which no complete set of answers for `later` exists. */
export function pruneDeadEnds(
  state: GameExecutionState,
  input: EngineInput,
  options: unknown[],
  later: readonly EngineInput[],
  actorId: string,
  collected: CollectedInputs,
  resolveOptions: OptionsResolver,
): unknown[] {
  if (!hasDependents(input.id, later)) return options;
  return options.filter((value) =>
    hasCompletion(
      state,
      later,
      actorId,
      { ...collected, [input.id]: value },
      resolveOptions,
    ),
  );
}
