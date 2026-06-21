// ---------------------------------------------------------------------------
// Gamepiece selector — resolves a GamepieceSelector from an effect def to
// concrete piece IDs using the session's inventory data.
//
// Selector shape (from gamedef GamepieceSelectorSchema):
//   inventory: string      — inventory type ID
//   select: 'top' | 'bottom' | 'random' | 'all' | 'player-chooses'
//   count?: number          — how many to select (default: 1 for top/bottom/random)
//   ofType?: string         — filter to pieces of this gamepiece type
//
// Inventory scope resolution:
//   The inventory config's `scope` field tells us where the data lives:
//   - 'game'   → session.state.gameInventories[inventoryId]
//   - 'player' → session.state.players[actorId].inventories[inventoryId]
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext, SelectionMode } from '#chaincraft/types.js';
import type { Inventory } from '#chaincraft/inventory/Inventory.js';
import { getInventory } from '#chaincraft/inventory/index.js';

export type GamepieceSelector = {
  inventory: string;
  select: string;
  count?: number;
  ofType?: string;
};

/**
 * Resolve a gamepiece selector to an array of piece IDs.
 */
export function selectGamepieces(
  session: GameSession,
  ctx: EffectContext,
  selector: Record<string, unknown>,
): string[] {
  const sel = selector as unknown as GamepieceSelector;
  const inventoryId = sel.inventory;
  const invConfig = session.config.inventories[inventoryId];
  const scope = invConfig?.scope ?? 'game';

  const inventories = resolveInventories(session, ctx, inventoryId, scope);

  const selectMode = parseSelectMode(sel.select);
  const count = sel.count;

  const results: string[] = [];

  for (const inv of inventories) {
    let selected = inv.select(selectMode, count);

    // Filter by gamepiece type if specified
    if (sel.ofType) {
      selected = selected.filter((id) => {
        const piece = session.state.gamepieces[id];
        return piece && piece.typeId === sel.ofType;
      });
    }

    results.push(...selected);
  }

  return results;
}

/**
 * Resolve inventory instances for a selector based on scope.
 */
function resolveInventories(
  session: GameSession,
  ctx: EffectContext,
  inventoryId: string,
  scope: string,
): Inventory[] {
  if (scope === 'game') {
    const inv = getInventory(session, inventoryId);
    return inv ? [inv] : [];
  }

  if (scope === 'player') {
    // Use the resolved target player, falling back to the actor
    const playerId = ctx.targetPlayerId ?? ctx.actorId;
    if (playerId) {
      const inv = getInventory(session, inventoryId, playerId);
      return inv ? [inv] : [];
    }
    // No player context — return all players' inventories of this type
    return session.players
      .map((pid) => getInventory(session, inventoryId, pid))
      .filter((inv): inv is Inventory => inv !== undefined);
  }

  return [];
}

function parseSelectMode(mode: string): SelectionMode {
  if (mode === 'top' || mode === 'bottom' || mode === 'random' || mode === 'all') {
    return mode;
  }
  // 'player-chooses' will be handled by the flow runner / IO adapter layer
  // For now treat it as 'top' (the flow runner should have resolved it already)
  return 'top';
}
