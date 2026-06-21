export {
  getGameState,
  setGameState,
  getPlayerState,
  setPlayerState,
  getGamepieceState as getPieceState,
  setPieceState,
} from '#chaincraft/state/accessors.js';

export { StateAccessError } from '#chaincraft/state/errors.js';
export type { StateAccessErrorKind } from '#chaincraft/state/errors.js';
