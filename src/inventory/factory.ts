import type {
  GameSession,
  InventoryConfig,
  InventoryData,
  InventoryStructure,
} from "#chaincraft/types.js";
import type { Inventory } from "#chaincraft/inventory/Inventory.js";
import { BagInventory } from "#chaincraft/inventory/BagInventory.js";
import { StackInventory } from "#chaincraft/inventory/StackInventory.js";
import { LineInventory } from "#chaincraft/inventory/LineInventory.js";
import { GridInventory, cellKey } from "#chaincraft/inventory/GridInventory.js";
import { GraphInventory } from "#chaincraft/inventory/GraphInventory.js";

/** Wrap raw inventory data in the appropriate Inventory implementation. Internal — prefer getInventory(). */
function wrapInventoryData(data: InventoryData): Inventory {
  switch (data.structure) {
    case "none":
      return new BagInventory(data);
    case "stack":
      return new StackInventory(data);
    case "line":
      return new LineInventory(data);
    case "grid":
      return new GridInventory(data);
    case "graph":
      return new GraphInventory(data);
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
  const cacheKey = playerId
    ? `${playerId}:${inventoryId}`
    : `game:${inventoryId}`;
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

/** Create fresh empty inventory data for a given structure type. Pass config for grid inventories to pre-populate cells. */
export function createEmptyInventoryData(
  structure: InventoryStructure,
  config?: InventoryConfig,
): InventoryData {
  switch (structure) {
    case "none":
      return { structure: "none", pieceIds: [] };
    case "stack":
      return { structure: "stack", pieceIds: [] };
    case "line": {
      if (config?.lineLength !== undefined) {
        return {
          structure: "line",
          length: config.lineLength,
          slots: Array<string | null>(config.lineLength).fill(null),
        };
      }
      return { structure: "line", slots: [] };
    }
    case "grid": {
      const order = config?.gridOrder ?? "row-major";
      const cells: Record<string, string | null> = {};
      const dims = config?.gridDimensions;
      if (dims) {
        const { rows, columns } = dims;
        if (order === "row-major") {
          for (let r = 0; r < rows; r++)
            for (let c = 0; c < columns; c++) cells[cellKey(r, c)] = null;
        } else {
          for (let c = 0; c < columns; c++)
            for (let r = 0; r < rows; r++) cells[cellKey(r, c)] = null;
        }
      }
      return { structure: "grid", order, cells };
    }
    case "graph":
      return { structure: "graph", nodes: {} };
  }
}
