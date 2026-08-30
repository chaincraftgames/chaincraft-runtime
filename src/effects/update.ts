// ---------------------------------------------------------------------------
// Effect executor: update
//
// Writes a value to a property on one or more gamepieces selected by a
// PieceSelector. The piece selector is resolved to concrete piece IDs by
// the selector resolver (for now we support a simple inline resolution).
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from "#chaincraft/types.js";
import {
  resolveValue,
  resolvePieceRef,
} from "#chaincraft/effects/resolve-value.js";
import type {
  PropertyValue,
  PieceRef,
} from "#chaincraft/effects/resolve-value.js";
import { selectGamepieces } from "#chaincraft/effects/gamepiece-selector.js";
import type { GamepieceSelector } from "#chaincraft/effects/gamepiece-selector.js";
import { StateWriteEvent } from "#chaincraft/effects/effect-bus.js";

type UpdateEffectDef = {
  pieces: GamepieceSelector;
  property: string;
  value: PropertyValue;
  source?: PieceRef;
};

export async function executeUpdate(
  session: GameSession,
  ctx: EffectContext<UpdateEffectDef>,
): Promise<void> {
  const { pieces: selector, property, value: pv, source } = ctx.effectDef;

  const pieceIds = selectGamepieces(session, ctx, selector);

  // Resolve source piece if specified (e.g. the attacking creature)
  const sourcePieceId = source
    ? resolvePieceRef(ctx, source)
    : ctx.sourcePieceId;

  for (const pieceId of pieceIds) {
    const piece = session.state.gamepieces[pieceId];
    if (!piece) continue;

    // 'exhausted' is a first-class boolean field on Gamepiece, not a property bag entry.
    if (property === "exhausted") {
      const valueCtx = { ...ctx, sourcePieceId, targetPieceId: pieceId };
      const resolved = resolveValue(
        pv,
        piece.exhausted,
        session,
        valueCtx,
        undefined,
      );
      piece.exhausted = Boolean(resolved);
      session.events.emit({
        kind: "state:change",
        change: {
          kind: "piece:exhausted",
          pieceId,
          exhausted: piece.exhausted,
        },
      });
      continue;
    }

    const typeConfig = session.config.gamepieceTypes[piece.typeId];
    const propConfig = typeConfig?.properties[property];
    const current = piece.properties[property];
    // Thread source and target piece IDs into context for value resolution
    const valueCtx = { ...ctx, sourcePieceId, targetPieceId: pieceId };
    let resolved = resolveValue(pv, current, session, valueCtx, propConfig);

    if (
      ctx.actorId &&
      typeof current === "number" &&
      typeof resolved === "number"
    ) {
      // Update is adjustable if the value is a number,
      // so create a pending effect and emit before.
      let finalValue: number = resolved;
      const path = `gamepiece.property.${property}`;
      const stateWriteEvent = {
        kind: "state-write" as const,
        direction: finalValue >= current ? "increase" : "decrease",
        path,
        resolvedValue: finalValue,
        targetId: pieceId,
        actorId: ctx.actorId,
      } satisfies StateWriteEvent;
      const pending = session.bus?.emitBeforeStateWrite(stateWriteEvent, session);
      if (pending?.cancelled) {
        session.logger?.info(
          { path, targetId: pieceId },
          "state-write cancelled by passive",
        );
        // If the pending effect was cancelled, skip the write.
        continue;
      }
      if (
        pending?.adjustedValue !== undefined &&
        pending.adjustedValue !== pending.resolvedValue
      ) {
        finalValue = pending.adjustedValue as number;
        session.logger?.info(
          { path, targetId: pieceId, resolvedValue: finalValue },
          "state-write adjusted by passive",
        );
      }
      piece.properties[property] = finalValue;
      await session.bus?.emitAfterStateWrite({
        ...stateWriteEvent,
        resolvedValue: finalValue,
      } satisfies StateWriteEvent, session);
      session.events.emit({
        kind: "state:change",
        change: {
          kind: "piece:property-changed",
          pieceId,
          property,
          oldValue: current,
          newValue: finalValue,
        },
      });
    } else {
      piece.properties[property] = resolved;
      session.events.emit({
        kind: "state:change",
        change: {
          kind: "piece:property-changed",
          pieceId,
          property,
          oldValue: current,
          newValue: resolved,
        },
      });
    }
  }
}
