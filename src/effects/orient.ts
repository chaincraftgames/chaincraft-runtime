// ---------------------------------------------------------------------------
// Effect executor: orient
//
// Sets or rotates the orientation of pieces. The type config's orientationCount
// determines how many distinct orientations exist (indices 0..orientationCount-1).
// Pieces whose type config does not define orientationCount are silently skipped.
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';
import { selectGamepieces } from './gamepiece-selector.js';
import type { GamepieceSelector } from './gamepiece-selector.js';

type OrientTarget = number | 'rotate-cw' | 'rotate-ccw';
type OrientEffectDef = { pieces: GamepieceSelector; to: OrientTarget };

export async function executeOrient(
  session: GameSession,
  ctx: EffectContext<OrientEffectDef>,
): Promise<void> {
  const { pieces: selector, to } = ctx.effectDef;

  const pieceIds = selectGamepieces(session, ctx, selector);

  for (const pieceId of pieceIds) {
    const piece = session.state.gamepieces[pieceId];
    if (!piece) continue;

    const orientationCount = session.config.gamepieceTypes[piece.typeId]?.orientationCount;
    if (!orientationCount || orientationCount < 1) continue;

    const current = piece.orientationIndex ?? 0;

    if (typeof to === 'number') {
      piece.orientationIndex = to % orientationCount;
    } else if (to === 'rotate-cw') {
      piece.orientationIndex = (current + 1) % orientationCount;
    } else {
      piece.orientationIndex = (current - 1 + orientationCount) % orientationCount;
    }
  }
}
