// ---------------------------------------------------------------------------
// GameController — public API for driving one game session.
//
// Owns the settle loop: after each step it drains the outbox, auto-resolves
// system suspensions (llm / external-data) via an optional SystemResponder,
// and fires events for messages, prompts, completion, and state changes.
//
// Multi-prompt model: pendingPrompts maps each awaited playerId to their
// current PlayerInputSuspension. GameController diffs the declared waiting set
// from each step result and fires onPrompt once per newly-appearing suspension.
// currentPrompt is a convenience for single-prompt (sequential) games.
//
// Event-callback re-entrancy: onMessage, onPrompt, onComplete, and onStateChange
// all fire synchronously during the await of init() / processAction(), before
// the promise resolves. Callbacks must not call processAction() re-entrantly.
//
// Usage:
//   const ctrl = new GameController(module, { events: { onPrompt, onMessage, onComplete } });
//   await ctrl.init('game-1', ['alice', 'bob']);
//   await ctrl.processAction({ playerId: 'alice', value: ... });
// ---------------------------------------------------------------------------

import type {
  CompiledGameModule,
  GameSession,
  GameState,
  Message,
} from "#chaincraft/types.js";
import type {
  GameExecutionState,
  GameExecutionDeps,
  PlayerInput,
  PlayerInputSuspension,
  StepResult,
  LlmSuspension,
  ExternalDataSuspension,
  GameOutcome,
} from "#chaincraft/orchestration/types.js";
import { step } from "#chaincraft/orchestration/game-step.js";
import { createFlowRunner } from "#chaincraft/orchestration/flow-runner.js";
import { resolveOptions } from "#chaincraft/orchestration/options.js";
import type { ProjectedState } from "#chaincraft/state/projection.js";
import {
  projectStateForPlayer,
  projectStateChanges,
} from "#chaincraft/state/projection.js";
import type { StateChangeEvent } from "#chaincraft/api/state-change-events.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Answers llm / external-data suspensions. */
export type SystemResponder = (
  suspension: LlmSuspension | ExternalDataSuspension,
) => Promise<unknown>;

/** Callbacks the host registers to observe game progress. */
export interface GameControllerEvents {
  // -- Game control ----------------------------------------------------------
  /** A player must act. Fires after init()/processAction() settle all pending work. */
  onPrompt?(prompt: PlayerInputSuspension): void;
  /** One call per Message drained from session.outbox, in emission order. */
  onMessage?(message: Message): void;
  /** Terminal. Fires at most once; no onPrompt fires after it. */
  onComplete?(outcome: GameOutcome): void;
  // -- State observation -----------------------------------------------------
  /** Batch of resolved state mutations from one action, in occurrence order. */
  onStateChange?(changes: StateChangeEvent[]): void;
}

export interface GameControllerOptions {
  events?: GameControllerEvents;
  /** Answers llm/external-data suspensions. Required if the module can raise them. */
  systemResponder?: SystemResponder;
}

// ---------------------------------------------------------------------------
// GameController
// ---------------------------------------------------------------------------

/**
 * Drives a single game session: runs the step loop, resolves system suspensions,
 * delivers messages/prompts/state-changes to the host via callbacks.
 */
export class GameController {
  private readonly module: CompiledGameModule;
  private readonly options: GameControllerOptions;

  /** Live execution state — undefined until init() completes. */
  private execState: GameExecutionState | undefined = undefined;
  private deps: GameExecutionDeps | undefined = undefined;

  /** Whether init() has been called and the game is running. */
  get isInitialized(): boolean {
    return this.execState !== undefined;
  }

  #pendingPrompts = new Map<string, PlayerInputSuspension>();
  get pendingPrompts(): ReadonlyMap<string, PlayerInputSuspension> {
    return this.#pendingPrompts;
  }

  #outcome: GameOutcome | undefined = undefined;
  get outcome(): GameOutcome | undefined {
    return this.#outcome;
  }

  /** Convenience for single-prompt (sequential) games. */
  get currentPrompt(): PlayerInputSuspension | undefined {
    const first = this.#pendingPrompts.values().next();
    return first.done ? undefined : first.value;
  }

  get isComplete(): boolean {
    return this.#outcome !== undefined;
  }

  /** Accumulates StateChangeEvents from the internal bus during one action. */
  #pendingStateChanges: StateChangeEvent[] = [];

  constructor(module: CompiledGameModule, options: GameControllerOptions = {}) {
    this.module = module;
    this.options = options;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Create the session and run until first player prompt or completion.
   * Player order determines turn order for "next-player" input types.
   */
  public async init(gameId: string, players: string[]): Promise<void> {
    const session = this.module.createSession(gameId, players);
    this.execState = {
      session,
      queue: [],
      pending: undefined,
      flowStack: [],
      playerTurns: undefined,
    };
    this.deps = {
      module: this.module,
      advanceFlow: createFlowRunner(this.module),
      resolveOptions,
    };
    // Subscribe to internal state-change events; buffer until settle() flushes.
    session.events.on("state:change", (event) => {
      this.#pendingStateChanges.push(
        (event as { kind: string; change: StateChangeEvent }).change,
      );
    });
    session.events.emit({ kind: "game:init", gameId, players });
    const result = await step(this.execState, undefined, this.deps);
    await this.settle(result);
  }

  /**
   * Apply one player's response to their current prompt; run until next
   * prompt/completion.
   */
  public async processAction(input: PlayerInput): Promise<void> {
    if (this.#outcome !== undefined) {
      throw new Error("Game is already complete");
    }
    if (!this.#pendingPrompts.has(input.playerId)) {
      throw new Error(`No prompt is awaiting player "${input.playerId}"`);
    }
    const result = await step(this.execState!, input, this.deps!);
    await this.settle(result);
  }

  /** Deep snapshot of game state. */
  public getState(_playerId?: string): GameState {
    if (!this.execState) {
      throw new Error("GameController not initialized — call init() first");
    }
    return structuredClone(this.execState.session.state);
  }

  /** Returns game state projected for the given player (visibility rules applied). */
  public projectStateForPlayer(playerId: string): ProjectedState {
    if (!this.execState) {
      throw new Error("GameController not initialized — call init() first");
    }
    return projectStateForPlayer(this.execState.session, playerId);
  }

  /** Returns state-change events projected for the given player (visibility rules applied). */
  public projectStateChangesForPlayer(
    changes: StateChangeEvent[],
    playerId: string,
  ): StateChangeEvent[] {
    if (!this.execState) return changes;
    return projectStateChanges(this.execState.session, changes, playerId);
  }

  /** Returns the pending suspension for the given player, or undefined if none. */
  public promptFor(playerId: string): PlayerInputSuspension | undefined {
    return this.#pendingPrompts.get(playerId) ?? undefined;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async settle(result: StepResult): Promise<void> {
    this.drainOutbox();

    while (result.kind === "suspended") {
      let systemSuspension: LlmSuspension | ExternalDataSuspension | undefined;
      const playerSuspensions: PlayerInputSuspension[] = [];

      for (const s of result.waiting) {
        if (s.kind === "player-input") {
          playerSuspensions.push(s as PlayerInputSuspension);
        } else {
          systemSuspension ??= s as LlmSuspension | ExternalDataSuspension;
        }
      }

      if (systemSuspension) {
        if (!this.options.systemResponder) {
          throw new Error(
            `Controller raised a "${systemSuspension.kind}" suspension but no systemResponder is configured`,
          );
        }
        const value = await this.options.systemResponder(systemSuspension);
        result = await step(
          this.execState!,
          { requestId: systemSuspension.requestId, result: value },
          this.deps!,
        );
        this.drainOutbox();
        continue;
      }

      // Diff player suspensions and fire onPrompt for newly-appearing ones.
      for (const suspension of playerSuspensions) {
        const playerId = suspension.awaiting;
        if (this.#pendingPrompts.get(playerId) !== suspension) {
          this.options.events?.onPrompt?.(suspension);
        }
      }
      this.#pendingPrompts.clear();
      for (const suspension of playerSuspensions) {
        this.#pendingPrompts.set(suspension.awaiting, suspension);
      }
      this.#flushStateChanges();
      return;
    }

    if (result.kind === "complete") {
      this.#pendingPrompts.clear();
      this.#outcome = result.outcome;
      this.execState!.session.events.emit({
        kind: "game:complete",
        outcome: result.outcome,
      });
      this.options.events?.onComplete?.(result.outcome);
    }
    this.#flushStateChanges();
  }

  private drainOutbox(): void {
    const outbox = this.execState!.session.outbox;
    if (outbox.length === 0) return;
    const messages = outbox.splice(0) as Message[];
    for (const message of messages) {
      this.execState!.session.events.emit({ kind: "message:emit", message });
      this.options.events?.onMessage?.(message);
    }
  }

  /** Delivers buffered state changes to the host and clears the buffer. */
  #flushStateChanges(): void {
    if (this.#pendingStateChanges.length === 0) return;
    const changes = this.#pendingStateChanges.splice(0);
    this.options.events?.onStateChange?.(changes);
  }
}
