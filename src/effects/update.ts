// ---------------------------------------------------------------------------
// Effect executor: update
//
// Writes a value to a property on one or more gamepieces selected by a
// PieceSelector. The piece selector is resolved to concrete piece IDs by
// the selector resolver (for now we support a simple inline resolution).
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';
import { resolveValue } from './resolve-value.js';
import type { PropertyValue } from './resolve-value.js';
import { selectGamepieces } from './gamepiece-selector.js';
import type { GamepieceSelector } from './gamepiece-selector.js';
import { StateWriteEvent } from './index.js';

type UpdateEffectDef = { pieces: GamepieceSelector; property: string; value: PropertyValue };

export async function executeUpdate(
  session: GameSession,
  ctx: EffectContext<UpdateEffectDef>,
): Promise<void> {
  const { pieces: selector, property, value: pv } = ctx.effectDef;

  const pieceIds = selectGamepieces(session, ctx, selector);

  for (const pieceId of pieceIds) {
    const piece = session.state.gamepieces[pieceId];
    if (!piece) continue;

    const typeConfig = session.config.gamepieceTypes[piece.typeId];
    const propConfig = typeConfig?.properties[property];
    const current = piece.properties[property];
    let resolved = resolveValue(pv, current, session, ctx, propConfig);
    
    if (
      ctx.actorId && 
      typeof current === 'number' && typeof resolved === 'number'
    ) {
      // Update is adjustable if the value is a number, 
      // so create a pending effect and emit before.
      let finalValue: number = resolved;
      const path = `gamepiece.property.${property}`;
      const stateWriteEvent = {
        kind: 'state-write' as const,
        direction: finalValue >= current ? 'increase' : 'decrease',
        path,
        resolvedValue: finalValue,
        targetId: pieceId,
        actorId: ctx.actorId,
      } satisfies StateWriteEvent;
      const pending = session.bus?.emitBeforeStateWrite(stateWriteEvent);
      if (pending?.cancelled) {
        session.logger?.info(
          { path, targetId: pieceId }, 
          'state-write cancelled by passive'
        );  
        // If the pending effect was cancelled, skip the write.
        continue;
      }
      if (pending?.adjustedValue !== undefined && pending.adjustedValue !== pending.resolvedValue) {
        finalValue = pending.adjustedValue as number;
        session.logger?.info({ path, targetId: pieceId, resolvedValue: finalValue }, 'state-write adjusted by passive');
      }
      piece.properties[property] = finalValue;
      session.bus?.emitAfterStateWrite({
        ...stateWriteEvent,
        resolvedValue: finalValue
      } satisfies StateWriteEvent);
    } else {
      piece.properties[property] = resolved;
    }
  }
}
