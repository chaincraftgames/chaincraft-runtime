// ---------------------------------------------------------------------------
// Gamepiece selector — resolves a GamepieceSelector from an effect def to
// concrete piece IDs using the session's inventory data.
//
// Selector shape (from gamedef GamepieceSelectorSchema):
//   inventory: string      — inventory type ID
//   select: 'top' | 'bottom' | 'random' | 'all' | 'player-chooses'
//   count?: number          — how many to select (default: 1 for top/bottom/random)
//   ofType?: string         — filter to pieces of this gamepiece type
//   player?: PlayerTarget   — whose inventory, for player-scoped inventories
//
// Inventory scope resolution:
//   The inventory config's `scope` field tells us where the data lives:
//   - 'game'   → session.state.gameInventories[inventoryId]
//   - 'player' → session.state.players[<player>].inventories[inventoryId]
//     <player> comes from `player` (resolvePlayerTarget; may be several players,
//     `select`/`count` then apply per inventory). When omitted it is the actor;
//     with no actor this throws rather than widening to every player.
// ---------------------------------------------------------------------------

import type {
  GameSession,
  EffectContext,
  SelectionMode,
} from "#chaincraft/types.js";
import type { Inventory } from "#chaincraft/inventory/Inventory.js";
import { getInventory } from "#chaincraft/inventory/index.js";
import { resolvePlayerTarget } from "#chaincraft/effects/player-target.js";
import type { PlayerTarget } from "#chaincraft/effects/player-target.js";

export type GamepieceSelector = {
  player?: PlayerTarget;
  inventory: string;
  select: string | { id: string | { param: string } };
  count?: number;
  ofType?: string;
  filter?: (session: GameSession, pieceId: string, actorId?: string) => boolean;
};

/** A selected piece together with the inventory it was selected from. */
export type SelectedPiece = {
  pieceId: string;
  inventory: Inventory;
  /** Owning player for player-scoped inventories; undefined for game-scoped. */
  ownerId?: string;
};

/**
 * Resolve a gamepiece selector to an array of piece IDs.
 */
export function selectGamepieces(
  session: GameSession,
  ctx: EffectContext,
  selector: GamepieceSelector,
): string[] {
  return selectGamepieceRefs(session, ctx, selector).map((r) => r.pieceId);
}

/**
 * Like selectGamepieces, but reports which inventory each piece came from.
 * Executors that remove pieces (move, distribute) need this once a selector
 * can span several players' inventories.
 */
export function selectGamepieceRefs(
  session: GameSession,
  ctx: EffectContext,
  selector: GamepieceSelector,
): SelectedPiece[] {
  const sel = selector;
  const inventoryId = sel.inventory;
  const invConfig = session.config.inventories[inventoryId];
  const scope = invConfig?.scope ?? "game";

  const sources = resolveSources(session, ctx, sel, scope);

  // Handle { id: ... } select mode
  if (typeof sel.select === "object" && "id" in sel.select) {
    const idSpec = sel.select.id;
    const pieceId =
      typeof idSpec === "string"
        ? idSpec
        : typeof idSpec === "object" && "param" in idSpec
          ? String(ctx.actionInputs[idSpec.param] ?? "")
          : "";
    if (!pieceId) return [];
    // Return the piece if it's actually in one of the resolved inventories
    for (const { inventory, ownerId } of sources) {
      if (inventory.has(pieceId)) return [{ pieceId, inventory, ownerId }];
    }
    return [];
  }

  const selectMode = parseSelectMode(sel.select as string);
  const count = sel.count;

  const results: SelectedPiece[] = [];

  for (const { inventory: inv, ownerId } of sources) {
    let selected = inv.select(selectMode, count, session.rng);

    // Filter by gamepiece type if specified
    if (sel.ofType) {
      selected = selected.filter((id) => {
        const piece = session.state.gamepieces[id];
        return piece && piece.typeId === sel.ofType;
      });
    }

    if (sel.filter) {
      selected = selected.filter((id) =>
        sel.filter!(session, id, ctx.actorId ?? undefined),
      );
    }

    results.push(...selected.map((pieceId) => ({ pieceId, inventory: inv, ownerId })));
  }

  return results;
}

/**
 * Resolve the inventory instances a selector reads from, based on scope.
 */
function resolveSources(
  session: GameSession,
  ctx: EffectContext,
  sel: GamepieceSelector,
  scope: string,
): Array<{ inventory: Inventory; ownerId?: string }> {
  if (scope === "game") {
    const inv = getInventory(session, sel.inventory);
    return inv ? [{ inventory: inv }] : [];
  }

  if (scope === "player") {
    if (!sel.player && !ctx.actorId) {
      throw new Error(
        `Selector on player-scoped inventory "${sel.inventory}" has no player and no actor in context; ` +
          `name the players explicitly, e.g. player: all`,
      );
    }
    const playerIds = resolvePlayerTarget(session, ctx, sel.player);
    return playerIds.flatMap((pid) => {
      const inv = getInventory(session, sel.inventory, pid);
      return inv ? [{ inventory: inv, ownerId: pid }] : [];
    });
  }

  return [];
}

function parseSelectMode(mode: string): SelectionMode {
  if (
    mode === "top" ||
    mode === "bottom" ||
    mode === "random" ||
    mode === "all"
  ) {
    return mode;
  }
  // 'player-chooses' will be handled by the flow runner / IO adapter layer
  // For now treat it as 'top' (the flow runner should have resolved it already)
  return "top";
}
