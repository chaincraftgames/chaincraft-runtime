// ---------------------------------------------------------------------------
// Effect executor: roll
//
// Randomizes the face value of die pieces. For each selected piece the
// engine picks a random integer in [1, faceCount] using the session RNG.
// Pieces whose type config does not define faceCount are silently skipped.
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';
import { selectGamepieces } from '#chaincraft/effects/gamepiece-selector.js';
import type { GamepieceSelector } from '#chaincraft/effects/gamepiece-selector.js';

type RollEffectDef = { pieces: GamepieceSelector };

export async function executeRoll(
  session: GameSession,
  ctx: EffectContext<RollEffectDef>,
): Promise<void> {
  const { pieces: selector } = ctx.effectDef;

  const pieceIds = selectGamepieces(session, ctx, selector);

  for (const pieceId of pieceIds) {
    const piece = session.state.gamepieces[pieceId];
    if (!piece) continue;

    const faceCount = session.config.gamepieceTypes[piece.typeId]?.faceCount;
    if (!faceCount || faceCount < 1) continue;

    piece.faceValue = Math.floor(session.rng.nextFloat() * faceCount) + 1;
  }
}
