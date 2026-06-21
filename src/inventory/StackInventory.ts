import type { StackInventoryData, InventoryPlacement, SelectionMode } from '../types.js';
import type { Inventory } from './Inventory.js';
import { pickRandom, fisherYatesShuffle } from './utils.js';

export class StackInventory implements Inventory {
  readonly structure = 'stack' as const;

  constructor(private readonly data: StackInventoryData) {}

  select(mode: SelectionMode, count: number = 1): string[] {
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
        return pickRandom(pieceIds, count);
    }
  }

  has(pieceId: string): boolean {
    return this.data.pieceIds.includes(pieceId);
  }

  count(): number {
    return this.data.pieceIds.length;
  }

  add(pieceId: string, placement?: InventoryPlacement): void {
    if (placement?.kind === 'stack-bottom') {
      this.data.pieceIds.push(pieceId);
    } else {
      // Default: top of stack
      this.data.pieceIds.unshift(pieceId);
    }
  }

  remove(pieceId: string): void {
    const { pieceIds } = this.data;
    const idx = pieceIds.indexOf(pieceId);
    if (idx === -1) throw new Error(`Piece ${pieceId} not found in stack inventory`);
    pieceIds.splice(idx, 1);
  }

  shuffle(): void {
    fisherYatesShuffle(this.data.pieceIds);
  }

  toJSON(): StackInventoryData {
    return this.data;
  }
}
