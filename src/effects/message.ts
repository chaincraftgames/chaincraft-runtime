// ---------------------------------------------------------------------------
// Effect executor: message
//
// Pushes a message to the session outbox. Messages are collected during
// effect execution and delivered by the host engine's IO adapter.
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';

type MessageEffectDef = { template: string; to?: string };

/**
 * Resolve a single `{{path}}` token from the template.
 * Supported paths:
 *   {{input.<id>}}                          → action input value
 *   {{state.game.property.<id>}}            → game-scoped property
 *   {{state.players.<playerId>.property.<id>}} → player-scoped property
 * Returns undefined when the path is unknown or the value is absent.
 */
function resolveToken(parts: string[], session: GameSession, ctx: EffectContext): unknown {
  if (parts[0] === 'input' && parts.length === 2) {
    return ctx.actionInputs[parts[1]];
  }
  if (parts[0] === 'state' && parts[1] === 'game' && parts[2] === 'property' && parts.length === 4) {
    return session.state.gameProperties[parts[3]];
  }
  if (parts[0] === 'state' && parts[1] === 'players' && parts[3] === 'property' && parts.length === 5) {
    return session.state.players[parts[2]]?.properties[parts[4]];
  }
  return undefined;
}

/**
 * Render a Handlebars-style template string against the current session and context.
 * Unrecognised tokens are left as-is ({{original}}).
 */
function renderTemplate(template: string, session: GameSession, ctx: EffectContext): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (original, raw: string) => {
    const parts = raw.trim().split('.');
    const val = resolveToken(parts, session, ctx);
    return val !== undefined && val !== null ? String(val) : original;
  });
}

/**
 * Resolve a `to` value to the concrete list of player IDs who should receive
 * the message. Called at effect execution time so `ctx.actorId` is available.
 *
 * Symbolic values:
 *   'all'         → every player in the session
 *   'actor'       → [actorId], falls back to all if no actor
 *   'opponents'   → all players except the actor, falls back to all if no actor
 *   'role:<id>'   → players whose `role` property matches `<id>`
 *   <playerId>    → [playerId] if they exist in the session, otherwise all (safe fallback)
 */
function resolveRecipients(
  to: string,
  session: GameSession,
  ctx: EffectContext,
): string[] {
  const allPlayers = Object.keys(session.state.players);
  switch (to) {
    case 'all':
      return allPlayers;
    case 'actor':
      return ctx.actorId ? [ctx.actorId] : allPlayers;
    case 'opponents':
      return ctx.actorId
        ? allPlayers.filter((p) => p !== ctx.actorId)
        : allPlayers;
    default:
      if (to.startsWith('role:')) {
        const roleId = to.slice(5);
        const matched = allPlayers.filter((p) => session.state.players[p]?.roles.includes(roleId));
        return matched.length > 0 ? matched : allPlayers;
      }
      // Specific player ID — use it directly if they're in the session
      return session.state.players[to] ? [to] : allPlayers;
  }
}

export async function executeMessage(
  session: GameSession,
  ctx: EffectContext<MessageEffectDef>,
): Promise<void> {
  const { template, to = 'all' } = ctx.effectDef;
  const content = renderTemplate(template, session, ctx);
  const recipients = resolveRecipients(to, session, ctx);
  session.outbox.push({ to, recipients, content });
}
