// ---------------------------------------------------------------------------
// Effect executor: set-random
//
// Picks a random value (from weighted options or a numeric range) and writes
// it to a state property. All entropy comes from the session's RngProvider
// for verifiable fairness.
//
// Source shapes:
//   { kind: 'options', options: [{ value, weight? }, ...] }
//     → weighted pick; omitted weights = equal probability
//   { kind: 'range', min, max }
//     → uniform random integer in [min, max]
// ---------------------------------------------------------------------------

import type { GameSession, EffectContext } from '#chaincraft/types.js';

type OptionEntry = { value: string | number | boolean; weight?: number };
type OptionsSource = { kind: 'options'; options: OptionEntry[] };
type RangeSource = { kind: 'range'; min: number; max: number };
type RandomSource = OptionsSource | RangeSource;
type SetRandomEffectDef = { source: RandomSource; path: string };

export async function executeSetRandom(
  session: GameSession,
  ctx: EffectContext<SetRandomEffectDef>,
): Promise<void> {
  const { source, path } = ctx.effectDef;

  const result = pickRandom(session, source);
  writeToPath(session, ctx.actorId, path, result);
}

function pickRandom(
  session: GameSession,
  source: RandomSource,
): string | number | boolean {
  const r = session.rng.nextFloat();

  if (source.kind === 'range') {
    // Uniform integer in [min, max]
    const span = source.max - source.min + 1;
    return source.min + Math.floor(r * span);
  }

  // Weighted options pick
  const options = source.options;
  const hasWeights = options.some((o) => o.weight !== undefined);

  if (!hasWeights) {
    // Equal probability: pick by index
    const idx = Math.floor(r * options.length);
    return options[idx].value;
  }

  // Weighted: normalize and pick
  const totalWeight = options.reduce((sum, o) => sum + (o.weight ?? 1), 0);
  let cumulative = 0;
  for (const option of options) {
    cumulative += (option.weight ?? 1) / totalWeight;
    if (r < cumulative) {
      return option.value;
    }
  }
  // Floating-point edge case: return last option
  return options[options.length - 1].value;
}

function writeToPath(
  session: GameSession,
  actorId: string | null,
  path: string,
  value: unknown,
): void {
  const segments = path.split('.');

  if (segments[0] === 'game' && segments[1] === 'property') {
    session.state.gameProperties[segments[2]] = value;
  } else if (segments[0] === 'player' && segments[1] === 'property') {
    const playerId = actorId;
    if (!playerId) {
      throw new Error(
        `set-random to player property "${segments[2]}" requires an actorId`,
      );
    }
    const player = session.state.players[playerId];
    if (!player) {
      throw new Error(`Player "${playerId}" not found`);
    }
    player.properties[segments[2]] = value;
  } else {
    throw new Error(`Invalid set-random path: "${path}"`);
  }
}
