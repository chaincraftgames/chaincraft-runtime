import type { GameSession, TurnOrdering } from '#chaincraft/types.js';
import type { GameExecutionState, PlayerTurnCursor } from '../types.js';
import { resolveNextEligibleActors } from '../turn-order.js';
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
  return { session, queue: [], pending: undefined, flowStack: [], playerTurns: undefined };
}

const done = (): PlayerTurnCursor => ({ sequenceIndex: 0, repeatCount: 0, done: true });

describe('resolveNextEligibleActors — eliminated players', () => {
  const roundRobin: TurnOrdering = { kind: 'round-robin' };
  const simultaneous: TurnOrdering = { kind: 'simultaneous' };
  const single: TurnOrdering = {
    kind: 'single',
    actor: { kind: 'state-ref', path: 'game.property.current' },
  };

  it('round-robin skips an eliminated player', () => {
    const state = makeState(['p1', 'p2', 'p3'], ['p2']);
    expect(resolveNextEligibleActors(roundRobin, state, { p1: done() })).toEqual(['p3']);
  });

  it('round-robin returns [] when all remaining players are eliminated', () => {
    const state = makeState(['p1', 'p2', 'p3'], ['p2', 'p3']);
    expect(resolveNextEligibleActors(roundRobin, state, { p1: done() })).toEqual([]);
  });

  it('simultaneous excludes eliminated players', () => {
    const state = makeState(['p1', 'p2', 'p3'], ['p1']);
    expect(resolveNextEligibleActors(simultaneous, state, {})).toEqual(['p2', 'p3']);
  });

  it('single skips when the referenced player is eliminated', () => {
    const state = makeState(['p1', 'p2'], ['p1']);
    expect(resolveNextEligibleActors(single, state, {})).toEqual([]);
  });

  it('treats a missing eliminated property as not eliminated', () => {
    const state = makeState(['p1', 'p2']);
    delete state.session.state.players.p1.properties.eliminated;
    expect(resolveNextEligibleActors(roundRobin, state, {})).toEqual(['p1']);
  });
});
