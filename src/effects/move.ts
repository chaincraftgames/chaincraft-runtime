// ---------------------------------------------------------------------------
// Effect executor: move
//
// Moves gamepieces from a source inventory to a destination inventory, or
// repositions pieces within the same inventory.
//
// Source (from: GamepieceSelectorSchema):
//   - inventory: source inventory type ID
//   - player: optional dynamic player targeting (stateRef or param)
//   - select: top | bottom | random | all | { id }
//   - count: how many (default 1)
//   - ofType: filter by piece type
//
// Destination (to: InventoryTargetSchema):
//   - inventory: destination inventory type ID
//   - player: optional dynamic player targeting for destination
//   - at: optional placement (stack-top, line-index, grid-cell, graph-node, or { param })
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext, InventoryPlacement } from '#chaincraft/types.js';
import { selectGamepieces } from './gamepiece-selector.js';
import type { GamepieceSelector } from './gamepiece-selector.js';
import { getInventory } from '#chaincraft/inventory/index.js';
import { resolvePlayerRef } from './player-target.js';

type InventoryTarget = {
  player?: { stateRef: string } | { param: string };
  inventory: string;
  at?: InventoryPlacement | { param: string };
};

type MoveEffectDef = { from: GamepieceSelector; to: InventoryTarget };

/**
 * Resolve the placement from the `to.at` field.
 * If `at` is `{ param: inputId }`, resolve from action inputs.
 * Otherwise return the literal InventoryPlacement (or undefined for bag inventories).
 */
function resolvePlacement(
  at: InventoryTarget['at'],
  actionInputs: Record<string, unknown>,
): InventoryPlacement | undefined {
  if (!at) return undefined;
  if ('param' in at) {
    const val = actionInputs[at.param];
    return val as InventoryPlacement | undefined;
  }
  return at as InventoryPlacement;
}

export async function executeMove(
  session: GameSession,
  ctx: EffectContext<MoveEffectDef>,
): Promise<void> {
  const { from, to } = ctx.effectDef;

  // 1. Resolve source player if explicitly specified
  const fromPlayerRef = from.player;
  const fromPlayerId = fromPlayerRef
    ? resolvePlayerRef(session, ctx, fromPlayerRef)
    : undefined;

  // Override targetPlayerId for source selection if explicitly specified
  const fromCtx = fromPlayerId ? { ...ctx, targetPlayerId: fromPlayerId } : ctx;

  // 2. Select pieces from source
  const pieceIds = selectGamepieces(session, fromCtx, from);
  if (pieceIds.length === 0) return;

  // 3. Resolve source inventory
  const fromInventoryId = from.inventory;
  const fromInvConfig = session.config.inventories[fromInventoryId];
  const fromScope = fromInvConfig?.scope ?? 'game';
  const resolvedFromPlayerId =
    fromScope === 'player' ? (fromPlayerId ?? fromCtx.targetPlayerId ?? fromCtx.actorId) : undefined;
  const sourceInv = getInventory(session, fromInventoryId, resolvedFromPlayerId ?? undefined);

  // 4. Resolve destination player
  const toPlayerRef = to.player;
  const toPlayerId = toPlayerRef
    ? resolvePlayerRef(session, ctx, toPlayerRef)
    : undefined;

  // 5. Resolve destination inventory
  const toInventoryId = to.inventory;
  const toInvConfig = session.config.inventories[toInventoryId];
  const toScope = toInvConfig?.scope ?? 'game';
  const resolvedToPlayerId =
    toScope === 'player' ? (toPlayerId ?? ctx.targetPlayerId ?? ctx.actorId) : undefined;
  const destInv = getInventory(session, toInventoryId, resolvedToPlayerId ?? undefined);

  if (!destInv) {
    throw new Error(
      `Destination inventory "${toInventoryId}"` +
        (resolvedToPlayerId ? ` for player "${resolvedToPlayerId}"` : '') +
        ' not found in session state',
    );
  }

  // 6. Resolve placement
  const placement = resolvePlacement(to.at, ctx.actionInputs);

  // 7. Move each piece
  for (const pieceId of pieceIds) {
    // Remove from source (if found there — it may already be absent for game:unassigned)
    if (sourceInv?.has(pieceId)) {
      sourceInv.remove(pieceId);
    }

    // Add to destination
    destInv.add(pieceId, placement);

    // Update piece ownerId when crossing into a player-scoped inventory
    const piece = session.state.gamepieces[pieceId];
    if (piece && toScope === 'player' && resolvedToPlayerId) {
      piece.ownerId = resolvedToPlayerId;
    }
  }
}
