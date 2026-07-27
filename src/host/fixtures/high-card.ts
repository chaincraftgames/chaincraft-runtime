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
//   resolve-trick    → chaincraft:trump mechanic (comparison highest)
//   determine-winner → winConditions rule: ranking on player.property.score
// ---------------------------------------------------------------------------

import type {
  ActionDef,
  CompiledGameModule,
  EffectContext,
  EffectRegistration,
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

export const HIGH_CARD_CARD_VALUES = [1, 2, 3, 4, 5, 6] as const;

/**
 * Bridges a typed effect executor (EffectContext<SomeDef>) into the untyped
 * EffectRegistration slot. NOTE for the runtime: every compiled module will
 * need this cast until EffectExecutor.execute is generic over the def type.
 */
function builtIn<T>(
  fn: (session: GameSession, ctx: EffectContext<T>) => Promise<void>,
): EffectRegistration {
  return {
    kind: 'effect-executor',
    execute: fn as (session: GameSession, ctx: EffectContext) => Promise<void>,
  };
}

// --- Config (what the compiler derives from the spec modules) ---------------

const config: GameConfig = {
  inventories: {
    deck: { structure: 'stack', scope: 'game', visibility: 'never', accepts: ['card'] },
    hand: { structure: 'none', scope: 'player', visibility: 'owner', accepts: ['card'] },
    table: { structure: 'none', scope: 'game', visibility: 'always', accepts: ['card'] },
    discard: { structure: 'none', scope: 'game', visibility: 'always', accepts: ['card'] },
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
      { kind: 'shuffle', inventory: 'deck' },
      {
        kind: 'distribute',
        from: { inventory: 'deck', select: 'top' },
        to: { inventory: 'hand' },
        count: 3,
        style: 'round-robin',
      },
      {
        kind: 'message',
        template: 'Cards dealt. Highest card takes the trick — most tricks wins!',
        to: 'all',
      },
    ],
    onComplete: [
      // Stand-in for winConditions rule: ranking on player.property.score.
      { kind: 'custom', id: 'determine-winner' },
      { kind: 'message', template: 'The winner is {{state.game.property.winner}}!', to: 'all' },
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
              // Stand-in for the chaincraft:trump mechanic's resolve effect.
              { kind: 'custom', id: 'resolve-trick' },
              {
                kind: 'set-state',
                path: 'player.property.score',
                value: { delta: 1 },
                target: { kind: 'stateRef', path: 'game.property.roundWinner' },
              },
              {
                kind: 'message',
                template: '{{state.game.property.roundWinner}} takes the trick!',
                to: 'all',
              },
              {
                kind: 'move',
                from: { inventory: 'table', select: 'all', ofType: 'card' },
                to: { inventory: 'discard' },
              },
              { kind: 'set-state', path: 'game.property.roundWinner', value: '' },
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

const customHandlers: CustomHandlerMap = {
  // Stand-in for the chaincraft:trump mechanic (comparison highest on
  // 'value' over the 'table' inventory, winnerToState roundWinner). The
  // winner is the OWNER of the highest card — ownership is set when cards
  // are dealt/moved into a player inventory and survives the move to the
  // game-scoped table. Card values are unique, so no tie handling.
  'resolve-trick': async (session: GameSession) => {
    const table = session.state.gameInventories.table;
    const pieceIds = 'pieceIds' in table ? table.pieceIds : [];
    let bestPieceId = '';
    let bestValue = -1;
    for (const id of pieceIds) {
      const value = Number(session.state.gamepieces[id]?.properties.value ?? 0);
      if (value > bestValue) {
        bestValue = value;
        bestPieceId = id;
      }
    }
    session.state.gameProperties.roundWinner =
      session.state.gamepieces[bestPieceId]?.ownerId ?? '';
  },
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
      _inventoryCache: new Map(),
    }),
    flow,
    effects: {
      shuffle: builtIn(executeShuffle),
      distribute: builtIn(executeDistribute),
      move: builtIn(executeMove),
      message: builtIn(executeMessage),
      'set-state': builtIn(executeSetState),
      custom: createCustomExecutor(customHandlers),
    },
    effectDefs: {},
    actions: { playCard },
  };
}
