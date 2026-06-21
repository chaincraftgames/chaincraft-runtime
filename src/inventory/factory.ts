import type { GameSession, InventoryData, InventoryStructure } from '#chaincraft/types.js';
import type { Inventory } from '#chaincraft/inventory/Inventory.js';
import { BagInventory } from '#chaincraft/inventory//BagInventory.js';
import { StackInventory } from '#chaincraft/inventory//StackInventory.js';
import { LineInventory } from '#chaincraft/inventory//LineInventory.js';
import { GridInventory } from '#chaincraft/inventory//GridInventory.js';
import { GraphInventory } from '#chaincraft/inventory//GraphInventory.js';

/** Wrap raw inventory data in the appropriate Inventory implementation. Internal — prefer getInventory(). */
function wrapInventoryData(data: InventoryData): Inventory {
  switch (data.structure) {
    case 'none': return new BagInventory(data);
    case 'stack': return new StackInventory(data);
    case 'line': return new LineInventory(data);
    case 'grid': return new GridInventory(data);
    case 'graph': return new GraphInventory(data);
  }
}

/**
 * Get (or lazily create) a cached Inventory accessor for the given inventory.
 *
 * @param session     The game session (holds the cache)
 * @param inventoryId The inventory type ID
 * @param playerId    For player-scoped inventories, the owning player ID.
 *                    Omit for game-scoped inventories.
 * @returns The Inventory accessor, or undefined if the data doesn't exist.
 */
export function getInventory(
  session: GameSession,
  inventoryId: string,
  playerId?: string,
): Inventory | undefined {
  const cacheKey = playerId ? `${playerId}:${inventoryId}` : `game:${inventoryId}`;
  const cached = session._inventoryCache.get(cacheKey);
  if (cached) return cached;

  const data = playerId
    ? session.state.players[playerId]?.inventories[inventoryId]
    : session.state.gameInventories[inventoryId];
  if (!data) return undefined;

  const inv = wrapInventoryData(data);
  session._inventoryCache.set(cacheKey, inv);
  return inv;
}

/** Create fresh empty inventory data for a given structure type. */
export function createEmptyInventoryData(structure: InventoryStructure): InventoryData {
  switch (structure) {
    case 'none': return { structure: 'none', pieceIds: [] };
    case 'stack': return { structure: 'stack', pieceIds: [] };
    case 'line': return { structure: 'line', slots: [] };
    case 'grid': return { structure: 'grid', cells: {} };
    case 'graph': return { structure: 'graph', nodes: {} };
  }
}
