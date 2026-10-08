import type { GameSession, TurnOrdering } from '#chaincraft/types.js';
import type { GameExecutionState, PlayerTurnCursor } from '../types.js';
import { resolveNextEligibleActors, resolveStartPlayer } from '../turn-order.js';
import { createSeededRng } from '#chaincraft/rng/seeded.js';
import { GameEventEmitter } from '#chaincraft/events/emitter.js';

function makeState(players: string[], eliminated: string[] = []): GameExecutionState {
  const session: GameSession = {
    gameId: 'test-game',
    specId: 'test-spec',
    config: {
      inventories: {},
      gamepieceTypes: {},
      gameProperties: {},
      playerProperties: {},
      playerCount: { min: 2, max: 4 },
    },
    state: {
      gameProperties: { current: players[0] },
      gameInventories: {},
      players: Object.fromEntries(
        players.map((p) => [
          p,
          { roles: [], properties: { eliminated: eliminated.includes(p) }, inventories: {} },
        ]),
      ),
      gamepieces: {},
    },
    players,
    outbox: [],
    rng: createSeededRng(1),
    events: new GameEventEmitter(),
    _inventoryCache: new Map(),
  };
  return { session, queue: [], pending: undefined, flowStack: [], playerTurns: undefined, turn: undefined };
}

const done = (): PlayerTurnCursor => ({ sequenceIndex: 0, repeatCount: 0, done: true });

function next(
  ordering: TurnOrdering,
  state: GameExecutionState,
  cursors: Record<string, PlayerTurnCursor>,
): string[] {
  return resolveNextEligibleActors(ordering, state, cursors, resolveStartPlayer(ordering, state.session));
}

describe('resolveNextEligibleActors — eliminated players', () => {
  const roundRobin: TurnOrdering = { kind: 'round-robin' };
  const simultaneous: TurnOrdering = { kind: 'simultaneous' };
  const single: TurnOrdering = {
    kind: 'single',
    actor: { kind: 'state-ref', path: 'game.property.current' },
  };

  it('round-robin skips an eliminated player', () => {
    const state = makeState(['p1', 'p2', 'p3'], ['p2']);
    expect(next(roundRobin, state, { p1: done() })).toEqual(['p3']);
  });

  it('round-robin returns [] when all remaining players are eliminated', () => {
    const state = makeState(['p1', 'p2', 'p3'], ['p2', 'p3']);
    expect(next(roundRobin, state, { p1: done() })).toEqual([]);
  });

  it('simultaneous excludes eliminated players', () => {
    const state = makeState(['p1', 'p2', 'p3'], ['p1']);
    expect(next(simultaneous, state, {})).toEqual(['p2', 'p3']);
  });

  it('single falls through to the next seat when the referenced player is eliminated', () => {
    const state = makeState(['p1', 'p2'], ['p1']);
    expect(next(single, state, {})).toEqual(['p2']);
  });

  it('treats a missing eliminated property as not eliminated', () => {
    const state = makeState(['p1', 'p2']);
    delete state.session.state.players.p1.properties.eliminated;
    expect(next(roundRobin, state, {})).toEqual(['p1']);
  });
});

describe('resolveStartPlayer / round-robin start', () => {
  const fromCurrent: TurnOrdering = {
    kind: 'round-robin',
    start: { kind: 'state-ref', path: 'game.property.current' },
  };

  function order(state: GameExecutionState): string[] {
    const start = resolveStartPlayer(fromCurrent, state.session);
    const cursors: Record<string, PlayerTurnCursor> = {};
    const seen: string[] = [];
    for (;;) {
      const [p] = resolveNextEligibleActors(fromCurrent, state, cursors, start);
      if (!p) return seen;
      seen.push(p);
      cursors[p] = done();
    }
  }

  it('rotates clockwise from the referenced player', () => {
    const state = makeState(['p1', 'p2', 'p3']);
    state.session.state.gameProperties.current = 'p2';
    expect(order(state)).toEqual(['p2', 'p3', 'p1']);
  });

  it('starts at the next seat when the referenced player is eliminated', () => {
    const state = makeState(['p1', 'p2', 'p3'], ['p2']);
    state.session.state.gameProperties.current = 'p2';
    expect(order(state)).toEqual(['p3', 'p1']);
  });

  it('wraps to seat 1 when the eliminated referenced player is in the last seat', () => {
    const state = makeState(['p1', 'p2', 'p3'], ['p3']);
    state.session.state.gameProperties.current = 'p3';
    expect(order(state)).toEqual(['p1', 'p2']);
  });

  it('starts at seat 1 when the referenced property is empty', () => {
    const state = makeState(['p1', 'p2', 'p3']);
    state.session.state.gameProperties.current = '';
    expect(order(state)).toEqual(['p1', 'p2', 'p3']);
  });

  it('throws when the referenced value is not a player', () => {
    const state = makeState(['p1', 'p2']);
    state.session.state.gameProperties.current = 'nobody';
    expect(() => resolveStartPlayer(fromCurrent, state.session)).toThrow(/not a player/);
  });

  it('returns null when every player is eliminated', () => {
    const state = makeState(['p1', 'p2'], ['p1', 'p2']);
    expect(resolveStartPlayer(fromCurrent, state.session)).toBeNull();
  });
});
