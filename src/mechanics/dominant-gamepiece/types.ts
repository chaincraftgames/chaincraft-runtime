// ---------------------------------------------------------------------------
// Dominant-gamepiece mechanic — runtime types
//
// General who-beats-whom resolution: ranks pieces in an evaluation inventory
// via a chain of rules (dominant, comparison, matrix) and writes the winner
// to game state. See gamedef/src/mechanics/dominant-gamepiece.ts for the spec schema.
// ---------------------------------------------------------------------------

/** Base for all dominant-gamepiece rule kinds. */
export interface DominantGamepieceRuleBase {
  kind: 'matrix' | 'comparison' | 'dominant';
  property: string; // piece property id to compare
}

/**
 * Matrix rule: value A beats values B (Rock-Paper-Scissors style).
 * `beats` maps each property value to the values it defeats.
 */
export interface MatrixDominantGamepieceRule extends DominantGamepieceRuleBase {
  kind: 'matrix';
  beats: Record<string, string[]>;
}

/**
 * Comparison rule: highest or lowest value wins.
 * Optional `order` array for custom orderings (first = lowest rank).
 */
export interface ComparisonDominantGamepieceRule extends DominantGamepieceRuleBase {
  kind: 'comparison';
  direction: 'highest' | 'lowest';
  order?: string[];
}

/**
 * Dominant rule: a piece holding the dominant value wins outright.
 * `dominantValue` is a literal or a JsonLogic expression resolved at runtime.
 */
export interface DominantValueRule extends DominantGamepieceRuleBase {
  kind: 'dominant';
  dominantValue: string | number | Record<string, unknown>;
}

export type DominantGamepieceRule = MatrixDominantGamepieceRule | ComparisonDominantGamepieceRule | DominantValueRule;

/** Compiled dominant-gamepiece mechanic instance — one per chaincraft:dominant-gamepiece in the spec. */
export interface DominantGamepieceMechanic {
  id?: string;
  label?: string;
  evaluationInventory: string;
  winnerToState?: string;
  winningPieceToState?: string;
  rules: DominantGamepieceRule[];
}
