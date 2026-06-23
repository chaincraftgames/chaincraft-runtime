// ---------------------------------------------------------------------------
// Effect executor: distribute
//
// Deals a fixed number of pieces from a source inventory to all players,
// optionally filtered by role.
//
// Effect shape:
//   {
//     kind: 'distribute',
//     from: GamepieceSelectorSchema,   // source (from.count is overridden internally)
//     to: {
//       inventory: string,             // player-scoped destination inventory type
//       roles?: string[],              // optional — restrict to players holding one of these roles
//     },
//     count: number,                   // pieces to deal to each player
//     style: 'round-robin' | 'batch',  // default 'round-robin'
//   }
//
// Dealing styles:
//   round-robin — deal 1 piece to each player in turn, repeat 'count' times.
//                 Mimics natural card dealing. Piece order: player[i % n].
//   batch       — deal 'count' pieces to player[0], then player[1], etc.
//                 Useful for handing out resource bundles.
//
// Role filtering:
//   When to.roles is set, only players whose property values include one of
//   the listed role IDs receive pieces.
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';
import { selectGamepieces } from '#chaincraft/effects/gamepiece-selector.js';
import type { GamepieceSelector } from '#chaincraft/effects/gamepiece-selector.js';
import { getInventory } from '#chaincraft/inventory/index.js';

type DistributeTarget = { inventory: string; roles?: string[] };
type DistributeEffectDef = {
  from: GamepieceSelector;
  to: DistributeTarget;
  count: number;
  style?: 'round-robin' | 'batch';
};

/**
 * Resolve the ordered list of player IDs that will receive pieces.
 * Always all players, optionally filtered to those holding a listed role.
 */
function resolveTargetPlayers(
  session: GameSession,
  to: DistributeTarget,
): string[] {
  let players = [...session.players];

  // Role filter: a player qualifies if any of their property values matches a
  // listed role ID. Relies on the convention that role assignments are stored
  // as player properties via the set-state effect.
  if (to.roles && to.roles.length > 0) {
    players = players.filter((playerId) => {
      const props = session.state.players[playerId]?.properties ?? {};
      return to.roles!.some((role) => Object.values(props).includes(role));
    });
  }

  return players;
}

export async function executeDistribute(
  session: GameSession,
  ctx: EffectContext<DistributeEffectDef>,
): Promise<void> {
  const { from, to, count: countPerTarget, style = 'round-robin' } = ctx.effectDef;

  // 1. Resolve target players
  const targetPlayerIds = resolveTargetPlayers(session, to);
  if (targetPlayerIds.length === 0) return;

  // 2. Select pieces from source — override count to totalNeeded
  const totalNeeded = countPerTarget * targetPlayerIds.length;
  const fromWithCount = { ...from, count: totalNeeded };
  const pieceIds = selectGamepieces(session, ctx, fromWithCount);
  if (pieceIds.length === 0) return;

  // 3. Remove selected pieces from the source inventory
  const sourceInvId = from.inventory;
  const sourceInvConfig = session.config.inventories[sourceInvId];
  const sourceScope = sourceInvConfig?.scope ?? 'game';
  const sourcePlayerId =
    sourceScope === 'player' ? (ctx.targetPlayerId ?? ctx.actorId ?? undefined) : undefined;
  const sourceInv = getInventory(session, sourceInvId, sourcePlayerId ?? undefined);
  for (const id of pieceIds) {
    if (sourceInv?.has(id)) sourceInv.remove(id);
  }

  // 4. Distribute to targets
  const destInvId = to.inventory;
  const numTargets = targetPlayerIds.length;

  if (style === 'round-robin') {
    // Piece i goes to targetPlayerIds[i % numTargets]
    for (let i = 0; i < pieceIds.length; i++) {
      const targetPlayerId = targetPlayerIds[i % numTargets];
      const destInv = getInventory(session, destInvId, targetPlayerId);
      if (destInv) {
        destInv.add(pieceIds[i]);
        const piece = session.state.gamepieces[pieceIds[i]];
        if (piece) piece.ownerId = targetPlayerId;
      }
    }
  } else {
    // batch: deal countPerTarget pieces to each target in sequence
    for (let t = 0; t < numTargets; t++) {
      const targetPlayerId = targetPlayerIds[t];
      const destInv = getInventory(session, destInvId, targetPlayerId);
      if (destInv) {
        for (let i = 0; i < countPerTarget; i++) {
          const pieceIdx = t * countPerTarget + i;
          if (pieceIdx >= pieceIds.length) break;
          destInv.add(pieceIds[pieceIdx]);
          const piece = session.state.gamepieces[pieceIds[pieceIdx]];
          if (piece) piece.ownerId = targetPlayerId;
        }
      }
    }
  }
}
