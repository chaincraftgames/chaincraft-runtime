// ---------------------------------------------------------------------------
// Effect executor: shuffle
//
// Randomizes the order of gamepieces in an inventory using the session's
// seeded RNG (Fisher-Yates). Meaningful for stack and line inventories;
// no-op for bag, grid, and graph inventories (where position is either
// unordered or spatially significant).
//
// Effect shape:
//   { kind: 'shuffle', inventory: string }
//
// The inventory is resolved via the effect context's actor player when the
// inventory is player-scoped. For game-scoped inventories (decks, discard
// piles, etc.) no player context is needed.
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';
import { getInventory } from '#chaincraft/inventory/index.js';

type ShuffleEffectDef = { inventory: string };

export async function executeShuffle(
  session: GameSession,
  ctx: EffectContext<ShuffleEffectDef>,
): Promise<void> {
  const { inventory: inventoryId } = ctx.effectDef;

  const invConfig = session.config.inventories[inventoryId];
  const scope = invConfig?.scope ?? 'game';

  const playerId =
    scope === 'player' ? (ctx.targetPlayerId ?? ctx.actorId ?? undefined) : undefined;

  const inv = getInventory(session, inventoryId, playerId ?? undefined);

  if (!inv) {
    throw new Error(
      `shuffle: inventory "${inventoryId}"` +
        (playerId ? ` for player "${playerId}"` : '') +
        ' not found in session state',
    );
  }

  inv.shuffle(session.rng);
}
