export {
  getGameState,
  setGameState,
  getPlayerState,
  setPlayerState,
  getGamepieceState as getPieceState,
  setPieceState,
} from '#chaincraft/state/accessors.js';

export { StateAccessError } from '#chaincraft/state/errors.js';

export { projectStateForPlayer } from '#chaincraft/state/projection.js';
export type {
  ProjectedState,
  ProjectedInventory,
  ProjectedGamepiece,
  ProjectedPlayerState,
} from '#chaincraft/state/projection.js';
export type { StateAccessErrorKind } from '#chaincraft/state/errors.js';
