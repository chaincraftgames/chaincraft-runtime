// ---------------------------------------------------------------------------
// Effect executor: set-state
//
// Writes a value to a game or player state property identified by a dot-path.
// Path format:
//   game.property.<id>   → game-scoped property
//   player.property.<id> → target player(s) per-player property
//
// When path targets a player property, the optional `target` field determines
// which player(s) are affected. Defaults to the acting player when omitted.
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';
import { resolveValue } from './resolve-value.js';
import { resolvePlayerTarget } from './player-target.js';
import type { PlayerTarget } from './player-target.js';

export async function executeSetState(
  session: GameSession,
  ctx: EffectContext,
): Promise<void> {
  const def = ctx.effectDef;
  const path = def['path'] as string;
  const pv = def['value'] as import('./resolve-value.js').PropertyValue;
  const target = def['target'] as PlayerTarget | undefined;

  const segments = path.split('.');

  if (segments[0] === 'game' && segments[1] === 'property') {
    const key = segments[2];
    const config = session.config.gameProperties[key];
    const current = session.state.gameProperties[key];
    const resolved = resolveValue(pv, current, session, ctx, config);
    session.state.gameProperties[key] = resolved;
  } else if (segments[0] === 'player' && segments[1] === 'property') {
    const key = segments[2];
    const playerIds = resolvePlayerTarget(session, ctx, target);

    for (const playerId of playerIds) {
      const player = session.state.players[playerId];
      if (!player) {
        throw new Error(`Player "${playerId}" not found in session`);
      }
      const config = session.config.playerProperties[key];
      const current = player.properties[key];
      const resolved = resolveValue(pv, current, session, { ...ctx, targetPlayerId: playerId }, config);
      player.properties[key] = resolved;
    }
  } else {
    throw new Error(`Invalid set-state path: "${path}". Expected game.property.<id> or player.property.<id>`);
  }
}
