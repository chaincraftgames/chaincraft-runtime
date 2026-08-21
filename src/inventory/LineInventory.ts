import type {
  LineInventoryData,
  InventoryPosition,
  RngProvider,
  SelectionMode,
} from "#chaincraft/types.js";
import type { Inventory } from "#chaincraft/inventory/Inventory.js";
import { pickRandom, fisherYatesShuffle } from "#chaincraft/inventory/utils.js";

export class LineInventory implements Inventory {
  readonly structure = "line" as const;

  constructor(private readonly data: LineInventoryData) {}

  select(mode: SelectionMode, count: number = 1, rng?: RngProvider): string[] {
    if (typeof mode === "object") {
      return this.data.slots.includes(mode.id) ? [mode.id] : [];
    }
    const occupied = this.getOccupied();
    switch (mode) {
      case "all":
        return occupied;
      case "top":
        return occupied.slice(0, count);
      case "bottom":
        return occupied.slice(-count);
      case "random":
        if (!rng) throw new Error("RNG required for random selection");
        return pickRandom(occupied, count, rng);
    }
  }

  has(pieceId: string): boolean {
    return this.data.slots.includes(pieceId);
  }

  count(): number {
    return this.data.slots.filter((s) => s !== null).length;
  }

  add(pieceId: string, placement?: InventoryPosition): void {
    if (placement?.kind === "line-index") {
      if (this.data.length !== undefined && placement.index >= this.data.length)
        throw new Error(
          `line-index ${placement.index} out of bounds (length ${this.data.length})`,
        );
      while (this.data.slots.length <= placement.index) {
        this.data.slots.push(null);
      }
      this.data.slots[placement.index] = pieceId;
    } else {
      const emptyIdx = this.data.slots.indexOf(null);
      if (emptyIdx !== -1) {
        this.data.slots[emptyIdx] = pieceId;
      } else if (this.data.length !== undefined) {
        throw new Error(`line inventory is full (length ${this.data.length})`);
      } else {
        this.data.slots.push(pieceId);
      }
    }
  }

  positionOf(pieceId: string): InventoryPosition | undefined {
    const idx = this.data.slots.indexOf(pieceId);
    return idx === -1 ? undefined : { kind: "line-index", index: idx };
  }

  remove(pieceId: string): void {
    const idx = this.data.slots.indexOf(pieceId);
    if (idx === -1)
      throw new Error(`Piece ${pieceId} not found in line inventory`);
    this.data.slots[idx] = null;
  }

  shuffle(rng: RngProvider): void {
    const occupied = this.getOccupied();
    fisherYatesShuffle(occupied, rng);
    let oi = 0;
    for (let i = 0; i < this.data.slots.length; i++) {
      if (this.data.slots[i] !== null) {
        this.data.slots[i] = occupied[oi++];
      }
    }
  }

  toJSON(): LineInventoryData {
    return this.data;
  }

  private getOccupied(): string[] {
    return this.data.slots.filter((s): s is string => s !== null);
  }
}
