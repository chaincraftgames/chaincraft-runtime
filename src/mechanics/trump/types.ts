// ---------------------------------------------------------------------------
// Trump mechanic — runtime types
//
// General who-beats-whom resolution: ranks pieces in an evaluation inventory
// via a chain of rules (dominant, comparison, matrix) and writes the winner
// to game state. See gamedef/src/mechanics/trump.ts for the spec schema.
// ---------------------------------------------------------------------------

/** Base for all trump rule kinds. */
export interface TrumpRuleBase {
  kind: 'matrix' | 'comparison' | 'dominant';
  property: string; // piece property id to compare
}

/**
 * Matrix rule: value A beats values B (Rock-Paper-Scissors style).
 * `beats` maps each property value to the values it defeats.
 */
export interface MatrixTrumpRule extends TrumpRuleBase {
  kind: 'matrix';
  beats: Record<string, string[]>;
}

/**
 * Comparison rule: highest or lowest value wins.
 * Optional `order` array for custom orderings (first = lowest rank).
 */
export interface ComparisonTrumpRule extends TrumpRuleBase {
  kind: 'comparison';
  direction: 'highest' | 'lowest';
  order?: string[];
}

/**
 * Dominant rule: a piece holding the dominant value wins outright.
 * `dominantValue` is a literal or a JsonLogic expression resolved at runtime.
 */
export interface DominantTrumpRule extends TrumpRuleBase {
  kind: 'dominant';
  dominantValue: string | number | Record<string, unknown>;
}

export type TrumpRule = MatrixTrumpRule | ComparisonTrumpRule | DominantTrumpRule;

/** Compiled trump mechanic instance — one per chaincraft:trump in the spec. */
export interface TrumpMechanic {
  id?: string;
  label?: string;
  evaluationInventory: string;
  winnerToState?: string;
  winningPieceToState?: string;
  rules: TrumpRule[];
}
