// ---------------------------------------------------------------------------
// Turn order — resolves the next batch of eligible actors for a turn node.
//
// Called fresh on every advanceFlow call during the acting phase so that
// state-driven changes (reversals, dynamic starting player) take effect
// immediately without cache invalidation.
//
// STATUS: Stubbed. The core dispatch table is in place but most ordering
// variants are only partially implemented. See TODOs per case.
//
// Ordering kinds:
//   round-robin  — players act one at a time in session index order.
//                  TODO: startPath, reversedPath (snake-draft), roleIds, sort.
//   simultaneous — all eligible players act in the same fork.
//                  TODO: roleIds filter.
//   single       — exactly one player acts, identified by a state-ref or role.
//                  TODO: role → player ID mapping.
//   custom        — escape hatch; delegates to a named resolver registered on
//                  the compiled module.
//                  TODO: custom resolver dispatch.
// ---------------------------------------------------------------------------

import type { TurnOrdering, GameSession } from "#chaincraft/types.js";
import type { GameExecutionState, PlayerTurnCursor } from "./types.js";

/**
 * Resolves which players should act next given the current ordering and cursor
 * state. Returns an empty array when all eligible actors are done.
 */
export function resolveNextEligibleActors(
  ordering: TurnOrdering,
  state: GameExecutionState,
  cursors: Record<string, PlayerTurnCursor>,
): string[] {
  const notDone = (id: string) => {
    const c = cursors[id];
    return !c || !c.done;
  };

  switch (ordering.kind) {
    case "round-robin": {
      // TODO: apply startPath (starting player state-ref), reversedPath
      // (snake-draft reversal flag), roleIds (restrict to role subset), sort
      // (dynamic ordering key). For now: first not-done player in session
      // index order.
      const next = state.session.players.find(notDone);
      return next ? [next] : [];
    }

    case "simultaneous": {
      // TODO: apply roleIds filter (restrict simultaneous fork to a role
      // subset rather than all players).
      return state.session.players.filter(notDone);
    }

    case "single": {
      if (ordering.actor.kind === "state-ref") {
        const playerId = readStatePath(state.session, ordering.actor.path);
        if (typeof playerId !== "string") {
          throw new Error(
            `Turn ordering state-ref "${ordering.actor.path}" did not resolve to a player ID`,
          );
        }
        return notDone(playerId) ? [playerId] : [];
      }
      // TODO: resolve role → player ID via module role registry.
      throw new Error("Role-based actor resolution not yet implemented");
    }

    case "custom":
      // TODO: look up ordering.resolverId in module.turnOrderResolvers and
      // invoke it with (state, cursors).
      throw new Error(
        `Custom turn ordering "${ordering.resolverId}" not yet implemented`,
      );
  }
}

// ---------------------------------------------------------------------------
// State path helpers — used by turn-order state-refs and loop writeIterationTo.
// Path format: 'game.property.<id>'
//
// TODO: extend to player properties ('player.<id>.property.<key>'),
// inventory counts, and arbitrary nested paths as the state model matures.
// ---------------------------------------------------------------------------

/** Reads a value from the given dot-path within the session state. */
export function readStatePath(session: GameSession, path: string): unknown {
  const parts = path.split(".");
  if (parts[0] === "game" && parts[1] === "property" && parts.length === 3) {
    return session.state.gameProperties[parts[2]];
  }
  throw new Error(`readStatePath: unsupported path format "${path}"`);
}

/** Writes a value to the given dot-path within the session state. */
export function writeStatePath(
  session: GameSession,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  if (parts[0] === "game" && parts[1] === "property" && parts.length === 3) {
    (session.state.gameProperties as Record<string, unknown>)[parts[2]] = value;
    return;
  }
  throw new Error(`writeStatePath: unsupported path format "${path}"`);
}
