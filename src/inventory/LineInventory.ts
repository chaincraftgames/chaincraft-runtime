import type { 
  LineInventoryData, 
  InventoryPlacement, 
  RngProvider, 
  SelectionMode 
} from '#chaincraft/types.js';
import type { Inventory } from '#chaincraft/inventory/Inventory.js';
import { pickRandom, fisherYatesShuffle } from '#chaincraft/inventory/utils.js';

export class LineInventory implements Inventory {
  readonly structure = 'line' as const;

  constructor(private readonly data: LineInventoryData) {}

  select(mode: SelectionMode, count: number = 1, rng?: RngProvider): string[] {
    if (typeof mode === 'object') {
      return this.data.slots.includes(mode.id) ? [mode.id] : [];
    }
    const occupied = this.getOccupied();
    switch (mode) {
      case 'all':
        return occupied;
      case 'top':
        return occupied.slice(0, count);
      case 'bottom':
        return occupied.slice(-count);
      case 'random':
        if (!rng) throw new Error('RNG required for random selection');
        return pickRandom(occupied, count, rng);
    }
  }

  has(pieceId: string): boolean {
    return this.data.slots.includes(pieceId);
  }

  count(): number {
    return this.data.slots.filter(s => s !== null).length;
  }

  add(pieceId: string, placement?: InventoryPlacement): void {
    if (placement?.kind === 'line-index') {
      while (this.data.slots.length <= placement.index) {
        this.data.slots.push(null);
      }
      this.data.slots[placement.index] = pieceId;
    } else {
      // Default: first empty slot, or append
      const emptyIdx = this.data.slots.indexOf(null);
      if (emptyIdx !== -1) {
        this.data.slots[emptyIdx] = pieceId;
      } else {
        this.data.slots.push(pieceId);
      }
    }
  }

  remove(pieceId: string): void {
    const idx = this.data.slots.indexOf(pieceId);
    if (idx === -1) throw new Error(`Piece ${pieceId} not found in line inventory`);
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
