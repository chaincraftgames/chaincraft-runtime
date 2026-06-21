// ---------------------------------------------------------------------------
// Seeded PRNG — Mulberry32
//
// A simple, fast 32-bit PRNG suitable for deterministic game replays and
// testing. NOT cryptographically secure — production verifiable-fairness
// providers should use a commit-reveal or VRF-backed implementation.
//
// Produces the same sequence for the same seed, which means:
//   - Tests are fully deterministic
//   - Game replays produce identical outcomes
//   - On-chain verification can reproduce all random events
// ---------------------------------------------------------------------------

import type { RngProvider } from '#chaincraft/types.js';

/**
 * Create a seeded RngProvider using the Mulberry32 algorithm.
 *
 * @param seed - A 32-bit integer seed. Same seed → same sequence.
 */
export function createSeededRng(seed: number): RngProvider {
  let state = seed | 0; // ensure 32-bit integer

  return {
    nextFloat(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
