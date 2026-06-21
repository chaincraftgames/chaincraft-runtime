// ---------------------------------------------------------------------------
// Typed state accessors — runtime implementations
//
// These functions are the single choke-point for all state reads and writes.
// Generated code calls them with per-game branded interfaces for compile-time
// safety; at runtime they validate constraints from the GameConfig and throw
// StateAccessError on violations so the LLM repair loop can diagnose issues.
// ---------------------------------------------------------------------------

import type {
  GameSession,
  GameStateBase,
  PlayerStateBase,
  GamepieceStateBase as GamepieceStateBase,
  PropertyConfig,
  ComputedPropertyConfig,
} from '#chaincraft/types.js';

import { StateAccessError } from '#chaincraft/state/errors.js';
import { getInventory } from '#chaincraft/inventory/index.js';

// ---------------------------------------------------------------------------
// Internal: property-constraint validation
// ---------------------------------------------------------------------------

function validateProperty(
  config: PropertyConfig,
  path: string,
  value: unknown,
): void {
  if (!config.mutable) {
    throw new StateAccessError(
      'immutable',
      path,
      `Property "${path}" is not mutable`,
    );
  }

  if (typeof value === 'number') {
    if (config.min !== undefined && value < config.min) {
      throw new StateAccessError(
        'out-of-range',
        path,
        `Property "${path}" value ${value} is below minimum ${config.min}`,
      );
    }
    if (config.max !== undefined && value > config.max) {
      throw new StateAccessError(
        'out-of-range',
        path,
        `Property "${path}" value ${value} is above maximum ${config.max}`,
      );
    }
  }

  if (config.enumValues && !config.enumValues.includes(value as string)) {
    throw new StateAccessError(
      'invalid-enum',
      path,
      `Property "${path}" value "${String(value)}" is not in allowed values: [${config.enumValues.join(', ')}]`,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal: computed property evaluation
// ---------------------------------------------------------------------------

function evaluateComputed(
  session: GameSession,
  computed: ComputedPropertyConfig,
  inventoryId: string,
  playerId?: string,
): unknown {
  const inv = getInventory(session, inventoryId, playerId);
  if (!inv) {
    return computedDefault(computed.aggregate);
  }

  let pieceIds = inv.select('all');

  // Filter by piece type if specified
  if (computed.ofType) {
    pieceIds = pieceIds.filter((id) => {
      const piece = session.state.gamepieces[id];
      return piece && piece.typeId === computed.ofType;
    });
  }

  switch (computed.aggregate) {
    case 'count':
      return pieceIds.length;

    case 'exists':
      return pieceIds.length > 0;

    case 'sum': {
      const prop = computed.property!;
      return pieceIds.reduce((sum, id) => {
        const piece = session.state.gamepieces[id];
        const val = piece?.properties[prop];
        return sum + (typeof val === 'number' ? val : 0);
      }, 0);
    }

    case 'min': {
      const prop = computed.property!;
      let result = Infinity;
      for (const id of pieceIds) {
        const piece = session.state.gamepieces[id];
        const val = piece?.properties[prop];
        if (typeof val === 'number' && val < result) result = val;
      }
      return result === Infinity ? 0 : result;
    }

    case 'max': {
      const prop = computed.property!;
      let result = -Infinity;
      for (const id of pieceIds) {
        const piece = session.state.gamepieces[id];
        const val = piece?.properties[prop];
        if (typeof val === 'number' && val > result) result = val;
      }
      return result === -Infinity ? 0 : result;
    }

    default:
      return computedDefault(computed.aggregate);
  }
}

function computedDefault(aggregate: string): unknown {
  switch (aggregate) {
    case 'count':
    case 'sum':
    case 'min':
    case 'max':
      return 0;
    case 'exists':
      return false;
    default:
      return 0;
  }
}

/**
 * Build a lookup of computed property configs for a given properties record.
 */
function getComputedConfigs(
  configs: Record<string, PropertyConfig>,
): Record<string, ComputedPropertyConfig> {
  const result: Record<string, ComputedPropertyConfig> = {};
  for (const [key, config] of Object.entries(configs)) {
    if (config.computed) {
      result[key] = config.computed;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Game state accessors
// ---------------------------------------------------------------------------

/** Read game-scoped state as a typed readonly projection. */
export function getGameState<T extends GameStateBase>(
  session: GameSession,
): Readonly<T> {
  const computed = getComputedConfigs(session.config.gameProperties);
  if (Object.keys(computed).length === 0) {
    return session.state.gameProperties as Readonly<T>;
  }

  // Overlay computed values on top of stored state
  const overlay: Record<string, unknown> = {};
  for (const [key, config] of Object.entries(computed)) {
    overlay[key] = evaluateComputed(session, config, config.inventory);
  }

  return { ...session.state.gameProperties, ...overlay } as Readonly<T>;
}

/** Write a game-scoped state property with compile-time key + value safety. */
export function setGameState<
  T extends GameStateBase,
  K extends keyof T & string,
>(
  session: GameSession,
  key: K,
  value: T[K],
): void {
  const config = session.config.gameProperties[key];
  if (config?.computed) {
    throw new StateAccessError(
      'immutable',
      `game.${key}`,
      `Property "game.${key}" is computed and cannot be written to`,
    );
  }
  if (config) {
    validateProperty(config, `game.${key}`, value);
  }
  session.state.gameProperties[key] = value;
}

// ---------------------------------------------------------------------------
// Player state accessors
// ---------------------------------------------------------------------------

/** Read a player's state as a typed readonly projection. */
export function getPlayerState<T extends PlayerStateBase>(
  session: GameSession,
  playerId: string,
): Readonly<T> {
  const player = session.state.players[playerId];
  if (!player) {
    throw new StateAccessError(
      'not-found',
      `player.${playerId}`,
      `Player "${playerId}" not found in session`,
    );
  }

  const computed = getComputedConfigs(session.config.playerProperties);
  if (Object.keys(computed).length === 0) {
    return player.properties as Readonly<T>;
  }

  // Overlay computed values on top of stored state
  const overlay: Record<string, unknown> = {};
  for (const [key, config] of Object.entries(computed)) {
    overlay[key] = evaluateComputed(session, config, config.inventory, playerId);
  }

  return { ...player.properties, ...overlay } as Readonly<T>;
}

/** Write a player-scoped state property with compile-time key + value safety. */
export function setPlayerState<
  T extends PlayerStateBase,
  K extends keyof T & string,
>(
  session: GameSession,
  playerId: string,
  key: K,
  value: T[K],
): void {
  const player = session.state.players[playerId];
  if (!player) {
    throw new StateAccessError(
      'not-found',
      `player.${playerId}`,
      `Player "${playerId}" not found in session`,
    );
  }
  const config = session.config.playerProperties[key];
  if (config?.computed) {
    throw new StateAccessError(
      'immutable',
      `player.${playerId}.${key}`,
      `Property "player.${playerId}.${key}" is computed and cannot be written to`,
    );
  }
  if (config) {
    validateProperty(config, `player.${playerId}.${key}`, value);
  }
  player.properties[key] = value;
}

// ---------------------------------------------------------------------------
// Piece state accessors
// ---------------------------------------------------------------------------

/** Read a gamepiece's properties as a typed readonly projection. */
export function getGamepieceState<T extends GamepieceStateBase>(
  session: GameSession,
  pieceId: string,
): Readonly<T> {
  const piece = session.state.gamepieces[pieceId];
  if (!piece) {
    throw new StateAccessError(
      'not-found',
      `piece.${pieceId}`,
      `Piece "${pieceId}" not found in session`,
    );
  }
  return piece.properties as Readonly<T>;
}

/** Write a gamepiece property with compile-time key + value safety. */
export function setPieceState<
  T extends GamepieceStateBase,
  K extends keyof T & string,
>(
  session: GameSession,
  pieceId: string,
  key: K,
  value: T[K],
): void {
  const piece = session.state.gamepieces[pieceId];
  if (!piece) {
    throw new StateAccessError(
      'not-found',
      `piece.${pieceId}`,
      `Piece "${pieceId}" not found in session`,
    );
  }
  const typeConfig = session.config.gamepieceTypes[piece.typeId];
  const propConfig = typeConfig?.properties[key];
  if (propConfig) {
    validateProperty(propConfig, `piece.${pieceId}.${key}`, value);
  }
  piece.properties[key] = value;
}
