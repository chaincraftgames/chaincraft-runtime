// ---------------------------------------------------------------------------
// Player target resolution
//
// Resolves a PlayerTarget from an effect definition to a concrete list of
// player IDs. Used by set-state (and future player-scoped effects) to
// determine which player(s) an effect applies to.
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';
import { resolveStateVar } from './resolve-value.js';

// ---------------------------------------------------------------------------
// PlayerTarget types (mirrors gamedef PlayerTargetSchema)
// ---------------------------------------------------------------------------

export type PlayerTarget =
  | { kind: 'actor' }
  | { kind: 'all' }
  | { kind: 'all-other' }
  | { kind: 'param'; inputId: string }
  | { kind: 'stateRef'; path: string }
  | { kind: 'matching'; condition: (session: GameSession, playerId: string, actorId?: string) => boolean };

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
  if (!target || target.kind === 'actor') {
    if (!ctx.actorId) {
      throw new Error('Player target "actor" requires an actorId in the effect context');
    }
    return [ctx.actorId];
  }

  if (target.kind === 'all') {
    return [...session.players];
  }

  if (target.kind === 'all-other') {
    if (!ctx.actorId) {
      throw new Error('Player target "all-other" requires an actorId in the effect context');
    }
    return session.players.filter((id) => id !== ctx.actorId);
  }

  if (target.kind === 'param') {
    const playerId = ctx.actionInputs[target.inputId];
    if (typeof playerId !== 'string') {
      throw new Error(
        `Player target param "${target.inputId}" resolved to ${typeof playerId}, expected string player ID`,
      );
    }
    if (!session.state.players[playerId]) {
      throw new Error(`Player target param "${target.inputId}" resolved to unknown player "${playerId}"`);
    }
    return [playerId];
  }

  if (target.kind === 'stateRef') {
    if (!target.path.startsWith('game.property.') && !target.path.startsWith('player.property.')) {
      throw new Error(`Player target stateRef path "${target.path}" must be game.property.<id> or player.property.<id>`);
    }
    const playerId = resolveStateVar(session, ctx, target.path);
    if (typeof playerId !== 'string') {
      throw new Error(
        `Player target stateRef "${target.path}" resolved to ${typeof playerId}, expected string player ID`,
      );
    }
    if (!session.state.players[playerId]) {
      throw new Error(`Player target stateRef "${target.path}" resolved to unknown player "${playerId}"`);
    }
    return [playerId];
  }

  if (target.kind === 'matching') {
    return session.players.filter((playerId) =>
      target.condition(session, playerId, ctx.actorId ?? undefined),
    );
  }

  throw new Error(`Unknown player target kind: ${(target as PlayerTarget).kind}`);
}


