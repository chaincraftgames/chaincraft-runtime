// ---------------------------------------------------------------------------
// passive-matcher.ts — shared trigger/scope/enablement matching for passives.
//
// Used by the passive registration routine to build the `match` functions
// stored in the EffectBus. The bus itself does no matching; it calls whatever
// match function is registered per entry.
//
// Scope resolution for piece bindings:
//   state-write scope:target — path prefix selects the entity being compared:
//     gamepiece.property.* → event.targetId === pieceId
//     player.property.*    → event.targetId === owner
//   state-write scope:actor  → event.actorId === owner (always player-scoped)
//   move/reveal scope:target → event.pieceOwnerId === owner
//   move/reveal scope:actor  → event.actorId === owner
//   skip-turn (target only)  → event.targetId === owner
//   Note: move/reveal events do not carry the affected pieceId — piece-scoped
//   move/reveal triggers are not expressible until those events are extended.
//
// Role bindings compare the relevant player's role list against binding.roleId.
//
// Enablement (piece bindings only): piece must be in an enabledIn inventory,
// pass faceFilter, and pass exhaustedFilter. Re-evaluated from live session
// state on every event — a piece leaving enabledIn silently stops matching.
// ---------------------------------------------------------------------------

import type {
  GameSession,
  PassiveActivation,
  PassivePieceActivation,
  PassiveBinding,
} from "#chaincraft/types.js";
import type {
  EffectEvent,
  PassiveTrigger,
} from "#chaincraft/effects/effect-bus.js";
import { getInventory } from "#chaincraft/inventory/factory.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Does the specified piece reside in the given inventory type (player scoped
 * inventories have a common inventory type id).
 */
function isPieceInInventoryType(
  session: GameSession,
  pieceId: string,
  invTypeId: string,
): boolean {
  const scope = session.config.inventories[invTypeId]?.scope;
  if (!scope || scope === "game") {
    if (getInventory(session, invTypeId)?.has(pieceId)) return true;
    if (scope === "game") return false;
  }
  if (!scope || scope === "player") {
    for (const playerId of Object.keys(session.state.players)) {
      if (getInventory(session, invTypeId, playerId)?.has(pieceId)) return true;
    }
  }
  return false;
}

/** Returns true if the player has the specified role. */
function playerHasRole(
  session: GameSession,
  playerId: string,
  roleId: string,
): boolean {
  return session.state.players[playerId]?.roles.includes(roleId) ?? false;
}

/**
 * Combines trigger/scope matching and enablement — the match function used
 * by register-passives for each BeforeEntry/AfterEntry on the bus.
 */
function matchesPassiveTrigger(
  trigger: PassiveTrigger,
  binding: PassiveBinding,
  event: EffectEvent,
  session: GameSession,
): boolean {
  if (trigger.kind !== event.kind) return false;

  if (trigger.kind === "skip-turn" && event.kind === "skip-turn") {
    if (binding.kind === "piece") {
      const owner = session.state.gamepieces[binding.pieceId]?.ownerId;
      return event.targetId === owner;
    }
    return playerHasRole(session, event.targetId, binding.roleId);
  }

  if (trigger.kind === "state-write" && event.kind === "state-write") {
    if (binding.kind === "piece") {
      const owner = session.state.gamepieces[binding.pieceId]?.ownerId;
      if (trigger.scope === "target") {
        // Path prefix selects whether the event target is the piece or its owner.
        const expected = trigger.path.startsWith("gamepiece.")
          ? binding.pieceId
          : owner;
        if (event.targetId !== expected) return false;
      } else {
        if (event.actorId !== owner) return false;
      }
    } else {
      const id = trigger.scope === "target" ? event.targetId : event.actorId;
      if (!playerHasRole(session, id, binding.roleId)) return false;
    }
    if (trigger.path !== event.path) return false;
    if (trigger.direction !== "any" && trigger.direction !== event.direction)
      return false;
    return true;
  }

  // TODO - move events do not carry the affected pieceId — piece-scoped move triggers
  // are not expressible until those events are extended.
  if (trigger.kind === "move" && event.kind === "move") {
    if (binding.kind === "piece") {
      const owner = session.state.gamepieces[binding.pieceId]?.ownerId;
      const id =
        trigger.scope === "target" ? event.pieceOwnerId : event.actorId;
      if (id !== owner) return false;
    } else {
      const id =
        trigger.scope === "target" ? event.pieceOwnerId : event.actorId;
      if (!playerHasRole(session, id, binding.roleId)) return false;
    }
    if (
      trigger.fromInventory &&
      !trigger.fromInventory.includes(event.fromInventoryType)
    )
      return false;
    if (
      trigger.toInventory &&
      !trigger.toInventory.includes(event.toInventoryType)
    )
      return false;
    return true;
  }

  // TODO - reveal events do not carry the affected pieceId — piece-scoped reveal triggers
  // are not expressible until those events are extended.
  if (trigger.kind === "reveal" && event.kind === "reveal") {
    if (binding.kind === "piece") {
      const owner = session.state.gamepieces[binding.pieceId]?.ownerId;
      const id =
        trigger.scope === "target" ? event.pieceOwnerId : event.actorId;
      if (id !== owner) return false;
    } else {
      const id =
        trigger.scope === "target" ? event.pieceOwnerId : event.actorId;
      if (!playerHasRole(session, id, binding.roleId)) return false;
    }
    if (trigger.inventory && !trigger.inventory.includes(event.inventoryType))
      return false;
    return true;
  }

  return false;
}

/**
 * Returns true if the piece's enablement conditions are met for this activation.
 * Always returns true for role bindings (no inventory gate).
 */
function enablementSatisfied(
  activation: PassiveActivation,
  session: GameSession,
): boolean {
  if (activation.binding.kind !== "piece") return true;

  const pieceId = activation.binding.pieceId;
  // Cast: piece bindings come from PassivePieceActivation (enablement fields present).
  const pa = activation as PassivePieceActivation;
  const piece = session.state.gamepieces[pieceId];
  if (!piece) return false;

  if (pa.enabledIn && pa.enabledIn.length > 0) {
    const inAllowed = pa.enabledIn.some((invTypeId) =>
      isPieceInInventoryType(session, pieceId, invTypeId),
    );
    if (!inAllowed) return false;
  }

  if (pa.faceFilter === "face-up-only" && !piece.faceUp) return false;
  if (pa.faceFilter === "face-down-only" && piece.faceUp) return false;
  if (pa.exhaustedFilter === "ready-only" && piece.exhausted) return false;
  if (pa.exhaustedFilter === "exhausted-only" && !piece.exhausted) return false;

  if (pa.condition && !pa.condition(session, pieceId)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if the passive activation matches the event and current game state
 * (enablement conditions).
 */
export function matchesPassiveActivation(
  activation: PassiveActivation,
  event: EffectEvent,
  session: GameSession,
): boolean {
  return (
    matchesPassiveTrigger(
      activation.trigger,
      activation.binding,
      event,
      session,
    ) && enablementSatisfied(activation, session)
  );
}
