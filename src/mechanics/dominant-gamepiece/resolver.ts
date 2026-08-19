// ---------------------------------------------------------------------------
// Dominant-gamepiece mechanic — resolver executor
//
// Creates an EffectRegistration that, when executed, ranks all pieces in the
// configured evaluationInventory using the mechanic's rule chain and writes
// the winning piece's owner to winnerToState (and/or the piece ID to
// winningPieceToState).
//
// Slice-0 support: `comparison` rule kind only, numeric values, no explicit
// `order` array. Throws with a clear message for `dominant`, `matrix`, and
// `order` arrays until Phase 6 (Absurd Armaments needs those).
// ---------------------------------------------------------------------------

import type { EffectRegistration, GameSession } from '#chaincraft/types.js';
import type {
  DominantGamepieceMechanic,
  DominantGamepieceRule,
} from './types.js';

/**
 * Rank pieces within a tie-group using one rule. Returns an array of ranks
 * (index corresponds to pieceIds index) where 0 = best.
 */
function rankByRule(
  rule: DominantGamepieceRule,
  pieceIds: string[],
  session: GameSession,
): number[] {
  if (rule.kind === 'dominant') {
    throw new Error(
      `dominant-gamepiece: rule kind 'dominant' is not yet supported (Phase 6). ` +
        `Mechanic was: evaluationInventory=${(session as unknown as { _mechanic?: string })._mechanic ?? '?'}`,
    );
  }
  if (rule.kind === 'matrix') {
    throw new Error(`dominant-gamepiece: rule kind 'matrix' is not yet supported (Phase 6).`);
  }

  // comparison
  if (rule.order) {
    throw new Error(
      `dominant-gamepiece: explicit 'order' arrays in comparison rules are not yet supported (Phase 6).`,
    );
  }

  const values = pieceIds.map((id) =>
    Number(session.state.gamepieces[id]?.properties[rule.property] ?? 0),
  );

  // rank = number of OTHER pieces in this group with a strictly better value
  return values.map((v, i) =>
    values.reduce((rank, other, j) => {
      if (j === i) return rank;
      const otherBetter =
        rule.direction === 'highest' ? other > v : other < v;
      return rank + (otherBetter ? 1 : 0);
    }, 0),
  );
}

/**
 * Creates an EffectRegistration that resolves the dominant gamepiece for one
 * mechanic instance. The mechanic config is captured at compile time —
 * no runtime re-parsing of effectDef needed.
 */
export function createDominantGamepieceResolver(
  mechanic: DominantGamepieceMechanic,
): EffectRegistration {
  return {
    kind: 'effect-executor',
    execute: async (session: GameSession): Promise<void> => {
      const inv = session.state.gameInventories[mechanic.evaluationInventory];
      if (!inv) {
        throw new Error(
          `dominant-gamepiece: evaluation inventory '${mechanic.evaluationInventory}' not found`,
        );
      }

      const allPieceIds: string[] = 'pieceIds' in inv ? [...inv.pieceIds] : [];
      if (allPieceIds.length === 0) return;

      // Process rules as a chain: start with all pieces in one rank-0 group,
      // then refine ties within each group using successive rules.
      let rankGroups: string[][] = [allPieceIds];

      for (const rule of mechanic.rules) {
        const refined: string[][] = [];
        for (const group of rankGroups) {
          if (group.length <= 1) {
            refined.push(group);
            continue;
          }
          const ranks = rankByRule(rule, group, session);

          // Bucket pieces by rank within this group
          const buckets = new Map<number, string[]>();
          for (let i = 0; i < group.length; i++) {
            const r = ranks[i];
            if (!buckets.has(r)) buckets.set(r, []);
            buckets.get(r)!.push(group[i]);
          }
          // Emit buckets in rank order (0 = best first)
          for (const r of [...buckets.keys()].sort((a, b) => a - b)) {
            refined.push(buckets.get(r)!);
          }
        }
        rankGroups = refined;
      }

      // rankGroups[0] = rank-0 group (the "best" pieces)
      const winners = rankGroups[0];
      const isTie = winners.length !== 1;
      const winnerOwnerId = isTie
        ? ''
        : (session.state.gamepieces[winners[0]]?.ownerId ?? '');
      const winnerPieceId = isTie ? '' : winners[0];

      if (mechanic.winnerToState) {
        const parts = mechanic.winnerToState.split('.');
        if (parts[0] === 'game' && parts[1] === 'property' && parts[2]) {
          session.state.gameProperties[parts[2]] = winnerOwnerId;
        }
      }

      if (mechanic.winningPieceToState) {
        const parts = mechanic.winningPieceToState.split('.');
        if (parts[0] === 'game' && parts[1] === 'property' && parts[2]) {
          session.state.gameProperties[parts[2]] = winnerPieceId;
        }
      }
    },
  };
}
