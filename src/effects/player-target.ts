// ---------------------------------------------------------------------------
// Player target resolution
//
// Resolves a PlayerTarget from an effect definition to a concrete list of
// player IDs. Used by set-state (and future player-scoped effects) to
// determine which player(s) an effect applies to.
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext, PlayerId } from '#chaincraft/types.js';
import { getInventory } from '#chaincraft/inventory/index.js';
import { getPlayerState } from '#chaincraft/state/accessors.js';
import { resolveStateVar } from './resolve-value.js';

// ---------------------------------------------------------------------------
// PlayerTarget types (mirrors gamedef PlayerTargetSchema)
// ---------------------------------------------------------------------------

/** Recursive JSONLogic value — mirrors gamedef JsonLogicValue */
export type JsonLogicValue =
  | string
  | number
  | boolean
  | null
  | JsonLogicValue[]
  | { [op: string]: JsonLogicValue };

export type PlayerTarget =
  | { kind: 'actor' }
  | { kind: 'all' }
  | { kind: 'all-other' }
  | { kind: 'param'; inputId: string }
  | { kind: 'stateRef'; path: string }
  | { kind: 'matching'; condition: JsonLogicValue };

/**
 * Resolve a dynamic player reference ({ stateRef } or { param }) to a single
 * concrete validated player ID, or undefined if the reference cannot be resolved
 * or the resolved value is not a known player in the session.
 *
 * Used by move and gamepiece-selector to target a specific player dynamically.
 */
export function resolvePlayerRef(
  session: GameSession,
  ctx: EffectContext,
  ref: { stateRef: string } | { param: string },
): PlayerId | undefined {
  let val: unknown;
  if ('stateRef' in ref) {
    val = resolveStateVar(session, ctx, ref.stateRef);
  } else if ('param' in ref) {
    val = ctx.actionInputs[ref.param];
  }
  if (typeof val !== 'string') return undefined;
  if (!session.state.players[val]) return undefined;
  return val as PlayerId;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

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
      evaluateJsonLogic(target.condition, buildPlayerData(session, playerId)),
    );
  }

  throw new Error(`Unknown player target kind: ${(target as PlayerTarget).kind}`);
}

// ---------------------------------------------------------------------------
// Per-player data context for JsonLogic evaluation
// ---------------------------------------------------------------------------

/**
 * Build the JsonLogic data object for a single player.
 *
 * Available vars:
 *   player.property.<id>         — stored + computed state properties
 *   player.inventory.<id>.count  — total piece count in a player-scoped inventory
 */
function buildPlayerData(session: GameSession, playerId: string): Record<string, unknown> {
  const player = session.state.players[playerId];
  if (!player) return {};

  // getPlayerState merges stored + computed properties
  const properties = getPlayerState(session, playerId) as Record<string, unknown>;

  // Expose inventory total counts
  const inventory: Record<string, { count: number }> = {};
  for (const invId of Object.keys(player.inventories)) {
    const inv = getInventory(session, invId, playerId);
    inventory[invId] = { count: inv ? inv.count() : 0 };
  }

  return { player: { property: properties, inventory } };
}

// ---------------------------------------------------------------------------
// Minimal JSONLogic evaluator
//
// Supports: var, ==, !=, >, >=, <, <=, and, or, !, not
// ---------------------------------------------------------------------------

function evaluateJsonLogic(expr: JsonLogicValue, data: Record<string, unknown>): boolean {
  return Boolean(evalExpr(expr, data));
}

function evalExpr(expr: JsonLogicValue, data: Record<string, unknown>): unknown {
  // Primitives pass through
  if (expr === null || typeof expr !== 'object' || Array.isArray(expr)) {
    return expr;
  }

  const keys = Object.keys(expr as object);
  if (keys.length !== 1) return expr;

  const op = keys[0];
  const raw = (expr as Record<string, JsonLogicValue>)[op];
  const args = Array.isArray(raw) ? raw : [raw];

  switch (op) {
    case 'var': {
      const path = String(args[0] ?? '');
      return resolveDotPath(data, path);
    }
    case '==':  return evalExpr(args[0], data) == evalExpr(args[1], data);   // intentional ==
    case '!=':  return evalExpr(args[0], data) != evalExpr(args[1], data);   // intentional !=
    case '>':   return (evalExpr(args[0], data) as number) >  (evalExpr(args[1], data) as number);
    case '>=':  return (evalExpr(args[0], data) as number) >= (evalExpr(args[1], data) as number);
    case '<':   return (evalExpr(args[0], data) as number) <  (evalExpr(args[1], data) as number);
    case '<=':  return (evalExpr(args[0], data) as number) <= (evalExpr(args[1], data) as number);
    case 'and': return args.every((a) => Boolean(evalExpr(a, data)));
    case 'or':  return args.some((a)  => Boolean(evalExpr(a, data)));
    case '!':
    case 'not': return !Boolean(evalExpr(args[0], data));
    default:    return undefined;
  }
}

function resolveDotPath(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data;
  for (const segment of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
