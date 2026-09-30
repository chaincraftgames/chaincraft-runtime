import type { GameSession } from "#chaincraft/types.js";

/** Reserved player property injected by the compiler; eliminated players are skipped in turn order. */
export const ELIMINATED_PROPERTY = "eliminated";

export function isEliminated(session: GameSession, playerId: string): boolean {
  return session.state.players[playerId]?.properties[ELIMINATED_PROPERTY] === true;
}
