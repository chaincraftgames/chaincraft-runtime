// ---------------------------------------------------------------------------
// State projection — produces a per-viewer subset of game state that respects
// all visibility rules (inventory, piece, property, and role visibility).
//
// This is a pure function of (session, viewerId) — deterministic, no side effects.
// The server calls this to build sync payloads for each connected player.
// ---------------------------------------------------------------------------

import type {
  GameSession,
  GameState,
  Gamepiece,
  InventoryConfig,
  InventoryData,
  GamepiecePropertyConfig,
  GamepiecePropertyVisibility,
  PropertyConfig,
  StatePropertyVisibility,
} from '#chaincraft/types.js';

// ---------------------------------------------------------------------------
// Output types — projected state from a specific player's perspective
// ---------------------------------------------------------------------------

/** 
 * A projected view of an inventory, respecting visibility rules. 
 * Either contains the full inventory data, or a redacted view (count-only or hidden).
 */
export type ProjectedInventory =
  | InventoryData
  | { redacted: 'count-only'; count: number }
  | { redacted: 'hidden' };

/** A projected view of a gamepiece, respecting visibility rules. */  
export interface ProjectedGamepiece {
  typeId: string;
  ownerId: string;
  properties: Record<string, unknown>;
  faceUp: boolean;
  faceValue?: number;
  orientationIndex?: number;
  exhausted: boolean;
};

/** A projected view of a player's state, respecting visibility rules. */
export interface ProjectedPlayerState {
  properties: Record<string, unknown>;
  inventories: Record<string, ProjectedInventory>;
};

/** A projected view of the entire game state, respecting visibility rules. */
export interface ProjectedState {
  gameProperties: Record<string, unknown>;
  gameInventories: Record<string, ProjectedInventory>;
  players: Record<string, ProjectedPlayerState>;
  /** Only pieces the viewer is allowed to see. Hidden pieces are omitted entirely. */
  gamepieces: Record<string, ProjectedGamepiece>;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolve the effective visibility for a piece given its override and inventory config. */
function canViewerSeePiece(
  piece: Gamepiece,
  inventoryConfig: InventoryConfig | undefined,
  inventoryOwnerId: string | undefined,
  viewerId: string,
): boolean {
  // Explicit per-piece override takes priority
  if (piece.visibleTo !== null) {
    if (piece.visibleTo === 'all') return true;
    return piece.visibleTo.includes(viewerId);
  }

  // Fall back to inventory visibility
  if (!inventoryConfig) return true; // no config = assume visible
  switch (inventoryConfig.visibility) {
    case 'always': return true;
    case 'never': return false;
    case 'owner': return viewerId === inventoryOwnerId;
    case 'count-only': return false; // piece identity hidden; count shown at inventory level
    case 'revealed': return piece.faceUp;
  }
}

/** Count pieces in an inventory data structure. */
function inventoryPieceCount(data: InventoryData): number {
  switch (data.structure) {
    case 'none':
    case 'stack':
      return data.pieceIds.length;
    case 'line':
      return data.slots.filter((s) => s !== null).length;
    case 'grid':
      return Object.values(data.cells).filter((s) => s !== null).length;
    case 'graph':
      return Object.values(data.nodes).filter((s) => s !== null).length;
  }
}

/** Project an inventory's contents based on visibility rules. */
function projectInventory(
  data: InventoryData,
  config: InventoryConfig | undefined,
  ownerId: string | undefined,
  viewerId: string,
): ProjectedInventory {
  if (!config) return data; // no config = full visibility

  const visibility = config.visibility;
  const isOwner = viewerId === ownerId;

  switch (visibility) {
    case 'always':
      return data;
    case 'owner':
      return isOwner ? data : { redacted: 'count-only', count: inventoryPieceCount(data) };
    case 'count-only':
      return { redacted: 'count-only', count: inventoryPieceCount(data) };
    case 'never':
      return { redacted: 'hidden' };
    case 'revealed':
      // For game/player-scoped inventories, 'revealed' behaves like 'always'
      // (there's no face-down state on the container). Piece-scoped inventories
      // would check the owning piece's faceUp — handled at the piece level.
      return data;
  }
}

/** Filter gamepiece properties based on visibility config, owner, and face state. */
function projectGamepieceProperties(
  properties: Record<string, unknown>,
  configs: Record<string, GamepiecePropertyConfig>,
  ownerId: string,
  viewerId: string,
  faceUp: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    const visibility: GamepiecePropertyVisibility = configs[key]?.visibility ?? 'always';
    switch (visibility) {
      case 'always':
        result[key] = value;
        break;
      case 'owner':
        if (viewerId === ownerId) result[key] = value;
        break;
      case 'revealed':
        if (faceUp) result[key] = value;
        break;
      case 'never':
        break;
    }
  }
  return result;
}

/** Check if a role value is visible to the viewer. */
function isRoleVisible(
  roleId: string,
  holderId: string,
  viewerId: string,
  session: GameSession,
): boolean {
  const visibility = session.config.roleVisibility?.[roleId] ?? 'public';
  if (visibility === 'public') return true;
  // Hidden roles are visible only to the holder
  return viewerId === holderId;
}

/** Get the roles of a player. */
function getRoles(session: GameSession, playerId: string): string[] {
  return session.state.players[playerId]?.roles ?? [];
}

/** Filter player properties, handling role-typed properties specially. */
function projectPlayerProperties(
  properties: Record<string, unknown>,
  configs: Record<string, PropertyConfig>,
  playerId: string,
  viewerId: string,
  session: GameSession,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Lazily computed — only needed when a same-role property is encountered
  let viewerRoles: string[] | undefined;
  let targetRoles: string[] | undefined;

  for (const [key, value] of Object.entries(properties)) {
    const config = configs[key];
    const visibility: StatePropertyVisibility = config?.visibility ?? 'public';

    let visible = false;
    switch (visibility) {
      case 'public':
        visible = true;
        break;
      case 'private':
        visible = viewerId === playerId;
        break;
      case 'same-role': {
        if (viewerId === playerId) {
          visible = true;
        } else {
          viewerRoles ??= getRoles(session, viewerId);
          targetRoles ??= getRoles(session, playerId);
          visible = viewerRoles.some((r) => targetRoles!.includes(r));
        }
        break;
      }
      case 'never':
        visible = false;
        break;
    }
    if (!visible) continue;

    // For role-ref properties, additionally check role visibility
    if (config?.refType === 'player-role-id' && typeof value === 'string' && value) {
      if (!isRoleVisible(value, playerId, viewerId, session)) continue;
    }

    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Piece-to-inventory reverse index
// ---------------------------------------------------------------------------
/** The location of a piece within an inventory. */
type PieceLocation = {
  inventoryId: string;
  ownerId: string | undefined; // playerId for player-scoped, undefined for game-scoped
};

/** Create the piece location index. */
function buildPieceLocationIndex(state: GameState, config: GameSession['config']): Map<string, PieceLocation> {
  const index = new Map<string, PieceLocation>();

  // Game-scoped inventories
  for (const [invId, invData] of Object.entries(state.gameInventories)) {
    for (const pieceId of extractPieceIds(invData)) {
      index.set(pieceId, { inventoryId: invId, ownerId: undefined });
    }
  }

  // Player-scoped inventories
  for (const [playerId, playerState] of Object.entries(state.players)) {
    for (const [invId, invData] of Object.entries(playerState.inventories)) {
      for (const pieceId of extractPieceIds(invData)) {
        index.set(pieceId, { inventoryId: invId, ownerId: playerId });
      }
    }
  }

  // Piece-scoped inventories
  for (const [pieceId, piece] of Object.entries(state.gamepieces)) {
    if (!piece.inventories) continue;
    for (const [invId, invData] of Object.entries(piece.inventories)) {
      for (const childId of extractPieceIds(invData)) {
        index.set(childId, { inventoryId: invId, ownerId: pieceId });
      }
    }
  }

  return index;
}

/** Get the piece IDs from an inventory data structure. */
function extractPieceIds(data: InventoryData): string[] {
  switch (data.structure) {
    case 'none':
    case 'stack':
      return data.pieceIds;
    case 'line':
      return data.slots.filter((s): s is string => s !== null);
    case 'grid':
      return Object.values(data.cells).filter((s): s is string => s !== null);
    case 'graph':
      return Object.values(data.nodes).filter((s): s is string => s !== null);
  }
}

// ---------------------------------------------------------------------------
// Main projection function
// ---------------------------------------------------------------------------

/**
 * Produce a view of the game state as seen by a specific player.
 * Respects inventory visibility, piece-level overrides, property visibility,
 * and role visibility. Deterministic — same inputs always produce same output.
 */
export function projectStateForPlayer(
  session: GameSession,
  viewerId: string,
): ProjectedState {
  const { state, config } = session;

  // Build reverse index: pieceId → which inventory it's in
  const pieceLocations = buildPieceLocationIndex(state, config);

  // --- Game properties (always public) ---
  const gameProperties = { ...state.gameProperties };

  // --- Game inventories ---
  const gameInventories: Record<string, ProjectedInventory> = {};
  for (const [invId, invData] of Object.entries(state.gameInventories)) {
    gameInventories[invId] = projectInventory(invData, config.inventories[invId], undefined, viewerId);
  }

  // --- Players ---
  const players: Record<string, ProjectedPlayerState> = {};
  for (const [playerId, playerState] of Object.entries(state.players)) {
    const properties = projectPlayerProperties(
      playerState.properties,
      config.playerProperties,
      playerId,
      viewerId,
      session,
    );
    const inventories: Record<string, ProjectedInventory> = {};
    for (const [invId, invData] of Object.entries(playerState.inventories)) {
      inventories[invId] = projectInventory(invData, config.inventories[invId], playerId, viewerId);
    }
    players[playerId] = { properties, inventories };
  }

  // --- Gamepieces (only include pieces the viewer can see) ---
  const gamepieces: Record<string, ProjectedGamepiece> = {};
  for (const [pieceId, piece] of Object.entries(state.gamepieces)) {
    const location = pieceLocations.get(pieceId);
    const invConfig = location ? config.inventories[location.inventoryId] : undefined;
    const invOwner = location?.ownerId;

    if (!canViewerSeePiece(piece, invConfig, invOwner, viewerId)) continue;

    const typeConfig = config.gamepieceTypes[piece.typeId];
    const propConfigs = typeConfig?.properties ?? {};

    gamepieces[pieceId] = {
      typeId: piece.typeId,
      ownerId: piece.ownerId,
      properties: projectGamepieceProperties(piece.properties, propConfigs, piece.ownerId, viewerId, piece.faceUp),
      faceUp: piece.faceUp,
      ...(piece.faceValue !== undefined && { faceValue: piece.faceValue }),
      ...(piece.orientationIndex !== undefined && { orientationIndex: piece.orientationIndex }),
      exhausted: piece.exhausted,
    };
  }

  return { gameProperties, gameInventories, players, gamepieces };
}
