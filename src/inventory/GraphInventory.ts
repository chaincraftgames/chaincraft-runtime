import type { GraphInventoryData, InventoryPlacement, SelectionMode } from '../types.js';
import type { Inventory } from './Inventory.js';
import { pickRandom } from './utils.js';

export class GraphInventory implements Inventory {
  readonly structure = 'graph' as const;

  constructor(private readonly data: GraphInventoryData) {}

  select(mode: SelectionMode, count: number = 1): string[] {
    if (typeof mode === 'object') {
      return Object.values(this.data.nodes).includes(mode.id) ? [mode.id] : [];
    }
    const occupied = this.getOccupied();
    switch (mode) {
      case 'all':
        return occupied;
      case 'top':
      case 'bottom':
        // No meaningful top/bottom on a graph — return first N occupied
        return occupied.slice(0, count);
      case 'random':
        return pickRandom(occupied, count);
    }
  }

  has(pieceId: string): boolean {
    return Object.values(this.data.nodes).includes(pieceId);
  }

  count(): number {
    return Object.values(this.data.nodes).filter(v => v !== null).length;
  }

  add(pieceId: string, placement?: InventoryPlacement): void {
    if (placement?.kind === 'graph-node') {
      this.data.nodes[placement.nodeId] = pieceId;
    } else {
      // Default: first empty node
      const emptyNode = Object.keys(this.data.nodes).find(k => this.data.nodes[k] === null);
      if (emptyNode) {
        this.data.nodes[emptyNode] = pieceId;
      }
    }
  }

  remove(pieceId: string): void {
    const nodeId = Object.keys(this.data.nodes).find(k => this.data.nodes[k] === pieceId);
    if (!nodeId) throw new Error(`Piece ${pieceId} not found in graph inventory`);
    this.data.nodes[nodeId] = null;
  }

  shuffle(): void {
    // No-op — graph positions are spatially meaningful
  }

  toJSON(): GraphInventoryData {
    return this.data;
  }

  private getOccupied(): string[] {
    return Object.values(this.data.nodes).filter((v): v is string => v !== null);
  }
}
