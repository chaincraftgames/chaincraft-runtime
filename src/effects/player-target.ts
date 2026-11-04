// ---------------------------------------------------------------------------
// Player target resolution
//
// Resolves a PlayerTarget from an effect definition to a concrete list of
// player IDs. Used by every player-scoped effect (set-state targets, selector
// players, move destinations, message/reveal recipients).
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';
import { resolveStateVar } from './resolve-value.js';

// ---------------------------------------------------------------------------
// PlayerTarget types (mirrors gamedef PlayerTargetSchema; `where` is compiled)
// ---------------------------------------------------------------------------

export type PlayerPredicate = (session: GameSession, playerId: string, actorId?: string) => boolean;

export type PlayerTarget =
  | 'actor'
  | 'all'
  | 'all-other'
  | { param: string }
  | { stateRef: string }
  | { where: PlayerPredicate }
  | { roles: string[] };

/**
 * Resolve a player target to a list of player IDs.
 *
 * @param session  The game session
 * @param ctx      The effect context (provides actorId and action inputs)
 * @param target   The player target descriptor (undefined = actor)
 * @returns        Array of player IDs the effect should apply to
 */
export function resolvePlayerTarget(
  session: GameSession,
  ctx: EffectContext,
  target: PlayerTarget | undefined,
): string[] {
  // Default: acting player
  if (target === undefined || target === 'actor') {
    if (!ctx.actorId) {
      throw new Error('Player target "actor" requires an actorId in the effect context');
    }
    return [ctx.actorId];
  }

  if (target === 'all') {
    return [...session.players];
  }

  if (target === 'all-other') {
    if (!ctx.actorId) {
      throw new Error('Player target "all-other" requires an actorId in the effect context');
    }
    return session.players.filter((id) => id !== ctx.actorId);
  }

  if (typeof target === 'object' && 'param' in target) {
    const playerId = ctx.actionInputs[target.param];
    if (typeof playerId !== 'string') {
      throw new Error(
        `Player target param "${target.param}" resolved to ${typeof playerId}, expected string player ID`,
      );
    }
    if (!session.state.players[playerId]) {
      throw new Error(`Player target param "${target.param}" resolved to unknown player "${playerId}"`);
    }
    return [playerId];
  }

  if (typeof target === 'object' && 'stateRef' in target) {
    const path = target.stateRef;
    if (!path.startsWith('game.property.') && !path.startsWith('player.property.')) {
      throw new Error(`Player target stateRef path "${path}" must be game.property.<id> or player.property.<id>`);
    }
    const playerId = resolveStateVar(session, ctx, path);
    if (typeof playerId !== 'string') {
      throw new Error(
        `Player target stateRef "${path}" resolved to ${typeof playerId}, expected string player ID`,
      );
    }
    if (!session.state.players[playerId]) {
      throw new Error(`Player target stateRef "${path}" resolved to unknown player "${playerId}"`);
    }
    return [playerId];
  }

  if (typeof target === 'object' && 'where' in target) {
    return session.players.filter((playerId) =>
      target.where(session, playerId, ctx.actorId ?? undefined),
    );
  }

  if (typeof target === 'object' && 'roles' in target) {
    return session.players.filter((playerId) =>
      session.state.players[playerId]?.roles.some((role) => target.roles.includes(role)),
    );
  }

  throw new Error(`Unknown player target: ${JSON.stringify(target)}`);
}


