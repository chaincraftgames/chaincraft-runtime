// ---------------------------------------------------------------------------
// Effect executors: reveal / hide
//
// reveal — temporarily overrides piece visibility for a specific audience.
//          Sets piece.visibleTo to the resolved audience until 'hide' or
//          the end of the enclosing action reverts it.
//
// hide   — reverts piece visibility to the inventory default (visibleTo = null),
//          cancelling any active reveal override.
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from "#chaincraft/types.js";
import { selectGamepieces } from "#chaincraft/effects/gamepiece-selector.js";
import type { GamepieceSelector } from "#chaincraft/effects/gamepiece-selector.js";
import { resolvePlayerTarget } from "#chaincraft/effects/player-target.js";
import type { PlayerTarget } from "#chaincraft/effects/player-target.js";

type RevealEffectDef = { pieces: GamepieceSelector; to: PlayerTarget };
type HideEffectDef = { pieces: GamepieceSelector };

export async function executeReveal(
  session: GameSession,
  ctx: EffectContext<RevealEffectDef>,
): Promise<void> {
  const { pieces: selector, to } = ctx.effectDef;
  const audience = to === "all" ? "all" : resolvePlayerTarget(session, ctx, to);
  const pieceIds = selectGamepieces(session, ctx, selector);

  for (const pieceId of pieceIds) {
    const piece = session.state.gamepieces[pieceId];
    if (!piece) continue;
    piece.visibleTo = audience;
    session.events.emit({
      kind: "state:change",
      change: { kind: "piece:revealed", pieceId, visibleTo: audience },
    });
  }
}

export async function executeHide(
  session: GameSession,
  ctx: EffectContext<HideEffectDef>,
): Promise<void> {
  const { pieces: selector } = ctx.effectDef;
  const pieceIds = selectGamepieces(session, ctx, selector);

  for (const pieceId of pieceIds) {
    const piece = session.state.gamepieces[pieceId];
    if (!piece) continue;
    piece.visibleTo = null;
    session.events.emit({
      kind: "state:change",
      change: { kind: "piece:hidden", pieceId },
    });
  }
}
