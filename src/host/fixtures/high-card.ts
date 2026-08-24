// ---------------------------------------------------------------------------
// High Card — slice-0 hand-written CompiledGameModule.
//
// This fixture is the compiler's north star: the exact module shape the
// deterministic compiler should eventually produce from
// gamedef/examples/high-card.yaml. Keep the two in lockstep.
//
// Game: 6 cards (values 1–6) are shuffled and dealt, 3 to each of 2 players.
// Three tricks; each trick, both players must play one card from hand to the
// shared table. The higher card wins the trick (values are unique, so no
// ties) and its owner scores a point. Most tricks after 3 rounds wins.
//
// Exercises: onEnter/onComplete hooks, shuffle, distribute, loop(count),
// round-robin turn, action grammar (forced play — the only decision is
// which card), gamepiece-select input, move with { id: { param } } selector,
// set-state with delta + stateRef player target, message templates.
//
// Custom-effect stand-ins for engine features the spec expresses
// declaratively (remove when the runtime grows the real thing):
//   resolve-trick    → chaincraft:dominant-gamepiece mechanic (comparison highest)
//   determine-winner → winConditions rule: ranking on player.property.score
// ---------------------------------------------------------------------------

import type {
  ActionDef,
  CompiledGameModule,
  EffectContext,
  FlowNode,
  GameConfig,
  GameSession,
  GameState,
  Gamepiece,
} from '#chaincraft/types.js';
import {
  executeDistribute,
  executeMessage,
  executeMove,
  executeSetState,
  executeShuffle,
  createCustomExecutor,
  type CustomHandlerMap,
} from '#chaincraft/effects/index.js';
import { createSeededRng } from '#chaincraft/rng/seeded.js';
import { createDominantGamepieceResolver } from '#chaincraft/mechanics/dominant-gamepiece/index.js';
import { GameEventEmitter } from '#chaincraft/events/emitter.js';

export const HIGH_CARD_CARD_VALUES = [1, 2, 3, 4, 5, 6] as const;

// --- Config (what the compiler derives from the spec modules) ---------------

const config: GameConfig = {
  inventories: {
    deck: { structure: 'stack', scope: 'game', visibility: 'never', countVisibility: 'always', accepts: ['card'] },
    hand: { structure: 'none', scope: 'player', visibility: 'owner', countVisibility: 'always', accepts: ['card'] },
    table: { structure: 'none', scope: 'game', visibility: 'always', countVisibility: 'always', accepts: ['card'] },
    discard: { structure: 'none', scope: 'game', visibility: 'always', countVisibility: 'always', accepts: ['card'] },
  },
  gamepieceTypes: {
    card: {
      category: 'card',
      properties: {
        value: { mutable: false, min: 1, max: 6 },
      },
    },
  },
  gameProperties: {
    winner: { mutable: true, refType: 'player-id' },
    roundWinner: { mutable: true },
  },
  playerProperties: {
    score: { mutable: true },
  },
  playerCount: { min: 2, max: 2 },
};

// --- Initial state (catalog instantiation) ----------------------------------

function initialState(players: string[]): GameState {
  const gamepieces: Record<string, Gamepiece> = {};
  const deckIds: string[] = [];
  for (const value of HIGH_CARD_CARD_VALUES) {
    const id = `card-${value}`;
    gamepieces[id] = {
      typeId: 'card',
      ownerId: '',
      properties: { value },
      faceUp: false,
      exhausted: false,
      visibleTo: null,
    };
    deckIds.push(id);
  }
  return {
    gameProperties: { winner: '', roundWinner: '' },
    gameInventories: {
      deck: { structure: 'stack', pieceIds: deckIds },
      table: { structure: 'none', pieceIds: [] },
      discard: { structure: 'none', pieceIds: [] },
    },
    players: Object.fromEntries(
      players.map((pid) => [
        pid,
        {
          roles: [],
          properties: { score: 0 },
          inventories: {
            hand: { structure: 'none' as const, pieceIds: [] },
          },
        },
      ]),
    ),
    gamepieces,
  };
}

// --- Flow tree ---------------------------------------------------------------

const flow: FlowNode = {
  kind: 'game',
  id: 'high-card',
  hooks: {
    onEnter: [
      { ref: 'fillDeck' },
      { ref: 'shuffleDeck' },
      { ref: 'dealCards' },
      { ref: 'announceStart' },
    ],
    onComplete: [
      // Stand-in for winConditions rule: ranking on player.property.score.
      { kind: 'custom', id: 'determine-winner' },
      { ref: 'announceWinner' },
    ],
  },
  children: [
    {
      kind: 'loop',
      id: 'tricks',
      label: 'Tricks',
      count: 3,
      children: [
        {
          kind: 'turn',
          id: 'play-trick',
          label: 'Play a card',
          ordering: { kind: 'round-robin' },
          // Forced play — the only decision is which card, so a bare action
          // node, not a single-option choice.
          grammar: { kind: 'action', ref: 'playCard' },
          hooks: {
            onComplete: [
              { ref: 'chaincraft:dominant-gamepiece:resolve' },
              { ref: 'awardTrick' },
              { ref: 'announceTrick' },
              { ref: 'clearTable' },
              { ref: 'resetRoundWinner' },
            ],
          },
        },
      ],
    },
  ],
};

// --- Actions -----------------------------------------------------------------

const playCard: ActionDef = {
  id: 'playCard',
  label: 'Play a card',
  description: 'Play one card from your hand to the table.',
  inputs: [
    {
      id: 'card',
      label: 'Choose a card to play',
      type: { kind: 'gamepiece-select', inventory: 'hand', ofType: 'card', fromPlayer: 'self' },
    },
  ],
  effects: [
    {
      kind: 'move',
      from: { inventory: 'hand', select: { id: { param: 'card' } } },
      to: { inventory: 'table' },
    },
  ],
};

// --- Custom effects (the LLM-generated file, hand-written here) --------------
// 'resolve-trick' stand-in removed: replaced by real dominant-gamepiece resolver below.
// 'determine-winner' stand-in remains until winConditions is implemented in the runtime.

const customHandlers: CustomHandlerMap = {
  // Stand-in for winConditions rule: ranking (highest) on
  // player.property.score. First player wins a tie (setup-only tests rely
  // on this; a full game of 3 tricks between 2 players cannot tie).
  'determine-winner': async (session: GameSession) => {
    let bestId = '';
    let bestScore = -1;
    for (const pid of session.players) {
      const score = Number(session.state.players[pid].properties.score ?? 0);
      if (score > bestScore) {
        bestScore = score;
        bestId = pid;
      }
    }
    session.state.gameProperties.winner = bestId;
  },
};

// Real dominant-gamepiece resolver (replaces the 'resolve-trick' custom stand-in)
const dominantGamepieceResolver = createDominantGamepieceResolver({
  evaluationInventory: 'table',
  winnerToState: 'game.property.roundWinner',
  rules: [{ kind: 'comparison', property: 'value', direction: 'highest' }],
});

// --- Module ------------------------------------------------------------------

/**
 * @param rngSeed Seed for the session RNG — fixed default for deterministic tests.
 */
export function createHighCardModule(rngSeed = 42): CompiledGameModule {
  return {
    specId: 'high-card',
    metadata: { name: 'High Card', playerCount: { min: 2, max: 2 } },
    createSession: (gameId, players): GameSession => ({
      gameId,
      specId: 'high-card',
      config,
      state: initialState(players),
      players,
      outbox: [],
      rng: createSeededRng(rngSeed),
      events: new GameEventEmitter(),
      _inventoryCache: new Map(),
    }),
    flow,
    effects: {
      shuffle: { kind: 'effect-executor', execute: executeShuffle },
      distribute: { kind: 'effect-executor', execute: executeDistribute },
      move: { kind: 'effect-executor', execute: executeMove },
      message: { kind: 'effect-executor', execute: executeMessage },
      'set-state': { kind: 'effect-executor', execute: executeSetState },
      custom: createCustomExecutor(customHandlers),
      'chaincraft:dominant-gamepiece': dominantGamepieceResolver,
    },
    effectDefs: {
      fillDeck: {
        kind: 'move',
        from: { inventory: 'game:unassigned', select: 'all', ofType: 'card' },
        to: { inventory: 'deck' },
      },
      shuffleDeck: {
        kind: 'shuffle',
        inventory: 'deck',
      },
      dealCards: {
        kind: 'distribute',
        from: { inventory: 'deck', select: 'top' },
        to: { inventory: 'hand' },
        count: 3,
        style: 'round-robin',
      },
      announceStart: {
        kind: 'message',
        template: 'Cards dealt. Highest card takes the trick — most tricks wins!',
        to: 'all',
      },
      announceWinner: {
        kind: 'message',
        template: 'The winner is {{state.game.property.winner}}!',
        to: 'all',
      },
      'chaincraft:dominant-gamepiece:resolve': {
        kind: 'chaincraft:dominant-gamepiece',
        evaluationInventory: 'table',
        winnerToState: 'game.property.roundWinner',
        rules: [{ kind: 'comparison', property: 'value', direction: 'highest' }],
      },
      awardTrick: {
        kind: 'set-state',
        path: 'player.property.score',
        value: { delta: 1 },
        target: { kind: 'stateRef', path: 'game.property.roundWinner' },
      },
      announceTrick: {
        kind: 'message',
        template: '{{state.game.property.roundWinner}} takes the trick!',
        to: 'all',
      },
      clearTable: {
        kind: 'move',
        from: { inventory: 'table', select: 'all', ofType: 'card' },
        to: { inventory: 'discard' },
      },
      resetRoundWinner: {
        kind: 'set-state',
        path: 'game.property.roundWinner',
        value: '',
      },
    },
    actions: { playCard },
  };
}
