// ---------------------------------------------------------------------------
// Effect executor: resolve-value
//
// Shared helper that resolves a PropertyValue (literal, delta, toggle, param,
// actor) to a concrete value given the current property value and the effect
// context. Used by set-state and update executors.
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';
import { getGameState, getPlayerState } from '#chaincraft/state/accessors.js';

/**
 * A PropertyValue as it appears in the resolved effect definition.
 * Matches the shapes from the gamedef PropertyValueSchema.
 */
export type PropertyValue =
  | string
  | number
  | boolean
  | { delta: number | { var: string; negate?: boolean } }
  | { mult: number | { var: string; negate?: boolean } }
  | { toggle: true }
  | { param: string }
  | { actor: true }
  | { var: string };

/**
 * A reference to a single gamepiece, resolved from action inputs or a literal ID.
 * Used by the `source` field on update/set-state effects.
 */
export type PieceRef = { param: string } | { id: string };

/**
 * Resolve a PieceRef to a concrete piece ID.
 */
export function resolvePieceRef(ctx: EffectContext, ref: PieceRef): string | undefined {
  if ('param' in ref) {
    const val = ctx.actionInputs[ref.param];
    return typeof val === 'string' ? val : undefined;
  }
  if ('id' in ref) {
    return ref.id;
  }
  return undefined;
}

/**
 * Resolve a PropertyValue to a concrete value.
 *
 * @param pv       The property-value descriptor from the effect def
 * @param current  The current value of the target property (needed for delta/toggle)
 * @param session  The game session (needed for var resolution)
 * @param ctx      The effect context (needed for param/actor resolution)
 * @param config   Optional property config for clamping delta results
 */
export function resolveValue(
  pv: PropertyValue,
  current: unknown,
  session: GameSession,
  ctx: EffectContext,
  config?: { min?: number; max?: number },
): unknown {
  // Literal values
  if (typeof pv === 'string' || typeof pv === 'number' || typeof pv === 'boolean') {
    return pv;
  }

  // Var reference: resolve from game state
  if ('var' in pv && typeof pv.var === 'string') {
    return resolveStateVar(session, ctx, pv.var);
  }

  // Delta: add to current numeric value
  if ('delta' in pv) {
    const base = typeof current === 'number' ? current : 0;
    let deltaAmount: number;
    if (typeof pv.delta === 'number') {
      deltaAmount = pv.delta;
    } else {
      const resolved = resolveStateVar(session, ctx, pv.delta.var);
      deltaAmount = typeof resolved === 'number' ? resolved : 0;
      if (pv.delta.negate) {
        deltaAmount = -deltaAmount;
      }
    }
    let result = base + deltaAmount;
    if (config?.min !== undefined && result < config.min) result = config.min;
    if (config?.max !== undefined && result > config.max) result = config.max;
    return result;
  }

  // Mult: multiply current numeric value by a factor
  if ('mult' in pv) {
    const base = typeof current === 'number' ? current : 0;
    let factor: number;
    if (typeof pv.mult === 'number') {
      factor = pv.mult;
    } else {
      const resolved = resolveStateVar(session, ctx, pv.mult.var);
      factor = typeof resolved === 'number' ? resolved : 0;
      if (pv.mult.negate) {
        factor = -factor;
      }
    }
    let result = Math.round(base * factor);
    if (config?.min !== undefined && result < config.min) result = config.min;
    if (config?.max !== undefined && result > config.max) result = config.max;
    return result;
  }

  // Toggle: flip boolean
  if ('toggle' in pv) {
    return !current;
  }

  // Param: resolve from action inputs
  if ('param' in pv) {
    return ctx.actionInputs[pv.param];
  }

  // Actor: resolve to the acting player's ID
  if ('actor' in pv) {
    return ctx.actorId;
  }

  return pv;
}

/**
 * Resolve a dot-path state reference to its value.
 *
 * Supported paths:
 *   game.property.<id>           — game-scoped property (stored or computed)
 *   player.property.<id>         — target player's property (stored or computed)
 *   game.inventory.<id>.count    — game-level inventory piece count
 *   player.inventory.<id>.count  — target player's inventory piece count
 *   source.property.<id>         — property on the source piece (from ctx.sourcePieceId)
 *   target.property.<id>         — property on the target piece (from ctx.targetPieceId)
 */
export function resolveStateVar(session: GameSession, ctx: EffectContext, path: string): unknown {
  const segments = path.split('.');

  // source.property.<id> — property on the source/triggering piece
  if (segments[0] === 'source' && segments[1] === 'property') {
    if (!ctx.sourcePieceId) return undefined;
    const piece = session.state.gamepieces[ctx.sourcePieceId];
    return piece?.properties[segments[2]];
  }

  // target.property.<id> — property on the current target piece (update loops)
  if (segments[0] === 'target' && segments[1] === 'property') {
    if (!ctx.targetPieceId) return undefined;
    const piece = session.state.gamepieces[ctx.targetPieceId];
    return piece?.properties[segments[2]];
  }

  // game.property.<id>
  if (segments[0] === 'game' && segments[1] === 'property') {
    const gameState = getGameState(session) as Record<string, unknown>;
    return gameState[segments[2]];
  }

  // player.property.<id>
  if (segments[0] === 'player' && segments[1] === 'property') {
    const playerId = ctx.targetPlayerId ?? ctx.actorId;
    if (!playerId) return undefined;
    const playerState = getPlayerState(session, playerId) as Record<string, unknown>;
    return playerState[segments[2]];
  }

  // game.inventory.<id>.count
  if (segments[0] === 'game' && segments[1] === 'inventory' && segments[3] === 'count') {
    const invId = segments[2];
    const invData = session.state.gameInventories[invId];
    if (!invData) return 0;
    // Count the non-null entries (structure-agnostic)
    if ('pieceIds' in invData) {
      return invData.pieceIds.length;
    }
    if ('slots' in invData) {
      return invData.slots.filter(s => s !== null).length;
    }
    if ('cells' in invData) {
      return Object.values(invData.cells).length;
    }
    if ('nodes' in invData) {
      return Object.values(invData.nodes).flat().length;
    }
    return 0;
  }

  // player.inventory.<id>.count
  if (segments[0] === 'player' && segments[1] === 'inventory' && segments[3] === 'count') {
    const playerId = ctx.targetPlayerId ?? ctx.actorId;
    if (!playerId) return 0;
    const player = session.state.players[playerId];
    if (!player) return 0;
    const invId = segments[2];
    const invData = player.inventories[invId];
    if (!invData) return 0;
    // Count the non-null entries (structure-agnostic)
    if ('pieceIds' in invData) {
      return invData.pieceIds.length;
    }
    if ('slots' in invData) {
      return invData.slots.filter(s => s !== null).length;
    }
    if ('cells' in invData) {
      return Object.values(invData.cells).length;
    }
    if ('nodes' in invData) {
      return Object.values(invData.nodes).flat().length;
    }
    return 0;
  }

  return undefined;
}
