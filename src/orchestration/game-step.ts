// ---------------------------------------------------------------------------
// @internal
// game-step — the game-level drain loop.
//
// Processes queues of input and effect items. There are two distinct queue
// scopes; this module owns both:
//
//   Game-level queue (state.queue):
//     Hook effects (onEnter, onComplete), join-phase effects, and any future
//     game-wide bookkeeping. Always active. Input items here must be
//     auto-resolvable (effect-originator, trigger-input) — game-level hooks
//     must never prompt a player directly.
//
//   Player queues (state.playerTurns[id].queue):
//     Active only during a turn node's acting phase (fork mode). Each player
//     gets their own isolated queue; items are produced by the player-effects-
//     resolver and drained independently. Player queue items NEVER flow into
//     the game-level queue — the two scopes are entirely separate. When a
//     player queue empties, the player-effects-resolver is consulted for the
//     next unit of work (another action's items, or an action-select prompt).
//     When all player queues are exhausted and all cursors are done, the join
//     fires: playerTurns is cleared and the game-level drain resumes
//     (advanceFlow is called to advance the flow tree).
//
// Fork invariant: after any drain pass (drainAllPlayerTurns), every player
// turn is settled — either done or holding a pending suspension. The resume
// path relies on this: once the resumed player settles, either the join fires
// or another player's pending prompt is surfaced.
//
// Suspensions are always surfaced by the step function, never by the
// player-effects-resolver directly. The resolver returns a PlayerTurnSignal
// describing WHAT the suspension should be; the step stores it on the
// player turn's pending slot and propagates the suspension up to the host via
// the DrainContext signal chain. This means all state mutation and prompt
// delivery live here.
//
// The unified drainQueue() function processes one queue's input and effect
// items, delegating to a DrainContext at two branch points:
//   onEmpty()              — game-level calls advanceFlow; player calls nextPlayerTurnWork
//   onPlayerInputNeeded()  — game-level throws; player stores on runner.pending
// ---------------------------------------------------------------------------

import type {
  EffectContext,
  EffectRef,
  CompiledGameModule,
} from '#chaincraft/types.js';
import type {
  GameExecutionState,
  StepResult,
  InputQueueItem,
  EffectQueueItem,
  PlayerInput,
  SystemResponse,
  Suspension,
  PlayerInputSuspension,
  PlayerTurnState,
  PlayerTurnInit,
  QueueItem,
  QueueGroup,
  GameExecutionDeps,
  OptionsResolver,
} from './types.js';
import {
  nextPlayerTurnWork as nextPlayerTurnSignal,
  explodeAction,
} from './player-effects-resolver.js';
import {
  advanceGrammarCursor,
} from './grammar.js';

/** Sentinel value indicating no automatic input is available. */
const NO_AUTO_VALUE = Symbol('no-auto-value');

/** The complete set of suspensions the execution is currently waiting on. */
function collectWaiting(state: GameExecutionState): Suspension[] {
  const waiting: Suspension[] = [];
  if (state.pending?.suspension) {
    waiting.push(state.pending.suspension);
  }
  if (state.playerTurns) {
    for (const playerTurn of Object.values(state.playerTurns)) {
      if (!playerTurn.done && playerTurn.pending?.suspension) {
        waiting.push(playerTurn.pending.suspension);
      }
    }
  }
  return waiting;
}

// ---------------------------------------------------------------------------
// DrainContext — the two callbacks that differ between game-level and
// fork-mode drain. The shared drainQueue loop calls these at branch points.
// ---------------------------------------------------------------------------

/**
 * Signal returned by a DrainContext callback to tell the drain loop what to do next.
 * - continue: more items were pushed onto the queue; keep draining.
 * - prompt:   suspend and return this to the host.
 * - complete: game over.
 * - fork:     player turns were initialized; caller must drain them (game-level only).
 * - turn-complete: the player turn is completed; trigger join check (fork mode only).
 */
type DrainSignal =
  | { kind: 'continue' }
  | { kind: 'prompt'; suspension: Suspension }
  | { kind: 'complete'; outcome: { reason: string; winnerIds?: string[] } }
  | { kind: 'fork' }
  | { kind: 'turn-complete' };

/**
 * Context for draining a queue. The drain loop calls these callbacks at branch points:
 */
interface DrainContext {
  /**
   * Called when the queue empties. Should push new items or return a terminal
   * signal. Game-level: calls advanceFlow. Fork-mode (per-player): calls nextRunnerWork.
   */
  onEmpty(): DrainSignal;
  /**
   * Called when a queue input item needs a real player response.
   * Game-level: throws (hook effects must be auto-resolvable).
   * Fork-mode (per-player): stores the suspension on the player's pending slot and
   * returns a prompt signal.
   */
  onPlayerInputNeeded(
    suspension: PlayerInputSuspension,
    group: QueueGroup,
    inputId: string,
  ): DrainSignal;
}

/** Advances the game by one step, processing inputs and effects. */
export async function step(
  state: GameExecutionState,
  input: PlayerInput | SystemResponse | undefined,
  deps: GameExecutionDeps,
): Promise<StepResult> {
  // Fork mode: route player input to the right resume handler.
  if (input && state.playerTurns) {
    const playerInput = input as PlayerInput;
    const playerTurn = state.playerTurns[playerInput.playerId];
    if (!playerTurn) {
      throw new Error(`Player "${playerInput.playerId}" has no active playerTurn in fork mode`);
    }
    return resumePlayerTurn(state, playerInput, playerTurn, deps);
  }

  // Game-level resume.  Expect SystemResponse (e.g. LLM, external data) only.
  if (input && state.pending) {
    applyGameLevelResume(state, input);
  }

  return drainGameLevel(state, deps);
}

/** Drain the game-level queue. */
async function drainGameLevel(
  state: GameExecutionState, 
  deps: GameExecutionDeps
): Promise<StepResult> {
  const ctx: DrainContext = {
    onEmpty(): DrainSignal {
      const result = deps.advanceFlow(state);
      if (result.kind === 'complete') {
        return { kind: 'complete', outcome: result.outcome };
      }
      if (result.kind === 'suspend') {
        // NOTE: advanceFlow returning 'suspend' at the game level is not
        // expected in current usage — action-select prompts now come from
        // player runners, not the flow tree. This path could become reachable
        // if the flow runner gains game-level "wait for external event" nodes
        // (e.g. a pre-game setup phase driven by an LLM or external data
        // source). Logging here so it's visible if it fires unexpectedly.
        console.warn(
          '[game-step] advanceFlow returned suspend at game level — ' +
          'this is unexpected with the current fork model. Suspension kind:',
          result.suspension.kind,
        );
        state.pending = { suspension: result.suspension };
        return { kind: 'prompt', suspension: result.suspension };
      }
      if (result.kind === 'fork') {
        initPlayerTurns(state, result.runners);
        return { kind: 'fork' };
      }
      // 'enqueue': items were added to state.queue.
      state.queue.push(...result.items);
      return { kind: 'continue' };
    },
    onPlayerInputNeeded(): DrainSignal {
      throw new Error(
        'Game-level hook effects must not require player input. ' +
        'Use an auto-resolvable input kind (effect-originator, trigger-input) instead.',
      );
    },
  };

  while (true) {
    const signal = await drainQueue(state, state.queue, ctx, deps.module, deps.resolveOptions);
    if (signal.kind === 'prompt') return {
      kind: 'suspended',
      state,
      waiting: collectWaiting(state),
    };
    if (signal.kind === 'complete') return {
      kind: 'complete', 
      state, 
      outcome: signal.outcome 
    };
    if (signal.kind === 'turn-complete') {
      throw new Error('Unexpected turn-complete signal from the game-level drain');
    }
    if (signal.kind === 'fork') {
      const forkResult = await drainAllPlayerTurns(state, deps);
      if (forkResult) return forkResult;
      // All player turns joined: state.playerTurns is undefined again; loop so
      // advanceFlow gets called on the next empty-queue cycle.
    }
    // 'continue' — queue got new items; loop again.
  }
}

/**
 * Initializes player turns based on the provided PlayerTurnInit instances.
 */
function initPlayerTurns(
  state: GameExecutionState,
  playerTurns: Record<string, PlayerTurnInit>,
): void {
  state.playerTurns = {};
  for (const [playerId, init] of Object.entries(playerTurns)) {
    state.playerTurns[playerId] = {
      queue: [],
      pending: undefined,
      done: false,
      cursor: init.cursor,
      grammar: init.grammar,
      nodeLabel: init.nodeLabel,
    };
  }
}

/**
 * Drains every active player turn to a settled state (done or pending).
 *
 * Returns undefined when all players are done — the join fired and playerTurns was
 * cleared. Otherwise returns a prompt for the first pending player. Draining
 * every player before surfacing a prompt establishes the fork invariant:
 * every non-done player turn holds a pending suspension.
 */
async function drainAllPlayerTurns(
  state: GameExecutionState,
  deps: GameExecutionDeps,
): Promise<StepResult | undefined> {
  const playerTurns = state.playerTurns!;

  for (const [playerId, playerTurn] of Object.entries(playerTurns)) {
    if (playerTurn.done || playerTurn.pending) continue;
    // Any suspension is stored on playerTurn.pending; surfaced below.
    await drainPlayerTurn(state, playerId, playerTurn, deps);
  }

  // Join condition: all players done.
  if (Object.values(playerTurns).every(t => t.done)) {
    state.playerTurns = undefined;
    return;
  }

  // Every non-done turn must now be pending (fork invariant).
  if (Object.values(playerTurns).some(t => !t.done && !t.pending)) {
    throw new Error('Fork mode: a player turn is neither done nor pending after draining');
  }
  return { kind: 'suspended', state, waiting: collectWaiting(state) };
}

/**
 * Drains one player turn until it suspends, completes, or needs work.
 * Calls nextPlayerTurnSignal when the player's queue empties.
 */
async function drainPlayerTurn(
  state: GameExecutionState,
  playerId: string,
  playerTurn: PlayerTurnState,
  deps: GameExecutionDeps,
): Promise<StepResult | undefined> {
  const ctx: DrainContext = {
    onEmpty(): DrainSignal {
      const signal = nextPlayerTurnSignal(
        playerId,
        playerTurn.cursor,
        playerTurn.grammar,
        state,
        deps.module,
        playerTurn.nodeLabel,
      );
      if (signal.kind === 'done') {
        playerTurn.done = true;
        return { kind: 'turn-complete' };
      }
      if (signal.kind === 'enqueue') {
        playerTurn.queue.push(...signal.items);
        return { kind: 'continue' };
      }
      // 'suspend': action-select prompt.
      playerTurn.pending = { suspension: signal.suspension };
      return { kind: 'prompt', suspension: signal.suspension };
    },
    onPlayerInputNeeded(suspension, group, inputId): DrainSignal {
      // Action-input collection for this player's in-progress action.
      playerTurn.pending = { suspension, group, inputId };
      return { kind: 'prompt', suspension };
    },
  };

  while (true) {
    const signal = await drainQueue(state, playerTurn.queue, ctx, deps.module, deps.resolveOptions);
    if (signal.kind === 'turn-complete') return;
    if (signal.kind === 'prompt') {
      return { kind: 'suspended', state, waiting: collectWaiting(state) };
    }
    // 'continue': loop.
  }
}

/**
 * Resumes a suspended player turn with the given input.
 */
async function resumePlayerTurn(
  state: GameExecutionState,
  input: PlayerInput,
  playerTurn: PlayerTurnState,
  deps: GameExecutionDeps,
): Promise<StepResult> {
  const pending = playerTurn.pending;
  if (!pending) {
    throw new Error(`Player "${input.playerId}" submitted input but has no pending suspension`);
  }

  const { suspension } = pending;
  if (suspension.kind !== 'player-input') {
    throw new Error(`Player turn suspension for "${input.playerId}" is not a player-input`);
  }

  validatePlayerInput(input, suspension);

  if (suspension.input.type.kind === 'action-select') {
    // The player chose an action (or passed). Advance the cursor and get next signal.
    playerTurn.pending = undefined;
    const val = input.value as { kind: 'act'; actionId: string } | { kind: 'pass' };
    const passed = val.kind === 'pass';
    const actionId = passed ? undefined : val.actionId;
    advanceGrammarCursor(playerTurn.cursor, playerTurn.grammar, passed, actionId);

    if (!passed && actionId) {
      playerTurn.queue.push(...explodeAction(actionId, input.playerId, deps.module));
    }
    // Fall through to drain the player turn.
  } else {
    // Queue-level input (data collection for an in-progress action).
    if (!pending.group || !pending.inputId) {
      throw new Error(`Player "${input.playerId}" pending has no group/inputId for queue-level input`);
    }
    pending.group.collected[pending.inputId] = input.value;
    playerTurn.pending = undefined;
    // Fall through to drain the player turn.
  }

  const result = await drainPlayerTurn(state, input.playerId, playerTurn, deps);
  if (result) return result;

  // This player's turn finished. Every other player turn is already settled
  // (done or pending — the fork invariant), so either the join fires or
  // another player's pending prompt is surfaced.
  if (Object.values(state.playerTurns!).every(t => t.done)) {
    state.playerTurns = undefined;
    return drainGameLevel(state, deps);
  }

  // Every non-done turn must now be pending (fork invariant).
  if (Object.values(state.playerTurns!).some(t => !t.done && !t.pending)) {
    throw new Error('Fork mode: a player turn is neither done nor pending after resume');
  }
  return { kind: 'suspended', state, waiting: collectWaiting(state) };
}

/** 
 * Drains a queue of input and effect items, invoking the appropriate callbacks 
 * on the DrainContext. 
 */
async function drainQueue(
  state: GameExecutionState,
  queue: QueueItem[],
  ctx: DrainContext,
  module: CompiledGameModule,
  resolveOptions: OptionsResolver,
): Promise<DrainSignal> {
  while (true) {
    if (queue.length === 0) {
      const signal = ctx.onEmpty();
      if (signal.kind !== 'continue') return signal;
      if (queue.length === 0) return signal; // onEmpty pushed nothing, stop
      continue;
    }

    const item = queue[0];

    if (item.kind === 'input') {
      const auto = resolveAutoInput(item);
      if (auto !== NO_AUTO_VALUE) {
        item.group.collected[item.input.id] = auto;
        queue.shift();
        continue;
      }

      if (!item.group.actorId) {
        throw new Error(`Queue input "${item.input.id}" has no actor`);
      }

      const options = resolveOptions(state, item.input, item.group.actorId);
      const suspension: PlayerInputSuspension = {
        kind: 'player-input',
        awaiting: item.group.actorId,
        response: undefined,
        input: item.input,
        ...(options !== undefined && { options }),
      };
      queue.shift();
      return ctx.onPlayerInputNeeded(suspension, item.group, item.input.id);
    }

    // Effect item.
    queue.shift();
    await executeEffectItem(state, item, module);
    // TODO: once EffectExecutor can return a Suspension (reactive-choice,
    // llm, external-data), check for one here and return a prompt signal.
  }
}

/** 
 * Resume game level execution. Only system responses (llm / external-data) are 
 * expected here; player input is always routed through fork mode (resumePlayerTurn) 
 * before this is reached. 
 */
function applyGameLevelResume(
  state: GameExecutionState,
  input: PlayerInput | SystemResponse,
): void {
  const pending = state.pending!;
  const { suspension } = pending;

  if (suspension.kind === 'player-input') {
    // This path is unreachable in the current fork model: player-input suspensions
    // only arise during fork mode and are handled by resumePlayerTurn before step()
    // reaches this function. Log a warning and skip — do not attempt to apply it.
    console.warn(
      '[game-step] applyGameLevelResume received player input at game level — ' +
      'this is unexpected in the current fork model and will be ignored.',
    );
    return;
  }

  // System response (llm / external-data).
  const response = input as SystemResponse;
  if (response.requestId !== (suspension as { requestId?: string }).requestId) {
    throw new Error(`Resume requestId "${response.requestId}" does not match pending suspension`);
  }
  // TODO: deliver response.result to awaiting effect via pending.group.collected.
  state.pending = undefined;
}

/** Validate player input against the suspension (anti-cheat). */
function validatePlayerInput(input: PlayerInput, suspension: PlayerInputSuspension): void {
  if (suspension.input.type.kind === 'action-select') {
    const { actions, canPass } = suspension.input.type;
    const val = input.value as { kind?: string; actionId?: string };
    if (val?.kind === 'pass') {
      if (!canPass) throw new Error(`Player "${input.playerId}" submitted pass but passing is not allowed`);
    } else if (val?.kind === 'act') {
      if (!actions.includes(val.actionId ?? '')) {
        throw new Error(`Player "${input.playerId}" submitted invalid action "${val.actionId}"`);
      }
    } else {
      throw new Error(`Player "${input.playerId}" submitted malformed action-select response`);
    }
  } else if (suspension.options != undefined && suspension.options.length > 0) {
    if (!suspension.options.includes(input.value)) {
      throw new Error(
        `Player "${input.playerId}" submitted invalid value for input "${suspension.input.id}": not in allowed options`,
      );
    }
  }
}

/** 
 * Resolves automatic input values for certain input types. Returns NO_AUTO_VALUE 
 * if no automatic value is available. 
 */
function resolveAutoInput(item: InputQueueItem): unknown | typeof NO_AUTO_VALUE {
  const type = item.input.type as { kind: string; inputId?: string };

  if (type.kind === 'effect-originator') {
    if (!item.group.originatorId) {
      throw new Error(`Input "${item.input.id}" is effect-originator but group has no originatorId`);
    }
    return item.group.originatorId;
  }

  if (type.kind === 'trigger-input') {
    const inputId = type.inputId;
    if (!inputId || !item.group.triggerInputs || !(inputId in item.group.triggerInputs)) {
      throw new Error(`Input "${item.input.id}" references trigger input "${inputId}" not available`);
    }
    return item.group.triggerInputs[inputId];
  }

  return NO_AUTO_VALUE;
}

/** Resolves an effect definition, either by reference or inline. */
function resolveEffectDef(module: CompiledGameModule, ref: EffectRef): Record<string, unknown> {
  // Heuristic: a bare `{ ref: "id" }` object (single key, string value) is a
  // named ref; anything else is an inline effect def. Inline defs must not
  // use a top-level `ref` field of their own.
  if (
    'ref' in ref && 
    typeof (ref as { ref?: unknown }).ref === 'string' && 
    Object.keys(ref).length === 1
  ) {
    const id = (ref as { ref: string }).ref;
    const def = module.effectDefs[id];
    if (!def) throw new Error(`Unknown effect ref "${id}"`);
    return def;
  }
  return ref as Record<string, unknown>;
}

/** Executes an effect item. */
async function executeEffectItem(
  state: GameExecutionState,
  item: EffectQueueItem,
  module: CompiledGameModule,
): Promise<void> {
  const effectDef = resolveEffectDef(module, item.effect);
  const kind = effectDef.kind as string;
  const registration = module.effects[kind];
  if (!registration) throw new Error(`No effect executor registered for kind "${kind}"`);
  const ctx: EffectContext = {
    actorId: item.group.actorId ?? null,
    actionInputs: item.group.collected,
    effectDef,
  };
  if (registration.kind === 'effect-executor') {
    await registration.execute(state.session, ctx);
  } else {
    throw new Error(`Suspending effect "${kind}" is not yet handled.`);
  }
}
