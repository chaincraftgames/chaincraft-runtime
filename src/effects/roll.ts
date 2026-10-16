// ---------------------------------------------------------------------------
// Effect executor: roll
//
// Randomizes the face value of pieces that have a face table. For each selected
// piece the engine picks one entry uniformly (via the session RNG) from the
// type's `faces`, or from 1..faceCount when only faceCount is configured.
// Pieces whose type config defines neither are silently skipped.
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

    const typeConfig = session.config.gamepieceTypes[piece.typeId];
    const faces = typeConfig?.faces ?? faceRange(typeConfig?.faceCount);
    if (faces.length === 0) continue;

    piece.faceValue = faces[Math.floor(session.rng.nextFloat() * faces.length)];
    session.events.emit({ kind: 'state:change', change: { kind: 'piece:rolled', pieceId, faceValue: piece.faceValue } });
  }
}

function faceRange(faceCount: number | undefined): number[] {
  return Array.from({ length: faceCount && faceCount > 0 ? faceCount : 0 }, (_, i) => i + 1);
}
