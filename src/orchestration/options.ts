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

import type { GamepieceSelectInputType } from "#chaincraft/types.js";
import type {
  GameExecutionState,
  EngineInput,
} from "#chaincraft/orchestration/types.js";
import { getInventory } from "#chaincraft/inventory/index.js";

/** Determine the valid choices for a player-input prompt. */
export function resolveOptions(
  state: GameExecutionState,
  input: EngineInput,
  actorId?: string,
): unknown[] | undefined {
  const type = input.type;

  switch (type.kind) {
    case "enum":
      return [...type.values];

    case "boolean":
      return [true, false];

    case "player-select": {
      let ids = [...state.session.players];
      if (type.excludeSelf && actorId) ids = ids.filter((id) => id !== actorId);
      if (type.filter)
        ids = ids.filter((id) => type.filter!(state.session, id, actorId));
      return ids;
    }

    case "gamepiece-select":
      return resolveGamepieceOptions(state, type, actorId);

    // Free-form or engine-resolved elsewhere: no finite options.
    // ('action-select' options are supplied by the player runner, which owns
    // the grammar; this resolver never sees them.)
    default:
      return undefined;
  }
}

/** Resolve the valid gamepiece IDs for a gamepiece-select input. */
function resolveGamepieceOptions(
  state: GameExecutionState,
  type: GamepieceSelectInputType,
  actorId?: string,
): unknown[] | undefined {
  const { session } = state;
  const invConfig = session.config.inventories[type.inventory];
  const scope = invConfig?.scope ?? "game";

  // Player-scoped inventory: resolve against the actor (fromPlayer: 'self' or
  // unset). fromPlayer: { param } would need the group's collected inputs,
  // which this signature doesn't carry — return undefined (free-form) rather
  // than a wrong finite list that resume validation would enforce.
  let playerId: string | undefined;
  if (scope === "player") {
    if (type.fromPlayer && type.fromPlayer !== "self") return undefined;
    if (!actorId) return undefined;
    playerId = actorId;
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
    ids = ids.filter((id) => type.filter!(session, id, actorId));
  }
  return ids;
}
