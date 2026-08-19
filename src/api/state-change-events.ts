// ---------------------------------------------------------------------------
// StateChangeEvent — per-effect state mutations, emitted in batch after each
// player action. Projected per-viewer by the server before sending over the wire.
// ---------------------------------------------------------------------------

import type { InventoryPosition } from "#chaincraft/types.js";
export type { InventoryPosition };

// ---------------------------------------------------------------------------
// Shared references
// ---------------------------------------------------------------------------

/** Identifies a specific inventory instance. */
export interface InventoryRef {
  inventoryId: string;
  /** playerId for player-scoped, pieceId for piece-scoped; omitted for game-scoped. */
  ownerId?: string;
}

// ---------------------------------------------------------------------------
// Piece events
// ---------------------------------------------------------------------------

/** A piece moved between inventories or was repositioned within one. */
export interface PieceMovedEvent {
  kind: "piece:moved";
  pieceId: string;
  from: { inventory: InventoryRef; position?: InventoryPosition };
  to: { inventory: InventoryRef; position?: InventoryPosition };
}

/** Multiple pieces distributed from one source to multiple targets (a deal). */
export interface PiecesDistributedEvent {
  kind: "pieces:distributed";
  from: { inventory: InventoryRef; position?: InventoryPosition };
  /** Ordered — reflects deal sequence (first entry dealt first). */
  deals: Array<{
    pieceId: string;
    to: { inventory: InventoryRef; position?: InventoryPosition };
  }>;
}

/** A piece was flipped face-up or face-down. */
export interface PieceFlippedEvent {
  kind: "piece:flipped";
  pieceId: string;
  faceUp: boolean;
}

/** A die was rolled — new random face value assigned. */
export interface PieceRolledEvent {
  kind: "piece:rolled";
  pieceId: string;
  faceValue: number;
}

/** A tile piece's orientation changed. */
export interface PieceOrientedEvent {
  kind: "piece:oriented";
  pieceId: string;
  orientationIndex: number;
}

/** A piece's exhausted state changed (tapped/untapped, used/refreshed). */
export interface PieceExhaustedEvent {
  kind: "piece:exhausted";
  pieceId: string;
  exhausted: boolean;
}

/** A property on a piece was set or adjusted. */
export interface PiecePropertyChangedEvent {
  kind: "piece:property-changed";
  pieceId: string;
  property: string;
  oldValue: unknown;
  newValue: unknown;
}

/** A piece was revealed to specific players (visibility override applied). */
export interface PieceRevealedEvent {
  kind: "piece:revealed";
  pieceId: string;
  visibleTo: string[] | "all";
}

/** A piece's visibility override was removed (reverts to inventory default). */
export interface PieceHiddenEvent {
  kind: "piece:hidden";
  pieceId: string;
}

// ---------------------------------------------------------------------------
// Inventory events
// ---------------------------------------------------------------------------

/** An inventory's piece order was randomized. */
export interface InventoryShuffledEvent {
  kind: "inventory:shuffled";
  inventory: InventoryRef;
}

// ---------------------------------------------------------------------------
// State property events
// ---------------------------------------------------------------------------

/** A game-level or player-level state property changed. */
export interface StatePropertyChangedEvent {
  kind: "state:property-changed";
  scope: "game" | "player";
  /** Present when scope is "player". */
  playerId?: string;
  property: string;
  oldValue: unknown;
  newValue: unknown;
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type StateChangeEvent =
  | PieceMovedEvent
  | PiecesDistributedEvent
  | PieceFlippedEvent
  | PieceRolledEvent
  | PieceOrientedEvent
  | PieceExhaustedEvent
  | PiecePropertyChangedEvent
  | PieceRevealedEvent
  | PieceHiddenEvent
  | InventoryShuffledEvent
  | StatePropertyChangedEvent;
