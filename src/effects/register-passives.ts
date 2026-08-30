// ---------------------------------------------------------------------------
// register-passives.ts — builds and registers BeforeEntry/AfterEntry for each
// PassiveActivation on the EffectBus at session init (and restoreSession).
//
// Before-passives (timing: "before"):
//   Compiled effects must be cancel-effect or adjust kinds only.
//   Handled inline via pending.cancel() / pending.adjust().
//
// After-passives (timing: "after"):
//   Compiled effects are dispatched synchronously to the executor map.
//   actorId is derived from the triggering event.
// ---------------------------------------------------------------------------

import type {
  GameSession,
  PassiveActivation,
  EffectRegistration,
} from "#chaincraft/types.js";
import type {
  EffectBus,
  PendingEffect,
  EffectEvent,
  AdjustablePendingEffect,
} from "#chaincraft/effects/effect-bus.js";
import { matchesPassiveActivation } from "#chaincraft/effects/passive-matcher.js";

/** Register passive activations on the EffectBus. */
export function registerPassiveActivations(
  bus: EffectBus,
  activations: PassiveActivation[],
  session: GameSession,
  effects: Record<string, EffectRegistration> = {},
): void {
  for (const activation of activations) {
    if (activation.timing === "before") {
      bus.onBefore(activation.trigger.kind, {
        match: (event, s) => matchesPassiveActivation(activation, event, s),
        act: (pending: PendingEffect) => {
          for (const effect of activation.compiledEffects) {
            const e = effect as Record<string, unknown>;
            if (e.kind === "cancel-effect") {
              pending.cancel();
              return;
            }
            if (e.kind === "adjust") {
              const ap = pending as AdjustablePendingEffect;
              if (typeof e.delta === "number") ap.adjust({ delta: e.delta });
              else if (typeof e.mult === "number") ap.adjust({ mult: e.mult });
            }
          }
        },
      });
    } else {
      bus.onAfter(activation.trigger.kind, {
        match: (event, s) => matchesPassiveActivation(activation, event, s),
        act: async (event: EffectEvent, s: GameSession): Promise<void> => {
          // SkipTurnEvent has no actorId; all others do.
          const actorId = event.kind !== "skip-turn" ? event.actorId : null;
          for (const effectDef of activation.compiledEffects) {
            const def = effectDef as Record<string, unknown>;
            const kind = def.kind as string | undefined;
            if (!kind) continue;
            const executor = effects[kind];
            if (!executor || executor.kind !== "effect-executor") continue;
            await executor.execute(s, {
              actorId,
              effectDef: def,
              actionInputs: {},
            });
          }
        },
      });
    }
  }
}
