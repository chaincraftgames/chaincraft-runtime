import type {
  InventoryData,
  InventoryPlacement,
  InventoryStructure,
  SelectionMode,
} from '../types.js';

export interface Inventory {
  readonly structure: InventoryStructure;

  /** Returns pieceIds matching the selection mode. Does not modify the inventory. */
  select(mode: SelectionMode, count?: number): string[];

  has(pieceId: string): boolean;

  count(): number;

  /** Add a piece at the given placement (structure-specific default if omitted). */
  add(pieceId: string, placement?: InventoryPlacement): void;

  /** Remove a piece. Throws if not present. */
  remove(pieceId: string): void;

  /** Randomize piece order (meaningful for stack/line; no-op for bag/grid/graph). */
  shuffle(): void;

  /** Returns the underlying serializable data (live reference, not a copy). */
  toJSON(): InventoryData;
}
