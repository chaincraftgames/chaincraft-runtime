// ---------------------------------------------------------------------------
// Flow runner tests
//
// Unit tests drive advanceFlow directly (returned items are inspected, not
// executed). The integration test at the bottom drives the full step() loop
// with a hand-written RPS-shaped module — essentially what the compiler will
// eventually emit.
// ---------------------------------------------------------------------------

import type {
  CompiledGameModule,
  FlowNode,
  GameSession,
  GameConfig,
  GameState,
  ActionDef,
  Grammar,
} from '#chaincraft/types.js';
import type {
  GameExecutionState,
  FlowAdvanceResult,
  PlayerInputSuspension,
  EffectQueueItem,
  QueueItem,
  GameExecutionDeps,
} from '../types.js';
import { createFlowRunner } from '../flow-runner.js';
import { nextPlayerTurnWork, type PlayerTurnSignal } from '../player-effects-resolver.js';
import { step } from '../game-step.js';
import { createSeededRng } from '#chaincraft/rng/seeded.js';
import { GameEventEmitter } from '#chaincraft/events/emitter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(): GameConfig {
  return {
    inventories: {},
    gamepieceTypes: {},
    gameProperties: {},
    playerProperties: {},
    playerCount: { min: 2, max: 2 },
  };
}

function makeState(players: string[]): GameState {
  return {
    gameProperties: {},
    gameInventories: {},
    players: Object.fromEntries(players.map((p) => [p, { roles: [], properties: {}, inventories: {} }])),
    gamepieces: {},
  };
}

function makeSession(players: string[] = ['p1', 'p2']): GameSession {
  return {
    gameId: 'test-game',
    specId: 'test-spec',
    config: makeConfig(),
    state: makeState(players),
    players,
    outbox: [],
    rng: createSeededRng(42),
    events: new GameEventEmitter(),
    _inventoryCache: new Map(),
  };
}

function createGameExecutionState(session: GameSession = makeSession()): GameExecutionState {
  return { session, queue: [], pending: undefined, flowStack: [], playerTurns: undefined };
}

/**
 * Builds a minimal CompiledGameModule around the given flow tree.
 * Every action id gets an ActionDef with no inputs and a single inline
 * `{ kind: 'log', tag: <actionId> }` effect. The `log` executor appends
 * `"<actorId>:<tag>"` to the provided log array. Hook effects can use the
 * same inline shape: `{ kind: 'log', tag: 'whatever' }`.
 */
function makeModule(flow: FlowNode, actionIds: string[], log: string[] = []): CompiledGameModule {
  const actions: Record<string, ActionDef> = {};
  for (const id of actionIds) {
    actions[id] = {
      id,
      label: id,
      description: id,
      inputs: [],
      effects: [{ kind: 'log', tag: id }],
    };
  }
  return {
    specId: 'test-spec',
    metadata: { name: 'test', playerCount: { min: 2, max: 2 } },
    createSession: (_gameId, players) => makeSession(players),
    flow,
    effects: {
      log: {
        kind: 'effect-executor',
        execute: async (_session, ctx) => {
          log.push(`${ctx.actorId ?? 'game'}:${(ctx.effectDef as { tag: string }).tag}`);
        },
      },
    },
    effectDefs: {},
    actions,
  };
}

/** Inline hook effect shorthand. */
function logHook(tag: string): Record<string, unknown> {
  return { kind: 'log', tag };
}

// --- Result narrowing helpers ---

function expectEnqueue(result: FlowAdvanceResult): EffectQueueItem[] {
  expect(result.kind).toBe('enqueue');
  return (result as { kind: 'enqueue'; items: EffectQueueItem[] }).items;
}

/** Returns the inline-effect tags of an enqueue result, in order. */
function itemTags(result: FlowAdvanceResult): string[] {
  return expectEnqueue(result).map((i) => (i.effect as { tag: string }).tag);
}

function expectSuspend(result: FlowAdvanceResult): PlayerInputSuspension {
  expect(result.kind).toBe('suspend');
  const suspension = (result as { kind: 'suspend'; suspension: PlayerInputSuspension }).suspension;
  expect(suspension.kind).toBe('player-input');
  return suspension;
}

function expectComplete(result: FlowAdvanceResult): void {
  expect(result.kind).toBe('complete');
}

// ---------------------------------------------------------------------------
// Loop node
// ---------------------------------------------------------------------------

describe('loop node', () => {
  it('runs exactly `count` iterations: onEnter per iteration, onComplete once', () => {
    const flow: FlowNode = {
      kind: 'loop',
      id: 'root',
      label: 'root loop',
      count: 2,
      hooks: { onEnter: [logHook('enter')], onComplete: [logHook('complete')] },
      children: [],
    };
    const module = makeModule(flow, []);
    const advanceFlow = createFlowRunner(module);
    const state = createGameExecutionState();

    expect(itemTags(advanceFlow(state))).toEqual(['enter']); // iteration 1
    expect(itemTags(advanceFlow(state))).toEqual(['enter']); // iteration 2
    expect(itemTags(advanceFlow(state))).toEqual(['complete']); // exit
    expectComplete(advanceFlow(state)); // stack exhausted
  });

  it('exits when endCondition returns true (checked after each full iteration)', () => {
    const results = [false, true];
    let calls = 0;
    const flow: FlowNode = {
      kind: 'loop',
      id: 'root',
      label: 'root loop',
      endCondition: () => results[calls++],
      hooks: { onEnter: [logHook('enter')] },
      children: [],
    };
    const module = makeModule(flow, []);
    const advanceFlow = createFlowRunner(module);
    const state = createGameExecutionState();

    expect(itemTags(advanceFlow(state))).toEqual(['enter']); // iteration 1
    expect(itemTags(advanceFlow(state))).toEqual(['enter']); // condition false → iteration 2
    expectComplete(advanceFlow(state)); // condition true → exit (no onComplete hooks)
    expect(calls).toBe(2);
  });

  it('finalRound allows one extra full iteration after endCondition first fires', () => {
    const flow: FlowNode = {
      kind: 'loop',
      id: 'root',
      label: 'root loop',
      endCondition: () => true,
      finalRound: true,
      hooks: { onEnter: [logHook('enter')] },
      children: [],
    };
    const module = makeModule(flow, []);
    const advanceFlow = createFlowRunner(module);
    const state = createGameExecutionState();

    expect(itemTags(advanceFlow(state))).toEqual(['enter']); // iteration 1
    expect(itemTags(advanceFlow(state))).toEqual(['enter']); // condition fired → final round
    expectComplete(advanceFlow(state)); // exit after final round
  });

  it('writeIterationTo writes the current iteration index before each onEnter', () => {
    const flow: FlowNode = {
      kind: 'loop',
      id: 'root',
      label: 'root loop',
      count: 2,
      writeIterationTo: 'game.property.round',
      hooks: { onEnter: [logHook('enter')] },
      children: [],
    };
    const module = makeModule(flow, []);
    const advanceFlow = createFlowRunner(module);
    const state = createGameExecutionState();

    advanceFlow(state);
    expect(state.session.state.gameProperties['round']).toBe(0);
    advanceFlow(state);
    expect(state.session.state.gameProperties['round']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Game node
// ---------------------------------------------------------------------------

describe('game node', () => {
  it('sequences children in order with hooks at entry and exit', () => {
    const flow: FlowNode = {
      kind: 'game',
      id: 'root',
      hooks: { onEnter: [logHook('g-enter')], onComplete: [logHook('g-complete')] },
      children: [
        {
          kind: 'loop', id: 'phase1', label: 'phase 1', count: 1,
          hooks: { onEnter: [logHook('l1-enter')] }, children: [],
        },
        {
          kind: 'loop', id: 'phase2', label: 'phase 2', count: 1,
          hooks: { onEnter: [logHook('l2-enter')] }, children: [],
        },
      ],
    };
    const module = makeModule(flow, []);
    const advanceFlow = createFlowRunner(module);
    const state = createGameExecutionState();

    const tags: string[] = [];
    let result = advanceFlow(state);
    while (result.kind === 'enqueue') {
      tags.push(...result.items.map((i) => ((i as EffectQueueItem).effect as { tag: string }).tag));
      result = advanceFlow(state);
    }
    expectComplete(result);
    expect(tags).toEqual(['g-enter', 'l1-enter', 'l2-enter', 'g-complete']);
  });
});

// ---------------------------------------------------------------------------
// Turn node — tests inspect the fork result directly.
// Cursor.done is set manually to simulate step() completing a runner.
// ---------------------------------------------------------------------------

/** Narrows to a fork result and returns the runners map. */
function expectFork(result: FlowAdvanceResult) {
  expect(result.kind).toBe('fork');
  return (result as Extract<FlowAdvanceResult, { kind: 'fork' }>).runners;
}

/** Narrows a RunnerWork to suspend and returns the suspension. */
function expectWorkSuspend(work: PlayerTurnSignal): PlayerInputSuspension {
  expect(work.kind).toBe('suspend');
  return (work as Extract<PlayerTurnSignal, { kind: 'suspend' }>).suspension;
}

/** Narrows a RunnerWork to enqueue and returns the items. */
function expectWorkEnqueue(work: PlayerTurnSignal): QueueItem[] {
  expect(work.kind).toBe('enqueue');
  return (work as Extract<PlayerTurnSignal, { kind: 'enqueue' }>).items;
}

describe('turn node', () => {
  it('single (state-ref): forks the resolved player with action-select options', () => {
    const flow: FlowNode = {
      kind: 'turn',
      id: 'root',
      label: 'take your turn',
      ordering: { kind: 'single', actor: { kind: 'state-ref', path: 'game.property.active' } },
      grammar: { kind: 'choice', actions: ['act-a', 'act-b'] },
    };
    const state = createGameExecutionState();
    state.session.state.gameProperties['active'] = 'p1';
    const module = makeModule(flow, ['act-a', 'act-b']);
    const advanceFlow = createFlowRunner(module);

    const runners = expectFork(advanceFlow(state));
    expect(Object.keys(runners)).toEqual(['p1']);
    const r = runners['p1'];
    const susp = expectWorkSuspend(nextPlayerTurnWork('p1', r.cursor, r.grammar, state, module, r.nodeLabel));
    expect(susp.awaiting).toBe('p1');
    expect(susp.input.type.kind).toBe('action-select');
    const selectType = susp.input.type as { kind: 'action-select'; actions: string[]; canPass: boolean };
    expect(selectType.actions).toEqual(['act-a', 'act-b']);
    expect(selectType.canPass).toBe(false);

    // Simulate step() completing p1's runner.
    runners['p1'].cursor.done = true;
    expectComplete(advanceFlow(state));
  });

  it('round-robin: forks one player at a time in session order', () => {
    const flow: FlowNode = {
      kind: 'turn',
      id: 'root',
      label: 'everyone acts',
      ordering: { kind: 'round-robin' },
      grammar: { kind: 'action', ref: 'act-a' }, // forced — pre-loads queue
    };
    const module = makeModule(flow, ['act-a']);
    const advanceFlow = createFlowRunner(module);
    const state = createGameExecutionState();

    // First fork: p1 only. Forced action grammar — nextRunnerWork pre-loads
    // the queue and advances the cursor to done (no response will arrive).
    const runners1 = expectFork(advanceFlow(state));
    expect(Object.keys(runners1)).toEqual(['p1']);
    const items1 = expectWorkEnqueue(
      nextPlayerTurnWork('p1', runners1['p1'].cursor, runners1['p1'].grammar, state, module),
    );
    expect(items1).toHaveLength(1);
    expect((items1[0] as EffectQueueItem).group.actorId).toBe('p1');
    expect(runners1['p1'].cursor.done).toBe(true);

    // Second fork: p2.
    const runners2 = expectFork(advanceFlow(state));
    expect(Object.keys(runners2)).toEqual(['p2']);
    const items2 = expectWorkEnqueue(
      nextPlayerTurnWork('p2', runners2['p2'].cursor, runners2['p2'].grammar, state, module),
    );
    expect((items2[0] as EffectQueueItem).group.actorId).toBe('p2');
    expect(runners2['p2'].cursor.done).toBe(true);

    // All done → complete.
    expectComplete(advanceFlow(state));
  });

  it('passable choice: canPass is true in action-select suspension', () => {
    const flow: FlowNode = {
      kind: 'turn',
      id: 'root',
      label: 'act or pass',
      ordering: { kind: 'single', actor: { kind: 'state-ref', path: 'game.property.active' } },
      grammar: { kind: 'choice', actions: ['act-a'], passable: true },
    };
    const state = createGameExecutionState();
    state.session.state.gameProperties['active'] = 'p1';
    const module = makeModule(flow, ['act-a']);
    const advanceFlow = createFlowRunner(module);

    const runners = expectFork(advanceFlow(state));
    const r = runners['p1'];
    const susp = expectWorkSuspend(nextPlayerTurnWork('p1', r.cursor, r.grammar, state, module));
    const selectType = susp.input.type as { kind: 'action-select'; actions: string[]; canPass: boolean };
    expect(selectType.actions).toEqual(['act-a']);
    expect(selectType.canPass).toBe(true);

    runners['p1'].cursor.done = true;
    expectComplete(advanceFlow(state));
  });

  it('onEnter fires before fork; onComplete fires after all cursors done', () => {
    const flow: FlowNode = {
      kind: 'turn',
      id: 'root',
      label: 'hooked turn',
      ordering: { kind: 'single', actor: { kind: 'state-ref', path: 'game.property.active' } },
      grammar: { kind: 'choice', actions: ['act-a'] },
      hooks: { onEnter: [logHook('turn-enter')], onComplete: [logHook('turn-complete')] },
    };
    const state = createGameExecutionState();
    state.session.state.gameProperties['active'] = 'p1';
    const advanceFlow = createFlowRunner(makeModule(flow, ['act-a']));

    expect(itemTags(advanceFlow(state))).toEqual(['turn-enter']);
    const runners = expectFork(advanceFlow(state));
    runners['p1'].cursor.done = true;
    expect(itemTags(advanceFlow(state))).toEqual(['turn-complete']);
    expectComplete(advanceFlow(state));
  });
});

// ---------------------------------------------------------------------------
// Simultaneous node (ordering: { kind: 'simultaneous' })
// ---------------------------------------------------------------------------

describe('simultaneous ordering', () => {
  it('forks all players at once with individual action-select suspensions', () => {
    const flow: FlowNode = {
      kind: 'turn',
      id: 'root',
      label: 'everyone picks',
      ordering: { kind: 'simultaneous' },
      grammar: { kind: 'choice', actions: ['act-a', 'act-b'] },
      hooks: { onComplete: [logHook('sim-complete')] },
    };
    const module = makeModule(flow, ['act-a', 'act-b']);
    const advanceFlow = createFlowRunner(module);
    const state = createGameExecutionState();

    // One fork with all players; each gets their own action-select suspension.
    const runners = expectFork(advanceFlow(state));
    expect(Object.keys(runners).sort()).toEqual(['p1', 'p2']);
    const susp1 = expectWorkSuspend(
      nextPlayerTurnWork('p1', runners['p1'].cursor, runners['p1'].grammar, state, module),
    );
    const susp2 = expectWorkSuspend(
      nextPlayerTurnWork('p2', runners['p2'].cursor, runners['p2'].grammar, state, module),
    );
    expect(susp1.awaiting).toBe('p1');
    expect(susp2.awaiting).toBe('p2');
    const s1type = susp1.input.type as { kind: 'action-select'; actions: string[]; canPass: boolean };
    expect(s1type.actions).toEqual(['act-a', 'act-b']);
    expect(s1type.canPass).toBe(false);

    // Simulate p2 completing first.
    runners['p2'].cursor.done = true;

    // p1 still pending — no more forks yet (advanceFlow not called again until join).
    runners['p1'].cursor.done = true;

    // Both done → onComplete fires, then complete.
    expect(itemTags(advanceFlow(state))).toEqual(['sim-complete']);
    expectComplete(advanceFlow(state));
  });

  it('repeat count: cursors are initialized per player', () => {
    const flow: FlowNode = {
      kind: 'turn',
      id: 'root',
      label: 'play twice',
      ordering: { kind: 'simultaneous' },
      grammar: { kind: 'repeat', body: { kind: 'choice', actions: ['act-a'] }, count: 2 },
    };
    const advanceFlow = createFlowRunner(makeModule(flow, ['act-a']));
    const state = createGameExecutionState();

    const runners = expectFork(advanceFlow(state));
    expect(Object.keys(runners).sort()).toEqual(['p1', 'p2']);
    // Cursors start at zero, not done.
    expect(runners['p1'].cursor.done).toBe(false);
    expect(runners['p2'].cursor.done).toBe(false);
    expect(runners['p1'].cursor.repeatCount).toBe(0);
  });

  it('until-pass: canPass is true regardless of body passable flag', () => {
    const flow: FlowNode = {
      kind: 'turn',
      id: 'root',
      label: 'act until pass',
      ordering: { kind: 'simultaneous' },
      grammar: {
        kind: 'repeat',
        body: { kind: 'choice', actions: ['act-a'] }, // body NOT passable
        count: 'until-pass',
      },
    };
    const module = makeModule(flow, ['act-a']);
    const advanceFlow = createFlowRunner(module);
    const state = createGameExecutionState();

    const runners = expectFork(advanceFlow(state));
    const susp = expectWorkSuspend(
      nextPlayerTurnWork('p1', runners['p1'].cursor, runners['p1'].grammar, state, module),
    );
    const selectType = susp.input.type as { kind: 'action-select'; actions: string[]; canPass: boolean };
    expect(selectType.actions).toEqual(['act-a']);
    expect(selectType.canPass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nextRunnerWork — forced steps enqueue directly; choice points suspend.
// ---------------------------------------------------------------------------

describe('nextRunnerWork', () => {
  function cursorAt(sequenceIndex = 0, repeatCount = 0) {
    return { sequenceIndex, repeatCount, done: false };
  }

  it('sequence grammar: each step is forced — enqueues and advances the cursor, no prompt', () => {
    const module = makeModule({ kind: 'game', id: 'root', children: [] }, ['act-a', 'act-b']);
    const state = createGameExecutionState();
    const grammar: Grammar = { kind: 'sequence', actions: ['act-a', 'act-b'] };
    const cursor = cursorAt();

    const items1 = expectWorkEnqueue(nextPlayerTurnWork('p1', cursor, grammar, state, module));
    expect((items1[0] as EffectQueueItem).effect).toEqual({ kind: 'log', tag: 'act-a' });
    expect(cursor.sequenceIndex).toBe(1);
    expect(cursor.done).toBe(false);

    const items2 = expectWorkEnqueue(nextPlayerTurnWork('p1', cursor, grammar, state, module));
    expect((items2[0] as EffectQueueItem).effect).toEqual({ kind: 'log', tag: 'act-b' });
    expect(cursor.done).toBe(true);

    expect(nextPlayerTurnWork('p1', cursor, grammar, state, module).kind).toBe('done');
  });

  it('repeat with forced body below min: enqueues; prompts once pass becomes legal', () => {
    const module = makeModule({ kind: 'game', id: 'root', children: [] }, ['act-a']);
    const state = createGameExecutionState();
    const grammar: Grammar = {
      kind: 'repeat',
      body: { kind: 'action', ref: 'act-a' },
      count: { min: 1, max: 3 },
    };
    const cursor = cursorAt();

    // Below min — forced.
    expectWorkEnqueue(nextPlayerTurnWork('p1', cursor, grammar, state, module));
    expect(cursor.repeatCount).toBe(1);

    // Min satisfied — pass now legal, so the player must be prompted.
    const susp = expectWorkSuspend(nextPlayerTurnWork('p1', cursor, grammar, state, module));
    const st = susp.input.type as { kind: 'action-select'; actions: string[]; canPass: boolean };
    expect(st.actions).toEqual(['act-a']);
    expect(st.canPass).toBe(true);
  });

  it('choice grammar with one non-passable option: auto-executes (no decision exists)', () => {
    const module = makeModule({ kind: 'game', id: 'root', children: [] }, ['act-a']);
    const state = createGameExecutionState();
    const grammar: Grammar = { kind: 'choice', actions: ['act-a'] };
    const cursor = cursorAt();

    // Singleton + canPass=false → no decision → enqueue directly.
    const items = expectWorkEnqueue(nextPlayerTurnWork('p1', cursor, grammar, state, module));
    expect((items[0] as EffectQueueItem).effect).toEqual({ kind: 'log', tag: 'act-a' });
    expect(cursor.done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration — RPS-shaped flow driven through step()
// (Full step() integration awaits step() fork-mode implementation.)
// ---------------------------------------------------------------------------

describe('integration: loop + turn node fork result', () => {
  it('loop children produce fork results for each iteration', () => {
    const flow: FlowNode = {
      kind: 'loop',
      id: 'rounds',
      label: 'best of 2',
      count: 2,
      children: [
        {
          kind: 'turn',
          id: 'throw',
          label: 'make your throw',
          ordering: { kind: 'simultaneous' },
          grammar: { kind: 'choice', actions: ['rock', 'paper', 'scissors'] },
        },
      ],
    };
    const advanceFlow = createFlowRunner(makeModule(flow, ['rock', 'paper', 'scissors']));
    const state = createGameExecutionState();

    // Iteration 1: fork both players.
    const runners1 = expectFork(advanceFlow(state));
    expect(Object.keys(runners1).sort()).toEqual(['p1', 'p2']);

    // Simulate join for round 1.
    runners1['p1'].cursor.done = true;
    runners1['p2'].cursor.done = true;

    // Iteration 2: fork both players again (new cursors).
    const runners2 = expectFork(advanceFlow(state));
    expect(Object.keys(runners2).sort()).toEqual(['p1', 'p2']);
    // New cursor objects — fresh state.
    expect(runners2['p1'].cursor.done).toBe(false);

    runners2['p1'].cursor.done = true;
    runners2['p2'].cursor.done = true;

    // Loop exits after 2 iterations.
    expectComplete(advanceFlow(state));
  });
});
