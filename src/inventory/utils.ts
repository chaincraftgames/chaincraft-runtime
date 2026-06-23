import type { RngProvider } from '#chaincraft/types.js';

export function pickRandom(arr: readonly string[], count: number, rng: RngProvider): string[] {
  const copy = [...arr];
  const n = Math.min(count, copy.length);
  // Partial Fisher-Yates: shuffle the last n positions, return them
  for (let i = copy.length - 1; i >= copy.length - n && i > 0; i--) {
    const j = Math.floor(rng.nextFloat() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(copy.length - n);
}

export function fisherYatesShuffle(arr: string[], rng: RngProvider): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.nextFloat() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
