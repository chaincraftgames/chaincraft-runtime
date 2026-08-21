// ---------------------------------------------------------------------------
// Effect executor: flip
//
// Changes the physical face state of pieces (faceUp boolean).
// Requires hasFaceState: true on the piece type config.
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from "#chaincraft/types.js";
import { selectGamepieces } from "#chaincraft/effects/gamepiece-selector.js";
import type { GamepieceSelector } from "#chaincraft/effects/gamepiece-selector.js";

type FlipTarget = "face-up" | "face-down" | "toggle";
type FlipEffectDef = { pieces: GamepieceSelector; to: FlipTarget };

export async function executeFlip(
  session: GameSession,
  ctx: EffectContext<FlipEffectDef>,
): Promise<void> {
  const { pieces: selector, to } = ctx.effectDef;

  const pieceIds = selectGamepieces(session, ctx, selector);

  for (const pieceId of pieceIds) {
    const piece = session.state.gamepieces[pieceId];
    if (!piece) continue;

    if (to === "face-up") {
      piece.faceUp = true;
    } else if (to === "face-down") {
      piece.faceUp = false;
    } else {
      piece.faceUp = !piece.faceUp;
    }
    session.events.emit({
      kind: "state:change",
      change: { kind: "piece:flipped", pieceId, faceUp: piece.faceUp },
    });
  }
}
