// ---------------------------------------------------------------------------
// Turn order — resolves the next batch of eligible actors for a turn node.
//
// Called fresh on every advanceFlow call during the acting phase. The starting
// player is resolved once per turn node entry (resolveStartPlayer) and passed in.
//
// Eliminated players (player.property.eliminated === true) are never eligible.
//
// Ordering kinds:
//   round-robin  — players act one at a time in clockwise seat order from the
//                  start player (seat 1 when no start selector).
//                  TODO: reversedPath (snake-draft), roleIds, sort.
//   simultaneous — all eligible players act in the same fork.
//                  TODO: roleIds filter.
//   single       — exactly one player acts: the start player.
//   custom        — escape hatch; delegates to a named resolver registered on
//                  the compiled module.
//                  TODO: custom resolver dispatch.
//
// Player selectors: only state-ref is implemented. An eliminated or empty
// anchor falls through to the next non-eliminated seat clockwise.
// ---------------------------------------------------------------------------

import type {
  TurnOrdering,
  GameSession,
  PlayerSelector,
} from "#chaincraft/types.js";
import { isEliminated } from "#chaincraft/state/elimination.js";
import type {
  GameExecutionState,
  PlayerTurnCursor,
} from "#chaincraft/orchestration/types.js";

/**
 * Resolves which players should act next given the current ordering and cursor
 * state. Returns an empty array when all eligible actors are done.
 * `startPlayer` comes from resolveStartPlayer, captured once when the turn node starts.
 */
export function resolveNextEligibleActors(
  ordering: TurnOrdering,
  state: GameExecutionState,
  cursors: Record<string, PlayerTurnCursor>,
  startPlayer: string | null,
): string[] {
  const eligible = (id: string) => {
    const c = cursors[id];
    return (!c || !c.done) && !isEliminated(state.session, id);
  };

  switch (ordering.kind) {
    case "round-robin": {
      // TODO: apply reversedPath (snake-draft reversal flag), roleIds
      // (restrict to role subset), sort (dynamic ordering key).
      if (startPlayer === null) return [];
      const players = state.session.players;
      const next = seatOrderFrom(players, players.indexOf(startPlayer)).find(
        eligible,
      );
      return next ? [next] : [];
    }

    case "simultaneous": {
      // TODO: apply roleIds filter (restrict simultaneous fork to a role
      // subset rather than all players).
      return state.session.players.filter(eligible);
    }

    case "single":
      return startPlayer !== null && eligible(startPlayer) ? [startPlayer] : [];

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

/** Starting player for a turn node, read once on entry; null when no player is eligible. */
export function resolveStartPlayer(
  ordering: TurnOrdering,
  session: GameSession,
): string | null {
  if (ordering.kind === "round-robin")
    return firstEligibleFrom(session, ordering.start);
  if (ordering.kind === "single")
    return firstEligibleFrom(session, ordering.actor);
  return null;
}

function firstEligibleFrom(
  session: GameSession,
  sel: PlayerSelector | undefined,
): string | null {
  const anchor = sel ? selectAnchor(session, sel) : null;
  const from = anchor ? session.players.indexOf(anchor) : 0;
  return (
    seatOrderFrom(session.players, from).find(
      (p) => !isEliminated(session, p),
    ) ?? null
  );
}

function selectAnchor(
  session: GameSession,
  sel: PlayerSelector,
): string | null {
  const v = readStatePath(session, sel.path);
  if (v === "" || v == null) return null;
  if (typeof v !== "string" || !session.players.includes(v)) {
    throw new Error(
      `Player selector "${sel.path}" = ${JSON.stringify(v)} is not a player in this session`,
    );
  }
  return v;
}

function seatOrderFrom(players: string[], from: number): string[] {
  return [...players.slice(from), ...players.slice(0, from)];
}
