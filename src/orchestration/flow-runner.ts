// ---------------------------------------------------------------------------
// Flow runner — generic tree walker over a compiled FlowNode tree.
//
// Implements the AdvanceFlow contract: called by step() whenever the queue
// empties (or after a fork join), returns the next batch of work
// (QueueItems to enqueue), a fork (player runners to spin up), or a
// game-over signal.
//
// The walker never knows about effect semantics — it only manages the
// structural flow: loop iteration, turn order, grammar resolution, and hook
// scheduling. All game logic lives in effect executors and action defs.
//
// Usage:
//   const advanceFlow = createFlowRunner(module);
//   const deps: EngineDeps = { module, advanceFlow, resolveOptions };
// ---------------------------------------------------------------------------

import type {
  CompiledGameModule,
  FlowNode,
  GameFlowNode,
  LoopFlowNode,
  TurnFlowNode,
  EffectRef,
} from "#chaincraft/types.js";
import type {
  GameExecutionState,
  FlowFrame,
  QueueItem,
  QueueGroup,
  FlowAdvanceResult,
  AdvanceFlow,
  PlayerTurnCursor,
  PlayerTurnInit,
} from "./types.js";
import { 
  resolveNextEligibleActors, 
  readStatePath, 
  writeStatePath 
} from "./turn-order.js";

// ---------------------------------------------------------------------------
// Per-node frame state schemas.
// These types are private to this module — EngineState stores them as
// Record<string, unknown> for serializability; the walker casts on access.
//
// Frame states are responsible for tracking progress within a node.
// Some notes about phases:
// - enter-hooks: the node has just been pushed; fire onEnter hooks.
// - children: the node is iterating through its children (or grammar).
// - complete-hooks: the node has finished all children; fire onComplete hooks.
// ---------------------------------------------------------------------------

/** Tracks progress within a game node, which is the root of the flow tree. */
interface GameFrameState {
  /** Which phase the game node is currently in. */
  phase: "enter-hooks" | "children" | "complete-hooks";
  /** Index into the node's children array — which child is currently active. */
  childIndex: number;
}

/** Tracks progress within a loop node, which repeats its children. */
interface LoopFrameState {
  /** Which phase the loop node is currently in. */
  phase: "enter-hooks" | "children" | "complete-hooks";
  /** Index into the node's children array — which child is currently active. */
  childIndex: number;
  /** How many iterations of the loop have completed so far. */
  iterationCount: number;
  /** True once endCondition has fired but finalRound is completing the iteration. */
  finalRoundTriggered: boolean;
}

/**
 * Unified turn frame — covers both sequential (round-robin, single) and
 * simultaneous orderings. Cursors are keyed by player ID and shared by
 * reference with PlayerRunnerState.cursor so step() mutations are visible
 * here on the next advanceFlow call.
 */
interface TurnFrameState {
  phase: 'enter-hooks' | 'acting' | 'complete-hooks';
  /** Per-player grammar cursors. Populated incrementally as actors become eligible. */
  cursors: Record<string, PlayerTurnCursor>;
}

function asTypedFrameState<T>(frame: FlowFrame): T {
  return frame.localState as unknown as T;
}

// ---------------------------------------------------------------------------
// Factory — call once per game module, inject the result as deps.advanceFlow.
// ---------------------------------------------------------------------------

/**
 * Creates the AdvanceFlow function for the given compiled module.
 * Pre-indexes all flow nodes by ID for O(1) lookup during execution.
 */
export function createFlowRunner(module: CompiledGameModule): AdvanceFlow {
  const nodesByIdMap = buildNodesByIdMap(module.flow);

  return function advanceFlow(state: GameExecutionState): FlowAdvanceResult {
    if (state.flowStack.length === 0) {
      pushFrame(state, module.flow);
    }
    return resumeTop(state, module, nodesByIdMap);
  };
}

// ---------------------------------------------------------------------------
// Core dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatches to the appropriate node-specific advance function based on node kind
 * at the top of the flow stack.
 */
function resumeTop(
  state: GameExecutionState,
  module: CompiledGameModule,
  nodesByIdMap: Map<string, FlowNode>,
): FlowAdvanceResult {
  if (state.flowStack.length === 0) {
    // Stack fully exhausted — the root node completed without a winner signal.
    // This normally shouldn't happen (root loop should have an endCondition that
    // triggers a set-state + game-over path), but handle it gracefully.
    return { kind: 'complete', outcome: { reason: 'flow-exhausted' } };
  }

  const frame = state.flowStack[state.flowStack.length - 1];
  const node = nodesByIdMap.get(frame.nodeId);
  if (!node) throw new Error(`Flow node "${frame.nodeId}" not found in module`);

  switch (node.kind) {
    case "game":
      return advanceGame(state, module, nodesByIdMap, node, frame);
    case "loop":
      return advanceLoop(state, module, nodesByIdMap, node, frame);
    case "turn":
      return advanceTurn(
        state,
        module,
        nodesByIdMap,
        node,
        frame,
      );
  }
}

/**
 * Advances a game node.
 * Sequences through children once, fires hooks at entry/exit.
 * This is the root of the flow tree; it doesn't repeat or suspend for player input.
 */
function advanceGame(
  state: GameExecutionState,
  module: CompiledGameModule,
  nodeIndex: Map<string, FlowNode>,
  node: GameFlowNode,
  frame: FlowFrame,
): FlowAdvanceResult {
  const ls = asTypedFrameState<GameFrameState>(frame);

  if (ls.phase === 'enter-hooks') {
    ls.phase = 'children';
    state.session.events.emit({ kind: 'flow:phase', nodeId: node.id, phase: 'children' });
    const items = buildHookItems(node.hooks?.onEnter, undefined);
    if (items.length) return { kind: 'enqueue', items };
  }

  if (ls.phase === 'children') {
    if (ls.childIndex < node.children.length) {
      const child = node.children[ls.childIndex++];
      pushFrame(state, child);
      return resumeTop(state, module, nodeIndex);
    }
    ls.phase = 'complete-hooks';
    state.session.events.emit({ kind: 'flow:phase', nodeId: node.id, phase: 'complete-hooks' });
    const items = buildHookItems(node.hooks?.onComplete, undefined);
    if (items.length) return { kind: 'enqueue', items };
  }

  // Done — pop and resume parent.
  state.flowStack.pop();
  state.session.events.emit({ kind: 'flow:exit', nodeId: node.id });
  return resumeTop(state, module, nodeIndex);
}


/**
 * Advances a loop node. Iterates through children repeatedly until the loop's exit
 * condition is met.
 */
function advanceLoop(
  state: GameExecutionState,
  module: CompiledGameModule,
  nodeIndex: Map<string, FlowNode>,
  node: LoopFlowNode,
  frame: FlowFrame,
): FlowAdvanceResult {
  const ls = asTypedFrameState<LoopFrameState>(frame);

  if (ls.phase === 'enter-hooks') {
    ls.phase = 'children';
    state.session.events.emit({ kind: 'flow:phase', nodeId: node.id, phase: 'children' });

    // Write the current iteration count to the specified state path, if configured.
    if (node.writeIterationTo) {
      writeStatePath(state.session, node.writeIterationTo, ls.iterationCount);
    }
    const items = buildHookItems(node.hooks?.onEnter, undefined);
    if (items.length) return { kind: 'enqueue', items };
  }

  if (ls.phase === 'children') {
    if (ls.childIndex < node.children.length) {
      const child = node.children[ls.childIndex++];
      pushFrame(state, child);
      return resumeTop(state, module, nodeIndex);
    }

    // All children processed for this iteration.
    ls.iterationCount++;
    ls.childIndex = 0;

    const shouldExit = checkLoopExit(node, state, ls);

    if (shouldExit) {
      ls.phase = 'complete-hooks';
      state.session.events.emit({ kind: 'flow:phase', nodeId: node.id, phase: 'complete-hooks' });
      const items = buildHookItems(node.hooks?.onComplete, undefined);
      if (items.length) return { kind: 'enqueue', items };
    } else {
      // Start next iteration — fire onEnter again.
      ls.phase = 'enter-hooks';
      state.session.events.emit({ kind: 'flow:phase', nodeId: node.id, phase: 'enter-hooks' });
      return advanceLoop(state, module, nodeIndex, node, frame);
    }
  }

  // complete-hooks already drained — pop.
  state.flowStack.pop();
  state.session.events.emit({ kind: 'flow:exit', nodeId: node.id });
  return resumeTop(state, module, nodeIndex);
}

/**
 * Returns true if the loop should exit after the current iteration completes.
 * count takes precedence over endCondition.
 */
function checkLoopExit(
  node: LoopFlowNode,
  state: GameExecutionState,
  ls: LoopFrameState,
): boolean {
  if (node.count !== undefined) {
    return ls.iterationCount >= node.count;
  }
  if (node.endCondition) {
    const met = node.endCondition(state.session);
    if (met && node.finalRound && !ls.finalRoundTriggered) {
      // Allow this iteration to complete before exiting (finalRound semantics).
      // We've already incremented iterationCount; next check will fire the exit.
      ls.finalRoundTriggered = true;
      return false;
    }
    return met;
  }
  // Neither count nor endCondition — loop forever. Caller must have an
  // effect that ends the game via GameOutcome; this is a spec-level concern.
  return false;
}

/**
 * Advances a turn node. Handles both sequential and simultaneous orderings.
 * Called once to fire onEnter hooks, then once per fork-join cycle, then once
 * when all cursors are done to fire onComplete hooks and pop.
 * step() owns the fork: it manages per-player runners and calls advanceFlow
 * again when every runner is done. Cursors in ls.cursors are shared by
 * reference with PlayerRunnerState.cursor so step() mutations are visible here.
 */
function advanceTurn(
  state: GameExecutionState,
  module: CompiledGameModule,
  nodeIndex: Map<string, FlowNode>,
  node: TurnFlowNode,
  frame: FlowFrame,
): FlowAdvanceResult {
  const ls = asTypedFrameState<TurnFrameState>(frame);

  if (ls.phase === 'enter-hooks') {
    ls.phase = 'acting';
    state.session.events.emit({ kind: 'flow:phase', nodeId: node.id, phase: 'acting' });
    const items = buildHookItems(node.hooks?.onEnter, undefined);
    if (items.length) return { kind: 'enqueue', items };
  }

  if (ls.phase === 'acting') {
    const eligible = resolveNextEligibleActors(node.ordering, state, ls.cursors);

    if (eligible.length === 0) {
      // All actors have completed their grammar — move to complete-hooks.
      ls.phase = 'complete-hooks';
      state.session.events.emit({ kind: 'flow:phase', nodeId: node.id, phase: 'complete-hooks' });
      const items = buildHookItems(node.hooks?.onComplete, undefined);
      if (items.length) return { kind: 'enqueue', items };
      state.flowStack.pop();
      state.session.events.emit({ kind: 'flow:exit', nodeId: node.id });
      return resumeTop(state, module, nodeIndex);
    }

    // Build one ForkRunnerInit per eligible actor, initializing the cursor on
    // first encounter. step() computes each runner's actual work via
    // nextRunnerWork() — construction of queue items / suspensions lives there.
    const runners: Record<string, PlayerTurnInit> = {};
    for (const playerId of eligible) {
      const cursor = (ls.cursors[playerId] ??= {
        sequenceIndex: 0,
        repeatCount: 0,
        done: false,
      });
      runners[playerId] = {
        cursor,
        grammar: node.grammar,
        nodeLabel: node.label,
      };
    }

    return { kind: 'fork', runners };
  }

  if (ls.phase === 'complete-hooks') {
    // Reached when complete-hooks produced items; step() drained them and called back.
    state.flowStack.pop();
    state.session.events.emit({ kind: 'flow:exit', nodeId: node.id });
    return resumeTop(state, module, nodeIndex);
  }

  throw new Error(`Turn node "${node.id}": unexpected phase "${ls.phase}"`);
}

/** Pushes a new frame onto the flow stack for the given node. */
function pushFrame(state: GameExecutionState, node: FlowNode): FlowFrame {
  const frame: FlowFrame = { nodeId: node.id, localState: initFrameState(node) };
  state.flowStack.push(frame);
  state.session.events.emit({ kind: 'flow:enter', nodeId: node.id, nodeType: node.kind });
  state.session.events.emit({ kind: 'flow:phase', nodeId: node.id, phase: 'enter-hooks' });
  return frame;
}

/** Initializes the local state for a new flow frame based on the node kind. */
function initFrameState(node: FlowNode): Record<string, unknown> {
  switch (node.kind) {
    case 'game':  return { phase: 'enter-hooks', childIndex: 0 } as unknown as Record<string, unknown>;
    case 'loop':  return { phase: 'enter-hooks', childIndex: 0, iterationCount: 0, finalRoundTriggered: false } as unknown as Record<string, unknown>;
    case 'turn':  return { phase: 'enter-hooks', cursors: {} } as unknown as Record<string, unknown>;
  }
}

/** Builds a map from node ID to node for the given flow tree. */
function buildNodesByIdMap(root: FlowNode): Map<string, FlowNode> {
  const index = new Map<string, FlowNode>();
  function traverse(node: FlowNode) {
    index.set(node.id, node);
    if ('children' in node && Array.isArray(node.children)) {
      node.children.forEach(traverse);
    }
  }
  traverse(root);
  return index;
}

/** Builds queue items for the given hook effects and actor ID. */
function buildHookItems(effects: EffectRef[] | undefined, actorId: string | undefined): QueueItem[] {
  if (!effects?.length) return [];
  const group: QueueGroup = { actorId, collected: {} };
  return effects.map(effect => ({ kind: 'effect' as const, effect, group }));
}
