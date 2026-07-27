import type { 
  GameSession, 
  ActionInputDef, 
  EffectRef, 
  CompiledGameModule, 
  Grammar 
} from '#chaincraft/types.js';

// ---------------------------------------------------------------------------
// Engine — orchestration layer
//
// The engine has no state of its own beyond EngineState below. It drives a
// single loop (step()) that drains a queue of QueueItems until either the
// queue is empty and the flow tree has nothing left to do (complete), or
// something requires external input (prompt). There is no "action processor"
// vs "effect processor" — actions are exploded into queue items at
// resolution time and disappear as a runtime concept. See
// orchestration/game-controller.ts for the loop itself.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Queue items — the universal work list step() drains.
//
// An action (or a reactive/immediate-action triggered mid-chain) explodes
// into its inputs followed by its effects. All items from the same explosion
// share one `collected` bag by reference, so `{ param: id }` references in
// later effects resolve against inputs gathered earlier in that same group.
// Items pulled from elsewhere (e.g. a flow hook's effects) get their own
// (typically empty) bag.
// ---------------------------------------------------------------------------
/** Inputs collected so far for one exploded action/effect group, keyed by input id. */
export type CollectedInputs = Record<string, unknown>;

/**
 * Shared context for one exploded action/reactive/immediate-action group.
 * All input and effect items produced from the same explosion reference
 * the same QueueGroup, so later effects can resolve `{ param: id }` against
 * inputs collected earlier in the same group.
 */
export interface QueueGroup {
  /** 
   * Player whose action/reactive/immediate-slot this group belongs to. Undefined for 
   * game-level effect groups (flow hooks) with no acting player.
   */
  actorId: string | undefined;
  /** 
   * For reactive-triggered groups: the player whose action caused the trigger 
   * (resolves `effect-originator`). 
   */
  originatorId?: string;
  /** 
   * For reactive-triggered groups: the triggering action's collected inputs 
   * (resolves `trigger-input`). 
   */
  triggerInputs?: CollectedInputs;
  /** Inputs collected so far for this group, keyed by input id. */
  collected: CollectedInputs;
};

/** Queue item representing a player input. */
export interface InputQueueItem {
  kind: 'input';
  /** Input definition (from the action/effect that produced this item). */
  input: EngineInput;
  /** Group this input belongs to. */
  group: QueueGroup;
};

/** Queue item representing an effect. */
export interface EffectQueueItem {
  kind: 'effect';
  /** Named ref or inline effect def, resolved against `group.collected` at dequeue time. */
  effect: EffectRef;
  /** Group this effect belongs to. */
  group: QueueGroup;
};

export type QueueItem = InputQueueItem | EffectQueueItem;

// ---------------------------------------------------------------------------
// Suspension — anything that stops the drain loop and requires a response
// (or a timeout) before the engine can continue.
//
// There is only one player-facing kind. "Action selection" is not special —
// it's a player-input whose `input` happens to be an action-select (the
// flow runner offers the player's legal actions as its options). Likewise
// "simultaneous" and "interrupt window" aren't separate kinds — they're
// just a player-input with more than one entry in `awaiting` and,
// optionally, a `timeoutMs`. 'llm' and 'external-data' stay separate
// because they resume from a system response, not a PlayerInput.
// ---------------------------------------------------------------------------

export type SuspensionKind = 'player-input' | 'llm' | 'external-data';

/**
 * Input kinds the engine can prompt a player for. Every kind except
 * `action-select` mirrors a gamedef ActionInputSchema kind (via
 * ActionInputDef). `action-select` is engine-only — the flow runner
 * synthesizes it whenever a player must choose which action to take;
 * it never appears in a spec.
 *
 * The action-select variant carries its options explicitly rather than
 * reusing the generic `options` field so the UX never has to interpret
 * a magic sentinel string:
 *   - `actions`  — the IDs the player may choose from.
 *   - `canPass`  — whether the player may elect no action (pass).
 */
export type EngineInput = 
  | ActionInputDef 
  | { id: string; type: { kind: 'action-select'; actions: string[]; canPass: boolean }; label?: string };

/** Suspension representing a player input. */
export interface PlayerInputSuspension {
  kind: 'player-input';
  /**
   * Player who owes a response. The suspension resolves once this player responds
   * or timeout.
   */
  awaiting: string;
  /** Player's response. */
  response: unknown;
  /** Input definition (from the action/effect that produced this suspension). */
  input: EngineInput;
  /**
   * Runtime-resolved valid choices for non-action-select inputs (piece ids,
   * player ids, positions, etc.), computed lazily against current state.
   * Not used for action-select — those carry actions/canPass on their type.
   */
  options?: unknown[];
  label?: string;
  /**
   * Optional deadline. On expiry, still-`awaiting` players resolve via a
   * spec-defined default.
   */
  timeoutMs?: number;
}

/** Suspension representing an LLM request. */
export interface LlmSuspension {
  kind: 'llm';
  requestId: string;
}

/** Suspension representing an external data request. */
export interface ExternalDataSuspension {
  kind: 'external-data';
  /** Request ID for tracking the external data request. */
  requestId: string;
  /** Source of the external data. */
  source: string;
  /** Query parameters for the external data request. */
  query: Record<string, unknown>;
}

export type Suspension = PlayerInputSuspension | LlmSuspension | ExternalDataSuspension;

/**
 * The engine's current suspension, if any. Stored on EngineState between
 * step() calls. The resume handler for `pending.suspension.kind` applies
 * the incoming response and clears this field; step() then re-enters the
 * drain loop.
 */
export interface PendingSuspension {
  /** The kind of suspension currently blocking the engine. */
  suspension: Suspension;
  /** Group for the queue item/action explosion in progress (player-input, queue-level only). */
  group?: QueueGroup;
  /** Input id awaiting a value (player-input, queue-level only). */
  inputId?: string;
};

/** 
 * what the transport sends back to resume a player-input
 * suspension. One player may respond at a time even when a suspension is
 * awaiting several (e.g. simultaneous submission) — the resume handler
 * removes them from `awaiting` and records their answer in `responses`;
 * step() only continues once `awaiting` is empty (or the suspension times
 * out).
 */
export interface PlayerInput {
  /** Player id of the player responding to the suspension. */
  playerId: string;
  /** Value provided by the player in response to the suspension. */
  value: unknown;
};

// ---------------------------------------------------------------------------
// Flow position — where the flow runner currently is in the flow tree.
// One frame per nested node (loop/turn/simultaneous), pushed/popped as the
// flow runner descends/ascends. The engine only needs to persist this
// stack between steps; the flow runner owns the meaning of `localState`.
// ---------------------------------------------------------------------------
/** Flow frame representing the current position in the flow tree. */
export interface FlowFrame {
  nodeId: string;
  /** Flow-runner-owned bookkeeping (iteration count, grammar cursor, child index, etc.). */
  localState: Record<string, unknown>;
};

/**
 * Tracks one player's position within a turn node's grammar.
 * Shared by reference between TurnFrameState.cursors and PlayerRunnerState.cursor
 * so step() mutations are visible to the flow runner on the next advanceFlow call.
 */
export interface PlayerTurnCursor {
  sequenceIndex: number;
  repeatCount: number;
  /** True once this player's grammar has fully completed. */
  done: boolean;
}

/**
 * Initial state supplied by the flow runner for one player's runner when
 * the turn node forks. step() constructs a PlayerRunnerState from this and
 * computes the first unit of work itself via nextRunnerWork().
 */
export interface PlayerTurnInit {
  /**
   * Shared reference to the cursor in TurnFrameState.cursors[playerId].
   * Mutations by step() (via advanceGrammarCursor) are immediately visible
   * to the flow runner on the next advanceFlow call.
   */
  cursor: PlayerTurnCursor;
  /** Grammar for this turn node — needed by step() to compute each next unit of work. */
  grammar: Grammar;
  /** Label for action-select suspension prompts. */
  nodeLabel?: string;
}

/**
 * Per-player execution context during the acting phase of a turn node.
 * Each eligible actor gets their own queue and suspension so input collection
 * and actor-local effects can proceed independently.
 */
export interface PlayerTurnState {
  /** This player's pending input/effect items. */
  queue: QueueItem[];
  /** What this player is currently being asked for, if anything. */
  pending: PendingSuspension | undefined;
  /** True once the player's grammar cursor is done AND their queue is drained AND no pending. */
  done: boolean;
  /** Shared reference to TurnFrameState.cursors[playerId]. Mutations visible to flow runner. */
  cursor: PlayerTurnCursor;
  /** Grammar for this turn — needed to compute legal actions and advance cursor. */
  grammar: Grammar;
  /** Label for action-select prompts. */
  nodeLabel?: string;
}

/**
 * Everything step() needs, fully serializable. Wraps
 * GameSession (domain state: pieces, inventories, properties, rng) with
 * orchestration state (queue, suspension, flow position).
 */
export interface GameExecutionState {
  /** The current game session, including domain state (pieces, inventories, properties, rng). */
  session: GameSession;
  /** Game-level queue: hook effects and join-phase effects. Drained when playerRunners is undefined. */
  queue: QueueItem[];
  /** Game-level suspension currently blocking the engine, if any. */
  pending: PendingSuspension | undefined;
  /** The stack of flow frames representing the current position in the flow tree. */
  flowStack: FlowFrame[];
  /**
   * Per-player runners, active only during a turn node's acting phase.
   * Undefined at game level (hooks, between turns). When defined, step() operates
   * in fork mode: incoming inputs are routed by playerId; join fires when all
   * runners have done:true.
   */
  playerTurns: Record<string, PlayerTurnState> | undefined;
};

// ---------------------------------------------------------------------------
// StepResult — what step() returns: the engine is either waiting on input,
// or the game has ended.
// ---------------------------------------------------------------------------

/** Represents the outcome of a game. */
export interface GameOutcome {
  /** The IDs of the winning players, if any. */
  winnerIds?: string[];
  /** The reason the game ended. */
  reason: string;
};

/**
 * Represents the result of a single step in the game's processing loop.
 *
 * The game step runner declares the complete set of suspensions it is currently waiting 
 * on.  The same suspension may appear across consecutive results (idempotent reporting);
 * consumers are responsible for diffing to determine which suspensions are new.
 */
export type StepResult =
  | { kind: 'suspended'; state: GameExecutionState; waiting: Suspension[] }
  | { kind: 'complete'; state: GameExecutionState; outcome: GameOutcome };

// ---------------------------------------------------------------------------
// System response — what resumes an 'llm' or 'external-data' suspension.
// Unlike PlayerInput, this doesn't come from a player; it comes from the
// awaited system call completing.
// ---------------------------------------------------------------------------

/** Represents a response from the system, used to resume an 'llm' or 'external-data' suspension. */
export interface SystemResponse {
  /** The ID of the request that this response corresponds to. */
  requestId: string;
  /** The result of the system call. */
  result: unknown;
}

// ---------------------------------------------------------------------------
// Flow hand-off — called by step() whenever the queue empties (including
// right after a flow-level player-input suspension fully resolves). The
// flow runner advances the flow tree and either hands back more queue
// items to drain, raises its own suspension (action-selection, simultaneous,
// interrupt window — all just `player-input` with the right `awaiting`/
// `timeoutMs`), or reports the game is over.
// ---------------------------------------------------------------------------

/** Represents the result of advancing the flow tree. */
export type FlowAdvanceResult =
  | { kind: 'suspend'; suspension: Suspension }
  | { kind: 'enqueue'; items: QueueItem[] }
  /**
   * Fork: the turn node's acting phase begins. step() creates one PlayerRunnerState
   * per entry and enters fork mode. The flow runner is not called again until
   * the join condition is met (all runners done).
   */
  | { kind: 'fork'; runners: Record<string, PlayerTurnInit> }
  | { kind: 'complete'; outcome: GameOutcome };

/**
 * Advances the flow tree. `resolvedResponses` is passed when step() just
 * finished collecting a flow-level player-input suspension (keyed by
 * player id, e.g. which action each player chose) — omitted otherwise.
 */
export type AdvanceFlow = (
    state: GameExecutionState, 
    resolvedResponses?: Record<string, unknown>
) => FlowAdvanceResult;

/** Computes valid choices for a prompt, lazily, at suspend time, against current state. */
export type OptionsResolver = (
    state: GameExecutionState, 
    input: EngineInput,
    actorId?: string,
) => unknown[] | undefined;

/** Everything step() needs beyond EngineState itself — the compiled game and the two pluggable resolvers it can't own. */
export type GameExecutionDeps = {
  module: CompiledGameModule;
  advanceFlow: AdvanceFlow;
  resolveOptions: OptionsResolver;
};

// ---------------------------------------------------------------------------
// Resume handlers — one per SuspensionKind, registered once at startup.
// step() dispatches an incoming response to the handler matching
// state.pending.suspension.kind. A handler applies the input to
// EngineState (clear `pending`, push new queue items, etc.) and returns;
// step() then re-enters the drain loop. Handlers never know about each
// other or about the drain loop itself.
// ---------------------------------------------------------------------------

/** Handles resuming a suspended flow. */
export type ResumeHandler = (state: GameExecutionState, input: PlayerInput | SystemResponse) => void;

/** Maps each SuspensionKind to its corresponding ResumeHandler. */
export type ResumeHandlerRegistry = Partial<Record<SuspensionKind, ResumeHandler>>;
