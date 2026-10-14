// ---------------------------------------------------------------------------
// Input check — the single place an input's valid answers are computed and a
// submitted answer is judged. Prompting (drainQueue) and validation share it.
// ---------------------------------------------------------------------------

import type { GameSession, NumberInputType } from "#chaincraft/types.js";
import type {
  CollectedInputs,
  EngineInput,
  GameExecutionState,
  OptionsResolver,
  QueueGroup,
} from "#chaincraft/orchestration/types.js";
import { pruneDeadEnds } from "#chaincraft/orchestration/input-completion.js";

/** Sentinel: the input is answered by a player, not filled in by the engine. */
export const NO_AUTO_VALUE = Symbol("no-auto-value");

/** The engine-supplied value for effect-originator / trigger-input inputs, else NO_AUTO_VALUE. */
export function autoInputValue(input: EngineInput, group: QueueGroup): unknown {
  const type = input.type as { kind: string; inputId?: string };

  if (type.kind === "effect-originator") {
    if (!group.originatorId) {
      throw new Error(`Input "${input.id}" is effect-originator but group has no originatorId`);
    }
    return group.originatorId;
  }

  if (type.kind === "trigger-input") {
    const inputId = type.inputId;
    if (!inputId || !group.triggerInputs || !(inputId in group.triggerInputs)) {
      throw new Error(`Input "${input.id}" references trigger input "${inputId}" not available`);
    }
    return group.triggerInputs[inputId];
  }

  return NO_AUTO_VALUE;
}

/**
 * Valid answers for `input` given earlier answers, with dead ends pruned against
 * the action's `later` inputs. undefined means the input has no finite list.
 */
export function inputOptions(
  state: GameExecutionState,
  input: EngineInput,
  actorId: string,
  collected: CollectedInputs,
  later: readonly EngineInput[],
  resolveOptions: OptionsResolver,
): unknown[] | undefined {
  const options = resolveOptions(state, input, actorId, collected);
  if (options === undefined) return undefined;
  return pruneDeadEnds(state, input, options, later, actorId, collected, resolveOptions);
}

/** A rejected answer: a developer-facing reason plus the spec's player-facing message, if any. */
export interface Rejection {
  reason: string;
  message?: string;
}

/** Who is answering, and their earlier answers in the same action. */
export interface AnswerContext {
  session: GameSession;
  actorId: string;
  collected: CollectedInputs;
}

/**
 * Why `value` is not a legal answer to `input`, or undefined if it is.
 * `options` must be the list from inputOptions (or the prompt that carried it).
 */
export function getAnswerRejectionReason(
  input: EngineInput,
  options: readonly unknown[] | undefined,
  value: unknown,
  context: AnswerContext,
): Rejection | undefined {
  const type = input.type;

  if (type.kind === "action-select") {
    const reason = actionSelectRejectReason(type, value);
    return reason === undefined ? undefined : { reason };
  }

  const message = "validationMessage" in input ? input.validationMessage : undefined;
  const failsValidation = (): boolean =>
    "validate" in input &&
    input.validate !== undefined &&
    !input.validate(context.session, context.actorId, { ...context.collected, [input.id]: value });

  if (options !== undefined) {
    if (options.includes(value)) return undefined;
    return {
      reason: "not in allowed options",
      ...(message !== undefined && failsValidation() && { message }),
    };
  }

  const typeReason = valueRejectReason(type, value);
  if (typeReason !== undefined) return { reason: typeReason };
  if (failsValidation()) {
    return { reason: "failed validation", ...(message !== undefined && { message }) };
  }
  return undefined;
}

function actionSelectRejectReason(
  type: { actions: string[]; canPass: boolean },
  value: unknown,
): string | undefined {
  const response = value as { kind?: unknown; actionId?: unknown } | null | undefined;
  if (response?.kind === "pass") {
    return type.canPass ? undefined : "passing is not allowed";
  }
  if (response?.kind === "act") {
    return typeof response.actionId === "string" && type.actions.includes(response.actionId)
      ? undefined
      : `action "${String(response.actionId)}" is not offered`;
  }
  return "malformed action-select response";
}

/** Type checks for inputs with no option list. */
function valueRejectReason(type: EngineInput["type"], value: unknown): string | undefined {
  switch (type.kind) {
    case "number":
      return numberRejectReason(type, value);
    case "string":
      return typeof value === "string" ? undefined : "expected a string";
    default:
      return undefined;
  }
}

function numberRejectReason(type: NumberInputType, value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return "expected a finite number";
  if (type.integer !== false && !Number.isInteger(value)) return "expected a whole number";
  if (type.min !== undefined && value < type.min) return `must be at least ${type.min}`;
  if (type.max !== undefined && value > type.max) return `must be at most ${type.max}`;
  return undefined;
}
