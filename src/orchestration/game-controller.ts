// ---------------------------------------------------------------------------
// GameController — public API for driving one game session.
//
// Owns the settle loop: after each step it drains the outbox, auto-resolves
// system suspensions (llm / external-data) via an optional SystemResponder,
// and fires events for messages, prompts, and completion.
//
// Multi-prompt model: pendingPrompts maps each awaited playerId to their
// current PlayerInputSuspension. GameController diffs the declared waiting set
// from each step result and fires onPrompt once per newly-appearing suspension.
// currentPrompt is a convenience for single-prompt (sequential) games.
//
// Event-callback re-entrancy: onMessage, onPrompt, and onComplete all fire
// synchronously during the await of init() / processAction(), before the
// promise resolves. Callbacks must not call processAction() re-entrantly.
//
// Usage:
//   const ctrl = new GameController(module, { events: { onPrompt, onMessage, onComplete } });
//   await ctrl.init('game-1', ['alice', 'bob']);
//   // onPrompt fires (if a player prompt is pending)
//   await ctrl.processAction({ playerId: 'alice', value: ... });
// ---------------------------------------------------------------------------

import type { 
  CompiledGameModule, 
  GameState, 
  Message 
} from '#chaincraft/types.js';
import type {
  GameExecutionState,
  GameExecutionDeps,
  PlayerInput,
  PlayerInputSuspension,
  StepResult,
  LlmSuspension,
  ExternalDataSuspension,
  SystemResponse,
  GameOutcome,
} from './types.js';
import { step } from './game-step.js';
import { createFlowRunner } from './flow-runner.js';
import { resolveOptions } from './options.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Answers llm / external-data suspensions. */
export type SystemResponder = (
  suspension: LlmSuspension | ExternalDataSuspension,
) => Promise<unknown>;

export interface GameControllerEvents {
  /** A player must act. Fires after init()/processAction() apply all pending work. */
  onPrompt?(prompt: PlayerInputSuspension): void;
  /** One call per Message drained from session.outbox, in emission order. */
  onMessage?(message: Message): void;
  /** Terminal. Fires at most once; no onPrompt fires after it. */
  onComplete?(outcome: GameOutcome): void;
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
 * A GameController instance is responsible for executing a single game session,
 * draining the session outbox, auto-resolving system suspensions, and firing events 
 * for messages, prompts, and completion.
 */
export class GameController {
  /** The compiled game module this controller is running. */
  private readonly module: CompiledGameModule;
  /** The options used to configure this controller. */
  private readonly options: GameControllerOptions;

  /** Live execution state. Set during init(), undefined beforehand. */
  private execState: GameExecutionState | undefined = undefined;
  // Dependencies needed by the game execution.
  private deps: GameExecutionDeps | undefined = undefined;

  /** Pending player prompts, keyed by player ID. */
  #pendingPrompts = new Map<string, PlayerInputSuspension>();
  /** Live view of all pending player-input suspensions, keyed by playerId. Read-only. */
  get pendingPrompts(): ReadonlyMap<string, PlayerInputSuspension> {
    return this.#pendingPrompts;
  }

  /** The final outcome of the game, if it has completed. */
  #outcome: GameOutcome | undefined = undefined;
  /** The game outcome, once complete. */
  get outcome(): GameOutcome | undefined {
    return this.#outcome;
  }

  /** First pending prompt or undefined — convenience for single-prompt (sequential) games. */
  get currentPrompt(): PlayerInputSuspension | undefined {
    const first = this.#pendingPrompts.values().next();
    return first.done ? undefined : first.value;
  }

  /** Whether the game has completed. */
  get isComplete(): boolean {
    return this.#outcome !== undefined;
  }

  constructor(module: CompiledGameModule, options: GameControllerOptions = {}) {
    this.module = module;
    this.options = options;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** 
   * Create the session and run until first player prompt or completion. players
   * is the list of player ids.  The order of players is used to determine turn order 
   * for "next-player" input types.
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
    const result = await step(this.execState, undefined, this.deps);
    await this.settle(result);
  }

  /** 
   * Apply one player's response to the player's current prompt; run until next 
   * prompt/completion. 
   */
  public async processAction(input: PlayerInput): Promise<void> {
    if (this.#outcome !== undefined) {
      throw new Error('Game is already complete');
    }
    if (!this.#pendingPrompts.has(input.playerId)) {
      throw new Error(`No prompt is awaiting player "${input.playerId}"`);
    }
    // If step() throws, #pendingPrompts is untouched (settle never ran).
    const result = await step(this.execState!, input, this.deps!);
    await this.settle(result);
  }

  /**
   * Deep snapshot (structuredClone) of game state.
   * playerId is reserved for future per-player visibility filtering.
   */
  public getState(_playerId?: string): GameState {
    if (!this.execState) {
      throw new Error('GameController not initialized — call init() first');
    }
    return structuredClone(this.execState.session.state);
  }

  

  /** Returns the pending suspension for the given player, or undefined if none. */
  public promptFor(playerId: string): PlayerInputSuspension | undefined {
    return this.#pendingPrompts.get(playerId) ?? undefined;
  }

  /**
   * Drains the outbox, auto-resolves system suspensions, then diffs the
   * declared waiting set against pendingPrompts and fires onPrompt for
   * each newly-appearing suspension.
   */
  private async settle(result: StepResult): Promise<void> {
    this.drainOutbox();

    while (result.kind === 'suspended') {
      // Single pass: partition waiting into first system suspension + player suspensions.
      let systemSuspension: LlmSuspension | ExternalDataSuspension | undefined;
      const playerSuspensions: PlayerInputSuspension[] = [];

      for (const s of result.waiting) {
        if (s.kind === 'player-input') {
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
          this.deps!
        );
        this.drainOutbox();
        continue;
      }

      // No system suspensions — diff player suspensions, then replace map with
      // updated set. Fire onPrompt for each newly-appearing suspension.
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
      return;
    }

    if (result.kind === 'complete') {
      this.#pendingPrompts.clear();
      this.#outcome = result.outcome;
      this.options.events?.onComplete?.(result.outcome);
    }
  }

  /**
   * Splices all pending messages from the session outbox and fires onMessage
   * once per message, in emission order.
   */
  private drainOutbox(): void {
    const outbox = this.execState!.session.outbox;
    if (outbox.length === 0) return;
    const messages = outbox.splice(0) as Message[];
    for (const message of messages) {
      this.options.events?.onMessage?.(message);
    }
  }
}
