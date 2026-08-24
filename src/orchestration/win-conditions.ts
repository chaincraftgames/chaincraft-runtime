// ---------------------------------------------------------------------------
// Win-condition evaluator — pure function, no side effects on session.
// ---------------------------------------------------------------------------

import type {
  GameSession,
  WinConditionDef,
  EffectRef,
} from "#chaincraft/types.js";
import { rankBy, topRanked } from "#chaincraft/utils/ranking.js";

/** The result of evaluating win conditions. */
export interface WinConditionResult {
  winnerIds: string[];
  onVictoryEffects: EffectRef[];
}

/**
 * Evaluates all win conditions against the current session state.
 * Rules are evaluated in declaration order; all matching conditions apply
 * (union of winners). Each matched condition's onVictory effects are
 * collected in order.
 */
export function evaluateWinConditions(
  session: GameSession,
  conditions: WinConditionDef[],
): WinConditionResult {
  const winners = new Set<string>();
  const onVictoryEffects: EffectRef[] = [];

  for (const condition of conditions) {
    let matched: string[];
    switch (condition.rule) {
      case "ranking":
        matched = evaluateRanking(session, condition);
        break;
      case "condition":
        matched = evaluateCondition(session, condition);
        break;
    }

    if (matched.length > 0) {
      for (const id of matched) winners.add(id);
      if (condition.onVictory) {
        onVictoryEffects.push(...condition.onVictory);
      }
    }
  }

  return { winnerIds: [...winners], onVictoryEffects };
}

function evaluateRanking(
  session: GameSession,
  def: Extract<WinConditionDef, { rule: "ranking" }>,
): string[] {
  const players = session.players;
  if (players.length === 0) return [];

  const ranks = rankBy(players, (id) => def.value(session, id), def.order);
  const best = topRanked(players, ranks);

  if (best.length > 1 && def.tiebreak === "no-winner") {
    return [];
  }

  return best;
}

function evaluateCondition(
  session: GameSession,
  def: Extract<WinConditionDef, { rule: "condition" }>,
): string[] {
  return session.players.filter((playerId) => def.condition(session, playerId));
}
