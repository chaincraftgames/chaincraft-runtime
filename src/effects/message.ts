// ---------------------------------------------------------------------------
// Effect executor: message
//
// Pushes a message to the session outbox. Messages are collected during
// effect execution and delivered by the host engine's IO adapter.
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';

export async function executeMessage(
  session: GameSession,
  ctx: EffectContext,
): Promise<void> {
  const def = ctx.effectDef;
  const content = def['content'] as string;
  const to = (def['to'] as string | undefined) ?? 'all';

  session.outbox.push({ to, content });
}
