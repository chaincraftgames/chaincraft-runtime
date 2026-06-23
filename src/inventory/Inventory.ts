import type {
  InventoryData,
  InventoryPlacement,
  InventoryStructure,
  RngProvider,
  SelectionMode,
} from '#chaincraft/types.js';

export interface Inventory {
  readonly structure: InventoryStructure;

  /** Returns pieceIds matching the selection mode. Does not modify the inventory. */
  select(mode: SelectionMode, count?: number, rng?: RngProvider): string[];

  has(pieceId: string): boolean;

  count(): number;

  /** Add a piece at the given placement (structure-specific default if omitted). */
  add(pieceId: string, placement?: InventoryPlacement): void;

  /** Remove a piece. Throws if not present. */
  remove(pieceId: string): void;

  /** Randomize piece order using the provided RNG (meaningful for stack/line; no-op for bag/grid/graph). */
  shuffle(rng: RngProvider): void;

  /** Returns the underlying serializable data (live reference, not a copy). */
  toJSON(): InventoryData;
}
