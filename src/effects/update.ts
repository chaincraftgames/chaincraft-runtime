// ---------------------------------------------------------------------------
// Effect executor: update
//
// Writes a value to a property on one or more gamepieces selected by a
// PieceSelector. The piece selector is resolved to concrete piece IDs by
// the selector resolver (for now we support a simple inline resolution).
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';
import { resolveValue } from './resolve-value.js';
import { selectGamepieces } from './gamepiece-selector.js';

export async function executeUpdate(
  session: GameSession,
  ctx: EffectContext,
): Promise<void> {
  const def = ctx.effectDef;
  const selector = def['pieces'] as Record<string, unknown>;
  const property = def['property'] as string;
  const pv = def['value'] as import('./resolve-value.js').PropertyValue;

  const pieceIds = selectGamepieces(session, ctx, selector);

  for (const pieceId of pieceIds) {
    const piece = session.state.gamepieces[pieceId];
    if (!piece) continue;

    const typeConfig = session.config.gamepieceTypes[piece.typeId];
    const propConfig = typeConfig?.properties[property];
    const current = piece.properties[property];
    const resolved = resolveValue(pv, current, session, ctx, propConfig);
    piece.properties[property] = resolved;
  }
}
