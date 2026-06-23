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

export async function executeMessage(
  session: GameSession,
  ctx: EffectContext<MessageEffectDef>,
): Promise<void> {
  const { template, to = 'all' } = ctx.effectDef;
  const content = renderTemplate(template, session, ctx);
  session.outbox.push({ to, content });
}
