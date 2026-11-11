// ---------------------------------------------------------------------------
// Effect executor: move
//
// Moves gamepieces from a source inventory to a destination inventory, or
// repositions pieces within the same inventory.
//
// Source (from: GamepieceSelectorSchema):
//   - inventory: source inventory type ID
//   - player: optional PlayerTarget; may span several players (each piece leaves its own owner's inventory)
//   - select: top | bottom | random | all | { id }
//   - count: how many (default 1)
//   - ofType: filter by piece type
//
// Destination (to: InventoryTargetSchema):
//   - inventory: destination inventory type ID
//   - player: optional single-player target for a player-scoped destination
//   - at: optional placement (stack-top, line-index, grid-cell, graph-node, or { param })
// ---------------------------------------------------------------------------

import type {
  GameSession,
  EffectContext,
  InventoryPosition,
} from "#chaincraft/types.js";
import { selectGamepieceRefs } from "#chaincraft/effects/gamepiece-selector.js";
import type { GamepieceSelector } from "#chaincraft/effects/gamepiece-selector.js";
import { getInventory } from "#chaincraft/inventory/index.js";
import { resolvePlayerTarget } from "#chaincraft/effects/player-target.js";
import { GameRuntimeError } from "#chaincraft/errors.js";

type InventoryTarget = {
  player?: "actor" | { param: string } | { stateRef: string };
  inventory: string;
  at?: InventoryPosition | { param: string };
};

type MoveEffectDef = { from: GamepieceSelector; to: InventoryTarget };

/**
 * Resolve the placement from the `to.at` field.
 * If `at` is `{ param: inputId }`, resolve from action inputs.
 * Otherwise return the literal InventoryPlacement (or undefined for bag inventories).
 */
function resolvePlacement(
  at: InventoryTarget["at"],
  actionInputs: Record<string, unknown>,
): InventoryPosition | undefined {
  if (!at) return undefined;
  if ("param" in at) {
    const val = actionInputs[at.param];
    return val as InventoryPosition | undefined;
  }
  return at as InventoryPosition;
}

export async function executeMove(
  session: GameSession,
  ctx: EffectContext<MoveEffectDef>,
): Promise<void> {
  const { from, to } = ctx.effectDef;

  // 1. Select pieces from source; each remembers the inventory it came from
  const selected = selectGamepieceRefs(session, ctx, from);
  if (selected.length === 0) return;

  const fromInventoryId = from.inventory;

  // 2. Resolve destination inventory (always a single player when player-scoped)
  const toInventoryId = to.inventory;
  const toInvConfig = session.config.inventories[toInventoryId];
  const toScope = toInvConfig?.scope ?? "game";
  let resolvedToPlayerId: string | undefined;
  if (toScope === "player") {
    if (!to.player && !ctx.actorId) {
      throw new GameRuntimeError(
        "move-destination-no-player",
        `Move destination "${toInventoryId}" is player-scoped but has no player and no actor in context; ` +
          `name the destination player explicitly`,
      );
    }
    resolvedToPlayerId = resolvePlayerTarget(session, ctx, to.player)[0];
  }
  const destInv = getInventory(
    session,
    toInventoryId,
    resolvedToPlayerId ?? undefined,
  );

  if (!destInv) {
    throw new GameRuntimeError(
      "move-destination-missing",
      `Destination inventory "${toInventoryId}"` +
        (resolvedToPlayerId ? ` for player "${resolvedToPlayerId}"` : "") +
        " not found in session state",
    );
  }

  // 3. Resolve placement
  const placement = resolvePlacement(to.at, ctx.actionInputs);

  // 4. Move each piece
  for (const { pieceId, inventory: sourceInv, ownerId: fromOwnerId } of selected) {
    // Capture from-position before removal so hidden-piece clients know which slot vacated.
    const fromPosition = sourceInv.positionOf(pieceId);
    // Remove from source (if found there — it may already be absent for game:unassigned)
    if (sourceInv.has(pieceId)) {
      sourceInv.remove(pieceId);
    }

    // Add to destination
    destInv.add(pieceId, placement);

    // Update piece ownerId when crossing into a player-scoped inventory
    const piece = session.state.gamepieces[pieceId];
    if (piece && toScope === "player" && resolvedToPlayerId) {
      piece.ownerId = resolvedToPlayerId;
    }

    session.events.emit({
      kind: "state:change",
      change: {
        kind: "piece:moved",
        pieceId,
        from: {
          inventory: {
            inventoryId: fromInventoryId,
            ownerId: fromOwnerId,
          },
          position: fromPosition,
        },
        to: {
          inventory: {
            inventoryId: toInventoryId,
            ownerId: resolvedToPlayerId ?? undefined,
          },
          position: placement,
        },
      },
    });
  }
}
