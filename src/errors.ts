/**
 * Who most likely has to fix a fault.
 * - spec: the game spec (content can cause it)
 * - engine: a runtime or compiler bug
 * - host: the code embedding the runtime (controller misuse, missing handlers or responders)
 */
export type FaultOrigin = "spec" | "engine" | "host";

/** Every GameRuntimeError code and its origin. A code has exactly one origin. */
export const FAULT_ORIGINS = {
  // spec
  "step-budget-exceeded": "spec",
  "no-legal-actions": "spec",
  "action-unknown": "spec",
  "auto-input-unavailable": "spec",
  "from-player-invalid": "spec",
  "player-target-no-actor": "spec",
  "player-target-param-invalid": "spec",
  "player-target-stateref-path": "spec",
  "player-target-stateref-invalid": "spec",
  "player-selector-invalid": "spec",
  "state-path-unsupported": "spec",
  "selector-no-player": "spec",
  "move-destination-no-player": "spec",
  "move-destination-missing": "spec",
  "shuffle-inventory-missing": "spec",
  "set-state-invalid-ref": "spec",
  "set-state-invalid-path": "spec",
  "inventory-no-room": "spec",
  "evaluation-inventory-missing": "spec",
  "expression-invalid": "spec",
  "expression-path-invalid": "spec",
  "expression-no-actor": "spec",
  "expression-source-invalid": "spec",
  "expression-not-a-number": "spec",
  // engine
  "walk-mismatch": "engine",
  "fork-state-invalid": "engine",
  "hook-needs-input": "engine",
  "input-no-actor": "engine",
  "input-no-options": "engine",
  "validation-no-actor": "engine",
  "resume-mismatch": "engine",
  "effect-ref-unknown": "engine",
  "executor-missing": "engine",
  "suspending-effect-unsupported": "engine",
  "flow-node-missing": "engine",
  "flow-phase-invalid": "engine",
  "turn-order-unsupported": "engine",
  "mechanic-rule-unsupported": "engine",
  "player-target-unknown": "engine",
  "player-not-found": "engine",
  "piece-not-in-inventory": "engine",
  "rng-missing": "engine",
  "undo-no-prompt": "engine",
  "expression-unbound-root": "engine",
  "expression-ref-missing": "engine",
  // host
  "game-complete": "host",
  "no-pending-prompt": "host",
  "not-initialized": "host",
  "no-system-responder": "host",
  "no-custom-handler": "host",
} as const satisfies Record<string, FaultOrigin>;

export type FaultCode = keyof typeof FAULT_ORIGINS;

/** The codes whose origin is `O`. */
export type FaultCodeOf<O extends FaultOrigin> = {
  [K in FaultCode]: (typeof FAULT_ORIGINS)[K] extends O ? K : never;
}[FaultCode];

/** A fault raised while running a game, tagged with a stable code and its likely origin. */
export class GameRuntimeError extends Error {
  override name = "GameRuntimeError";
  readonly origin: FaultOrigin;

  constructor(
    public readonly code: FaultCode,
    message: string,
  ) {
    super(message);
    this.origin = FAULT_ORIGINS[code];
  }
}

/** Structural check, so it also holds across duplicate copies of this package. */
export function isGameRuntimeError(error: unknown): error is GameRuntimeError {
  return (
    error instanceof Error &&
    typeof (error as Partial<GameRuntimeError>).code === "string" &&
    Object.hasOwn(FAULT_ORIGINS, (error as GameRuntimeError).code) &&
    typeof (error as Partial<GameRuntimeError>).origin === "string"
  );
}
