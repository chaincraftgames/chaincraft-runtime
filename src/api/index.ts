// ---------------------------------------------------------------------------
// @chaincraft/runtime — public API surface.
// Everything a host needs to drive a game session.
// ---------------------------------------------------------------------------

export { GameController } from './game-controller.js';
export type {
  GameControllerEvents,
  GameControllerOptions,
  SystemResponder,
} from './game-controller.js';
export type {
  StateChangeEvent,
  InventoryRef,
  InventoryPosition,
  PieceMovedEvent,
  PiecesDistributedEvent,
  PieceFlippedEvent,
  PieceRolledEvent,
  PieceOrientedEvent,
  PieceExhaustedEvent,
  PiecePropertyChangedEvent,
  PieceRevealedEvent,
  PieceHiddenEvent,
  InventoryShuffledEvent,
  StatePropertyChangedEvent,
} from './state-change-events.js';
