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

import type { GameSession, EffectContext } from '#chaincraft/types.js';
import { selectGamepieces } from './gamepiece-selector.js';
import type { GamepieceSelector } from './gamepiece-selector.js';

type RevealEffectDef = { pieces: GamepieceSelector; to: string };
type HideEffectDef   = { pieces: GamepieceSelector };

/**
 * Resolve a MessageRecipient string to the concrete visibleTo value.
 *   'all'        → 'all'
 *   'actor'      → [actorId]
 *   'opponents'  → all players except actor
 *   'role:<id>'  → players whose any property value equals the role ID
 *   <playerId>   → [playerId]
 */
function resolveAudience(
  to: string,
  session: GameSession,
  ctx: EffectContext,
): string[] | 'all' {
  if (to === 'all') return 'all';

  if (to === 'actor') {
    return ctx.actorId ? [ctx.actorId] : [];
  }

  if (to === 'opponents') {
    return session.players.filter((p) => p !== ctx.actorId);
  }

  if (to.startsWith('role:')) {
    const roleId = to.slice(5);
    return session.players.filter((p) => session.state.players[p]?.roles.includes(roleId));
  }

  // Specific player ID
  return [to];
}

export async function executeReveal(
  session: GameSession,
  ctx: EffectContext<RevealEffectDef>,
): Promise<void> {
  const { pieces: selector, to } = ctx.effectDef;
  const audience = resolveAudience(to, session, ctx);
  const pieceIds = selectGamepieces(session, ctx, selector);

  for (const pieceId of pieceIds) {
    const piece = session.state.gamepieces[pieceId];
    if (!piece) continue;
    piece.visibleTo = audience;
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
  }
}
