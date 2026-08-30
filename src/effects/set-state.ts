// ---------------------------------------------------------------------------
// Effect executor: set-state
//
// Writes a value to a game or player state property identified by a dot-path.
// Path format:
//   game.property.<id>   → game-scoped property
//   player.property.<id> → target player(s) per-player property
//
// When path targets a player property, the optional `target` field determines
// which player(s) are affected. Defaults to the acting player when omitted.
// ---------------------------------------------------------------------------

import type {
  GameSession,
  EffectContext,
  PropertyConfig,
} from "#chaincraft/types.js";
import {
  resolveValue,
  resolvePieceRef,
} from "#chaincraft/effects/resolve-value.js";
import type {
  PropertyValue,
  PieceRef,
} from "#chaincraft/effects/resolve-value.js";
import { resolvePlayerTarget } from "#chaincraft/effects/player-target.js";
import type { PlayerTarget } from "#chaincraft/effects/player-target.js";
import { StateWriteEvent } from "#chaincraft/effects/effect-bus.js";

type SetStateEffectDef = {
  path: string;
  value: PropertyValue;
  target?: PlayerTarget;
  source?: PieceRef;
};

/**
 * Validate that a value written to a ref-typed property is a known entity ID.
 * Throws with a descriptive message when validation fails; no-ops when refType is unset.
 */
function validateRefValue(
  value: unknown,
  config: PropertyConfig | undefined,
  session: GameSession,
  path: string,
): void {
  if (!config?.refType || typeof value !== "string") return;
  switch (config.refType) {
    case "player-id":
      if (!session.state.players[value]) {
        throw new Error(
          `set-state "${path}": "${value}" is not a valid player ID (known: ${Object.keys(session.state.players).join(", ")})`,
        );
      }
      break;
    case "player-role-id":
      if (session.config.roles && !session.config.roles.includes(value)) {
        throw new Error(
          `set-state "${path}": "${value}" is not a valid player role ID (known: ${session.config.roles.join(", ")})`,
        );
      }
      break;
    case "gamepiece-id":
      if (!session.state.gamepieces[value]) {
        throw new Error(
          `set-state "${path}": "${value}" is not a valid gamepiece ID`,
        );
      }
      break;
  }
}

export async function executeSetState(
  session: GameSession,
  ctx: EffectContext<SetStateEffectDef>,
): Promise<void> {
  const { path, value: pv, target, source } = ctx.effectDef;

  const segments = path.split(".");

  // Resolve source piece if specified
  const sourcePieceId = source
    ? resolvePieceRef(ctx, source)
    : ctx.sourcePieceId;
  const valueCtx = sourcePieceId ? { ...ctx, sourcePieceId } : ctx;

  if (segments[0] === "game" && segments[1] === "property") {
    const key = segments[2];
    const config = session.config.gameProperties[key];
    const current = session.state.gameProperties[key];
    let resolved = resolveValue(pv, current, session, valueCtx, config);
    validateRefValue(resolved, config, session, path);
    session.state.gameProperties[key] = resolved;
    session.events.emit({
      kind: "state:change",
      change: {
        kind: "state:property-changed",
        scope: "game",
        property: key,
        oldValue: current,
        newValue: resolved,
      },
    });
  } else if (segments[0] === "player" && segments[1] === "property") {
    const key = segments[2];
    const playerIds = resolvePlayerTarget(session, ctx, target);

    for (const playerId of playerIds) {
      const player = session.state.players[playerId];
      if (!player) {
        throw new Error(`Player "${playerId}" not found in session`);
      }
      const config = session.config.playerProperties[key];
      const current = player.properties[key];
      let resolved = resolveValue(
        pv,
        current,
        session,
        { ...valueCtx, targetPlayerId: playerId },
        config,
      );
      validateRefValue(resolved, config, session, path);
      if (
        ctx.actorId &&
        typeof current === "number" &&
        typeof resolved == "number"
      ) {
        // Set state is adjustable if directed at a player, so create a pending
        // effect and emit before.
        let finalValue: number = resolved;
        const stateWriteEvent = {
          kind: "state-write" as const,
          direction: resolved >= current ? "increase" : "decrease",
          path,
          resolvedValue: resolved,
          targetId: playerId,
          actorId: ctx.actorId,
        } satisfies StateWriteEvent;
        const pending = session.bus?.emitBeforeStateWrite(stateWriteEvent, session);
        if (pending?.cancelled) {
          session.logger?.info(
            { path, targetId: playerId },
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
            { path, targetId: playerId, resolvedValue: finalValue },
            "state-write adjusted by passive",
          );
        }
        player.properties[key] = finalValue;
        await session.bus?.emitAfterStateWrite({
          ...stateWriteEvent,
          resolvedValue: finalValue,
        } satisfies StateWriteEvent, session);
        session.events.emit({
          kind: "state:change",
          change: {
            kind: "state:property-changed",
            scope: "player",
            playerId,
            property: key,
            oldValue: current,
            newValue: finalValue,
          },
        });
      } else {
        player.properties[key] = resolved;
        session.events.emit({
          kind: "state:change",
          change: {
            kind: "state:property-changed",
            scope: "player",
            playerId,
            property: key,
            oldValue: current,
            newValue: resolved,
          },
        });
      }
    }
  } else {
    throw new Error(
      `Invalid set-state path: "${path}". Expected game.property.<id> or player.property.<id>`,
    );
  }
}
