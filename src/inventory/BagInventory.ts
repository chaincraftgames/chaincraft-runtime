import type { BagInventoryData, InventoryPlacement, RngProvider, SelectionMode } from '../types.js';
import type { Inventory } from './Inventory.js';
import { pickRandom } from './utils.js';

export class BagInventory implements Inventory {
  readonly structure = 'none' as const;

  constructor(private readonly data: BagInventoryData) {}

  select(mode: SelectionMode, count: number = 1, rng?: RngProvider): string[] {
    const { pieceIds } = this.data;
    if (typeof mode === 'object') {
      return pieceIds.includes(mode.id) ? [mode.id] : [];
    }
    switch (mode) {
      case 'all':
        return [...pieceIds];
      case 'top':
        return pieceIds.slice(0, count);
      case 'bottom':
        return pieceIds.slice(-count);
      case 'random':
        if (!rng) throw new Error('RNG required for random selection');
        return pickRandom(pieceIds, count, rng);
    }
  }

  has(pieceId: string): boolean {
    return this.data.pieceIds.includes(pieceId);
  }

  count(): number {
    return this.data.pieceIds.length;
  }

  add(pieceId: string, _placement?: InventoryPlacement): void {
    this.data.pieceIds.push(pieceId);
  }

  remove(pieceId: string): void {
    const { pieceIds } = this.data;
    const idx = pieceIds.indexOf(pieceId);
    if (idx === -1) throw new Error(`Piece ${pieceId} not found in bag inventory`);
    // Swap with last for O(1) removal — order is meaningless in a bag
    const last = pieceIds.length - 1;
    if (idx !== last) {
      pieceIds[idx] = pieceIds[last];
    }
    pieceIds.pop();
  }

  shuffle(_rng: RngProvider): void {
    // No-op — bags are unordered
  }

  toJSON(): BagInventoryData {
    return this.data;
  }
}
