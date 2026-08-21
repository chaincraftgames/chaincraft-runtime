import type {
  GridInventoryData,
  InventoryPosition,
  RngProvider,
  SelectionMode,
} from "#chaincraft/types.js";
import type { Inventory } from "#chaincraft/inventory/Inventory.js";
import { pickRandom } from "#chaincraft/inventory/utils.js";

export function cellKey(row: string | number, col: string | number): string {
  return `${row}:${col}`;
}

export class GridInventory implements Inventory {
  readonly structure = "grid" as const;

  constructor(private readonly data: GridInventoryData) {}

  select(mode: SelectionMode, count: number = 1, rng?: RngProvider): string[] {
    if (typeof mode === "object") {
      return Object.values(this.data.cells).includes(mode.id) ? [mode.id] : [];
    }
    const occupied = this.getOccupied();
    switch (mode) {
      case "all":
        return occupied;
      case "top":
      case "bottom":
        // No meaningful top/bottom on a grid — return first N occupied
        return occupied.slice(0, count);
      case "random":
        if (!rng) throw new Error("RNG required for random selection");
        return pickRandom(occupied, count, rng);
    }
  }

  has(pieceId: string): boolean {
    return Object.values(this.data.cells).includes(pieceId);
  }

  count(): number {
    return Object.values(this.data.cells).filter((v) => v !== null).length;
  }

  add(pieceId: string, placement?: InventoryPosition): void {
    if (placement?.kind === "grid-cell") {
      const key = cellKey(placement.row, placement.col);
      if (!(key in this.data.cells))
        throw new Error(`grid-cell ${key} out of bounds`);
      if (this.data.cells[key] !== null)
        throw new Error(`grid-cell ${key} is already occupied`);
      this.data.cells[key] = pieceId;
    } else {
      const emptyKey = Object.keys(this.data.cells).find(
        (k) => this.data.cells[k] === null,
      );
      if (!emptyKey) throw new Error("grid inventory is full");
      this.data.cells[emptyKey] = pieceId;
    }
  }

  positionOf(pieceId: string): InventoryPosition | undefined {
    const key = Object.keys(this.data.cells).find(
      (k) => this.data.cells[k] === pieceId,
    );
    if (!key) return undefined;
    const [row, col] = key.split(":");
    return { kind: "grid-cell", row, col };
  }

  remove(pieceId: string): void {
    const key = Object.keys(this.data.cells).find(
      (k) => this.data.cells[k] === pieceId,
    );
    if (!key) throw new Error(`Piece ${pieceId} not found in grid inventory`);
    this.data.cells[key] = null;
  }

  shuffle(_rng: RngProvider): void {
    // No-op — grid positions are spatially meaningful
  }

  toJSON(): GridInventoryData {
    return this.data;
  }

  private getOccupied(): string[] {
    return Object.values(this.data.cells).filter(
      (v): v is string => v !== null,
    );
  }
}
