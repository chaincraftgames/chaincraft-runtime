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

import type { GameSession, EffectContext, PropertyConfig } from '#chaincraft/types.js';
import { resolveValue } from './resolve-value.js';
import type { PropertyValue } from './resolve-value.js';
import { resolvePlayerTarget } from './player-target.js';
import type { PlayerTarget } from './player-target.js';

type SetStateEffectDef = { path: string; value: PropertyValue; target?: PlayerTarget };

/**
 * Validate that a value written to a ref-typed property is a known entity ID.
 * Throws with a descriptive message when validation fails; no-ops when refType is unset.
 */
function validateRefValue(
  value: unknown,
  config: PropertyConfig | undefined,
  session: GameSession,
  path: string,
): void {
  if (!config?.refType || typeof value !== 'string') return;
  switch (config.refType) {
    case 'player-id':
      if (!session.state.players[value]) {
        throw new Error(
          `set-state "${path}": "${value}" is not a valid player ID (known: ${Object.keys(session.state.players).join(', ')})`,
        );
      }
      break;
    case 'player-role-id':
      if (session.config.roles && !session.config.roles.includes(value)) {
        throw new Error(
          `set-state "${path}": "${value}" is not a valid player role ID (known: ${session.config.roles.join(', ')})`,
        );
      }
      break;
    case 'gamepiece-id':
      if (!session.state.gamepieces[value]) {
        throw new Error(
          `set-state "${path}": "${value}" is not a valid gamepiece ID`,
        );
      }
      break;
  }
}

export async function executeSetState(
  session: GameSession,
  ctx: EffectContext<SetStateEffectDef>,
): Promise<void> {
  const { path, value: pv, target } = ctx.effectDef;

  const segments = path.split('.');

  if (segments[0] === 'game' && segments[1] === 'property') {
    const key = segments[2];
    const config = session.config.gameProperties[key];
    const current = session.state.gameProperties[key];
    const resolved = resolveValue(pv, current, session, ctx, config);
    validateRefValue(resolved, config, session, path);
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
      validateRefValue(resolved, config, session, path);
      player.properties[key] = resolved;
    }
  } else {
    throw new Error(`Invalid set-state path: "${path}". Expected game.property.<id> or player.property.<id>`);
  }
}
