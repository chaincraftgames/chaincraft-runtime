// ---------------------------------------------------------------------------
// Options resolver — computes the valid choices for a player-input prompt,
// lazily, at suspend time, against current state.
//
// NOTE on actor context: the current OptionsResolver signature is
// (state, input) with no actor. For actor-relative inputs (gamepiece-select
// from own hand) we accept an optional third actorId argument — callers that
// don't pass it get game-scoped resolution only. This is assignment-
// compatible with EngineDeps.resolveOptions today and lights up automatically
// once the engine passes the actor through.
// ---------------------------------------------------------------------------

import type { GamepieceSelectInputType, NumberInputType } from "#chaincraft/types.js";
import type {
  GameExecutionState,
  EngineInput,
  CollectedInputs,
  InputOption,
} from "#chaincraft/orchestration/types.js";
import { getInventory } from "#chaincraft/inventory/index.js";

/** Largest whole-number range listed as options; wider ranges are value-checked only. */
export const MAX_NUMBER_OPTIONS = 32;

/** Determine the valid choices for a player-input prompt. */
export function resolveOptions(
  state: GameExecutionState,
  input: EngineInput,
  actorId?: string,
  collected?: CollectedInputs,
): InputOption[] | undefined {
  const options = structuralOptions(state, input, actorId, collected);
  if (options === undefined || !("validate" in input) || !input.validate) return options;
  const validate = input.validate;
  if (!actorId) {
    throw new Error(`Input "${input.id}" has validation but no actor to evaluate it for`);
  }
  return options.filter((value) =>
    validate(state.session, actorId, { ...collected, [input.id]: value }),
  );
}

/** Choices allowed by the input's kind and filter, before validation. */
function structuralOptions(
  state: GameExecutionState,
  input: EngineInput,
  actorId?: string,
  collected?: CollectedInputs,
): InputOption[] | undefined {
  const type = input.type;

  switch (type.kind) {
    case "enum":
      return [...type.values];

    case "boolean":
      return [true, false];

    case "number":
      return resolveNumberOptions(type);

    case "player-select": {
      let ids = [...state.session.players];
      if (type.excludeSelf && actorId) ids = ids.filter((id) => id !== actorId);
      if (type.filter)
        ids = ids.filter((id) => type.filter!(state.session, id, actorId, collected));
      return ids;
    }

    case "gamepiece-select":
      return resolveGamepieceOptions(state, type, actorId, collected);

    // Free-form or engine-resolved elsewhere: no finite options.
    // ('action-select' options are supplied by the player runner, which owns
    // the grammar; this resolver never sees them.)
    default:
      return undefined;
  }
}

/** How many options a number input lists; undefined when fractional, unbounded, or too wide. */
export function numberOptionCount(type: NumberInputType): number | undefined {
  if (type.integer === false || type.min === undefined || type.max === undefined) {
    return undefined;
  }
  const count = Math.floor(type.max) - Math.ceil(type.min) + 1;
  return count <= MAX_NUMBER_OPTIONS ? Math.max(count, 0) : undefined;
}

function resolveNumberOptions(type: NumberInputType): number[] | undefined {
  const count = numberOptionCount(type);
  if (count === undefined) return undefined;
  const low = Math.ceil(type.min!);
  return Array.from({ length: count }, (_, i) => low + i);
}

/** Resolve the valid gamepiece IDs for a gamepiece-select input. */
function resolveGamepieceOptions(
  state: GameExecutionState,
  type: GamepieceSelectInputType,
  actorId?: string,
  collected?: CollectedInputs,
): string[] | undefined {
  const { session } = state;
  const invConfig = session.config.inventories[type.inventory];
  const scope = invConfig?.scope ?? "game";

  let playerId: string | undefined;
  if (scope === "player") {
    if (type.fromPlayer && type.fromPlayer !== "self") {
      const paramId = type.fromPlayer.param;
      const owner = collected?.[paramId];
      if (typeof owner !== "string" || !session.players.includes(owner)) {
        throw new Error(
          `gamepiece-select fromPlayer param "${paramId}" does not resolve to a player ` +
            `(got ${JSON.stringify(owner)}); it must reference an earlier player-select input`,
        );
      }
      playerId = owner;
    } else {
      if (!actorId) return undefined;
      playerId = actorId;
    }
  }

  const inv = getInventory(session, type.inventory, playerId);
  if (!inv) return undefined;

  let ids = inv.select("all");
  if (type.ofType) {
    ids = ids.filter(
      (id) => session.state.gamepieces[id]?.typeId === type.ofType,
    );
  }
  if (type.filter) {
    ids = ids.filter((id) => type.filter!(session, id, actorId, collected));
  }
  return ids;
}
