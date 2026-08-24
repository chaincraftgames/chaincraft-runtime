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
} from "#chaincraft/types.js";

import type {
  StateChangeEvent,
  InventoryRef,
  PieceMovedEvent,
  PiecesDistributedEvent,
  PiecePropertyChangedEvent,
  StatePropertyChangedEvent,
} from "#chaincraft/api/state-change-events.js";

// ---------------------------------------------------------------------------
// Output types — projected state from a specific player's perspective
// ---------------------------------------------------------------------------

/**
 * A projected view of an inventory, respecting visibility rules.
 * Either contains the full inventory data, or a redacted view (count-only or hidden).
 */
export type ProjectedInventory =
  | InventoryData
  | { redacted: "count-only"; count: number }
  | { redacted: "hidden" };

/** A projected view of a gamepiece, respecting visibility rules. */
export interface ProjectedGamepiece {
  typeId: string;
  ownerId: string;
  properties: Record<string, unknown>;
  faceUp: boolean;
  faceValue?: number;
  orientationIndex?: number;
  exhausted: boolean;
}

/** A projected view of a player's state, respecting visibility rules. */
export interface ProjectedPlayerState {
  properties: Record<string, unknown>;
  inventories: Record<string, ProjectedInventory>;
}

/** A projected view of the entire game state, respecting visibility rules. */
export interface ProjectedState {
  gameProperties: Record<string, unknown>;
  gameInventories: Record<string, ProjectedInventory>;
  players: Record<string, ProjectedPlayerState>;
  /** Only pieces the viewer is allowed to see. Hidden pieces are omitted entirely. */
  gamepieces: Record<string, ProjectedGamepiece>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Look up raw inventory data by id and owner from the game state. */
function lookupInventoryData(
  state: GameState,
  inventoryId: string,
  ownerId: string | undefined,
): InventoryData | undefined {
  if (ownerId === undefined) return state.gameInventories[inventoryId];
  return (
    state.players[ownerId]?.inventories[inventoryId] ??
    state.gamepieces[ownerId]?.inventories?.[inventoryId]
  );
}

/** Resolve the effective visibility for a piece given its override and inventory config. */
function canViewerSeePiece(
  piece: Gamepiece,
  pieceId: string,
  inventoryConfig: InventoryConfig | undefined,
  inventoryData: InventoryData | undefined,
  inventoryOwnerId: string | undefined,
  viewerId: string,
): boolean {
  // Explicit per-piece override takes priority
  if (piece.visibleTo !== null) {
    if (piece.visibleTo === "all") return true;
    return piece.visibleTo.includes(viewerId);
  }

  // Fall back to inventory visibility
  if (!inventoryConfig) return true; // no config = assume visible
  switch (inventoryConfig.visibility) {
    case "always":
      return true;
    case "never":
      return false;
    case "owner":
      return viewerId === inventoryOwnerId;
    case "revealed":
      return piece.faceUp;
    case "top-revealed":
      if (piece.faceUp) return true;
      return (
        inventoryData?.structure === "stack" &&
        inventoryData.pieceIds[0] === pieceId
      );
  }
}

/** Count pieces in an inventory data structure. */
function inventoryPieceCount(data: InventoryData): number {
  switch (data.structure) {
    case "none":
    case "stack":
      return data.pieceIds.length;
    case "line":
      return data.slots.filter((s) => s !== null).length;
    case "grid":
      return Object.values(data.cells).filter((s) => s !== null).length;
    case "graph":
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

  const isOwner = viewerId === ownerId;
  const canSeePieces =
    config.visibility === "always" ||
    config.visibility === "revealed" ||
    (config.visibility === "owner" && isOwner);

  if (canSeePieces) return data;

  // Pieces hidden — check if count is visible
  const countVis = config.countVisibility;
  const canSeeCount =
    countVis === "always" || (countVis === "owner" && isOwner);

  return canSeeCount
    ? { redacted: "count-only", count: inventoryPieceCount(data) }
    : { redacted: "hidden" };
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
    const visibility: GamepiecePropertyVisibility =
      configs[key]?.visibility ?? "always";
    switch (visibility) {
      case "always":
        result[key] = value;
        break;
      case "owner":
        if (viewerId === ownerId) result[key] = value;
        break;
      case "revealed":
        if (faceUp) result[key] = value;
        break;
      case "never":
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
  const visibility = session.config.roleVisibility?.[roleId] ?? "public";
  if (visibility === "public") return true;
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
    const visibility: StatePropertyVisibility = config?.visibility ?? "public";

    let visible = false;
    switch (visibility) {
      case "public":
        visible = true;
        break;
      case "private":
        visible = viewerId === playerId;
        break;
      case "same-role": {
        if (viewerId === playerId) {
          visible = true;
        } else {
          viewerRoles ??= getRoles(session, viewerId);
          targetRoles ??= getRoles(session, playerId);
          visible = viewerRoles.some((r) => targetRoles!.includes(r));
        }
        break;
      }
      case "never":
        visible = false;
        break;
    }
    if (!visible) continue;

    // For role-ref properties, additionally check role visibility
    if (
      config?.refType === "player-role-id" &&
      typeof value === "string" &&
      value
    ) {
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
function buildPieceLocationIndex(
  state: GameState,
  config: GameSession["config"],
): Map<string, PieceLocation> {
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
    case "none":
    case "stack":
      return data.pieceIds;
    case "line":
      return data.slots.filter((s): s is string => s !== null);
    case "grid":
      return Object.values(data.cells).filter((s): s is string => s !== null);
    case "graph":
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
    gameInventories[invId] = projectInventory(
      invData,
      config.inventories[invId],
      undefined,
      viewerId,
    );
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
      inventories[invId] = projectInventory(
        invData,
        config.inventories[invId],
        playerId,
        viewerId,
      );
    }
    players[playerId] = { properties, inventories };
  }

  // --- Gamepieces (only include pieces the viewer can see) ---
  const gamepieces: Record<string, ProjectedGamepiece> = {};
  for (const [pieceId, piece] of Object.entries(state.gamepieces)) {
    const location = pieceLocations.get(pieceId);
    const invConfig = location
      ? config.inventories[location.inventoryId]
      : undefined;
    const invOwner = location?.ownerId;
    const invData = location
      ? lookupInventoryData(state, location.inventoryId, location.ownerId)
      : undefined;

    if (
      !canViewerSeePiece(piece, pieceId, invConfig, invData, invOwner, viewerId)
    )
      continue;

    const typeConfig = config.gamepieceTypes[piece.typeId];
    const propConfigs = typeConfig?.properties ?? {};

    gamepieces[pieceId] = {
      typeId: piece.typeId,
      ownerId: piece.ownerId,
      properties: projectGamepieceProperties(
        piece.properties,
        propConfigs,
        piece.ownerId,
        viewerId,
        piece.faceUp,
      ),
      faceUp: piece.faceUp,
      ...(piece.faceValue !== undefined && { faceValue: piece.faceValue }),
      ...(piece.orientationIndex !== undefined && {
        orientationIndex: piece.orientationIndex,
      }),
      exhausted: piece.exhausted,
    };
  }

  return { gameProperties, gameInventories, players, gamepieces };
}

// ---------------------------------------------------------------------------
// State-change event projection
// ---------------------------------------------------------------------------

/** Resolve an InventoryRef to its config and owner for visibility checks. */
function resolveInventoryRef(
  config: GameSession["config"],
  ref: InventoryRef,
): { invConfig: InventoryConfig | undefined; ownerId: string | undefined } {
  return {
    invConfig: config.inventories[ref.inventoryId],
    ownerId: ref.ownerId,
  };
}

/** Can the viewer see a piece given its current inventory location? */
function canViewerSeePieceById(
  session: GameSession,
  pieceId: string,
  pieceLocations: Map<string, PieceLocation>,
  viewerId: string,
): boolean {
  const piece = session.state.gamepieces[pieceId];
  if (!piece) return false;
  const location = pieceLocations.get(pieceId);
  const invConfig = location
    ? session.config.inventories[location.inventoryId]
    : undefined;
  const invData = location
    ? lookupInventoryData(session.state, location.inventoryId, location.ownerId)
    : undefined;
  return canViewerSeePiece(
    piece,
    pieceId,
    invConfig,
    invData,
    location?.ownerId,
    viewerId,
  );
}

/** Can the viewer see piece identities in this inventory? */
function isInventoryContentVisible(
  invConfig: InventoryConfig | undefined,
  ownerId: string | undefined,
  viewerId: string,
): boolean {
  if (!invConfig) return true;
  switch (invConfig.visibility) {
    case "always":
    case "revealed":
    case "top-revealed":
      return true;
    case "owner":
      return viewerId === ownerId;
    case "never":
      return false;
  }
}

/** Can the viewer see the piece count of this inventory? */
function isInventoryCountVisible(
  invConfig: InventoryConfig | undefined,
  ownerId: string | undefined,
  viewerId: string,
): boolean {
  if (!invConfig) return true;
  switch (invConfig.countVisibility) {
    case "always":
      return true;
    case "owner":
      return viewerId === ownerId;
    case "never":
      return false;
  }
}

/** Project a PieceMovedEvent for a specific viewer, redacting information as needed. */
function projectMoveEvent(
  session: GameSession,
  event: PieceMovedEvent,
  viewerId: string,
): StateChangeEvent | null {
  const { config } = session;
  const fromRef = resolveInventoryRef(config, event.from.inventory);
  const toRef = resolveInventoryRef(config, event.to.inventory);
  const fromContent = isInventoryContentVisible(
    fromRef.invConfig,
    fromRef.ownerId,
    viewerId,
  );
  const toContent = isInventoryContentVisible(
    toRef.invConfig,
    toRef.ownerId,
    viewerId,
  );
  const fromCount = isInventoryCountVisible(
    fromRef.invConfig,
    fromRef.ownerId,
    viewerId,
  );
  const toCount = isInventoryCountVisible(
    toRef.invConfig,
    toRef.ownerId,
    viewerId,
  );

  // Drop only when the viewer can see neither content nor count on either side
  if (!fromContent && !fromCount && !toContent && !toCount) return null;

  // Redact pieceId when the destination hides piece identity from this viewer.
  const piece = session.state.gamepieces[event.pieceId];
  const toInvData = lookupInventoryData(
    session.state,
    event.to.inventory.inventoryId,
    event.to.inventory.ownerId,
  );
  const canSeePiece = piece
    ? canViewerSeePiece(
        piece,
        event.pieceId,
        toRef.invConfig,
        toInvData,
        toRef.ownerId,
        viewerId,
      )
    : toContent;

  return {
    ...event,
    pieceId: canSeePiece ? event.pieceId : "__redacted__",
  };
}

/** Project a PiecesDistributedEvent for a specific viewer, redacting information as needed. */
function projectDistributeEvent(
  session: GameSession,
  event: PiecesDistributedEvent,
  viewerId: string,
): StateChangeEvent | null {
  const { config } = session;
  const fromRef = resolveInventoryRef(config, event.from.inventory);
  const fromContent = isInventoryContentVisible(
    fromRef.invConfig,
    fromRef.ownerId,
    viewerId,
  );
  const fromCount = isInventoryCountVisible(
    fromRef.invConfig,
    fromRef.ownerId,
    viewerId,
  );

  const projectedDeals = event.deals.map((deal) => {
    const toRef = resolveInventoryRef(config, deal.to.inventory);
    const toContent = isInventoryContentVisible(
      toRef.invConfig,
      toRef.ownerId,
      viewerId,
    );
    const piece = session.state.gamepieces[deal.pieceId];
    const toInvData = lookupInventoryData(
      session.state,
      deal.to.inventory.inventoryId,
      deal.to.inventory.ownerId,
    );
    const canSeePiece = piece
      ? canViewerSeePiece(
          piece,
          deal.pieceId,
          toRef.invConfig,
          toInvData,
          toRef.ownerId,
          viewerId,
        )
      : toContent;
    return {
      ...deal,
      pieceId: canSeePiece ? deal.pieceId : "__redacted__",
    };
  });

  // Drop only when the viewer can see nothing about any endpoint
  const anyDealVisible = projectedDeals.some(
    (d) => d.pieceId !== "__redacted__",
  );
  const anyDealCountVisible = event.deals.some((deal) => {
    const toRef = resolveInventoryRef(config, deal.to.inventory);
    return isInventoryCountVisible(toRef.invConfig, toRef.ownerId, viewerId);
  });
  if (!fromContent && !fromCount && !anyDealVisible && !anyDealCountVisible)
    return null;

  return { ...event, deals: projectedDeals };
}

/** Project a PiecePropertyChangedEvent for a specific viewer, redacting information as needed. */
function projectPropertyChangedEvent(
  session: GameSession,
  event: PiecePropertyChangedEvent,
  pieceLocations: Map<string, PieceLocation>,
  viewerId: string,
): StateChangeEvent | null {
  if (!canViewerSeePieceById(session, event.pieceId, pieceLocations, viewerId))
    return null;

  const piece = session.state.gamepieces[event.pieceId];
  if (!piece) return null;
  const typeConfig = session.config.gamepieceTypes[piece.typeId];
  const propVisibility: GamepiecePropertyVisibility =
    typeConfig?.properties[event.property]?.visibility ?? "always";

  switch (propVisibility) {
    case "always":
      return event;
    case "owner":
      return viewerId === piece.ownerId ? event : null;
    case "revealed":
      return piece.faceUp ? event : null;
    case "never":
      return null;
  }
}

/** Project a StatePropertyChangedEvent for a specific viewer, redacting information as needed. */
function projectStatePropertyEvent(
  session: GameSession,
  event: StatePropertyChangedEvent,
  viewerId: string,
): StateChangeEvent | null {
  if (event.scope === "game") {
    const config = session.config.gameProperties[event.property];
    const visibility: StatePropertyVisibility = config?.visibility ?? "public";
    return visibility === "never" ? null : event;
  }
  // Player-scoped property
  const config = session.config.playerProperties[event.property];
  const visibility: StatePropertyVisibility = config?.visibility ?? "public";
  switch (visibility) {
    case "public":
      return event;
    case "private":
      return viewerId === event.playerId ? event : null;
    case "same-role": {
      if (viewerId === event.playerId) return event;
      const viewerRoles = getRoles(session, viewerId);
      const targetRoles = getRoles(session, event.playerId!);
      return viewerRoles.some((r) => targetRoles.includes(r)) ? event : null;
    }
    case "never":
      return null;
  }
}

/**
 * Project a batch of state-change events for a specific viewer. Events for
 * pieces or properties the viewer cannot see are dropped or redacted.
 * Call this before sending events over the wire.
 */
export function projectStateChanges(
  session: GameSession,
  changes: StateChangeEvent[],
  viewerId: string,
): StateChangeEvent[] {
  const pieceLocations = buildPieceLocationIndex(session.state, session.config);
  const result: StateChangeEvent[] = [];

  for (const event of changes) {
    let projected: StateChangeEvent | null;

    switch (event.kind) {
      case "piece:moved":
        projected = projectMoveEvent(session, event, viewerId);
        break;

      case "pieces:distributed":
        projected = projectDistributeEvent(session, event, viewerId);
        break;

      case "piece:property-changed":
        projected = projectPropertyChangedEvent(
          session,
          event,
          pieceLocations,
          viewerId,
        );
        break;

      case "state:property-changed":
        projected = projectStatePropertyEvent(session, event, viewerId);
        break;

      case "piece:flipped":
      case "piece:rolled":
      case "piece:oriented":
      case "piece:exhausted":
        projected = canViewerSeePieceById(
          session,
          event.pieceId,
          pieceLocations,
          viewerId,
        )
          ? event
          : null;
        break;

      case "piece:revealed":
      case "piece:hidden":
        // Always deliver — these inform the viewer about visibility changes.
        projected = event;
        break;

      case "inventory:shuffled": {
        const { invConfig, ownerId } = resolveInventoryRef(
          session.config,
          event.inventory,
        );
        projected = isInventoryContentVisible(invConfig, ownerId, viewerId)
          ? event
          : null;
        break;
      }
    }

    if (projected) result.push(projected);
  }

  return result;
}
