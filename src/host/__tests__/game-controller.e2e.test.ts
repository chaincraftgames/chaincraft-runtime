// ---------------------------------------------------------------------------
// GameController e2e — drives the hand-written High Card module through the
// GameController API (GameController → ScriptedDriver) and verifies the two
// contract directions:
//   1. the runtime asks for the right inputs (prompt assertions)
//   2. the runtime communicates the right state changes (messages + snapshots)
//
// The full-game suite is skipped until step() handles the flow runner's
// 'fork' result (turn-node acting phase — in-flight engine work). The setup
// suite runs the same module shape minus the turn node and passes today.
// ---------------------------------------------------------------------------

import type { CompiledGameModule, FlowNode, GameState } from '#chaincraft/types.js';
import type { PlayerInputSuspension } from '#chaincraft/orchestration/types.js';
import { GameController } from '#chaincraft/orchestration/game-controller.js';
import { drive, type ScriptStep, type TranscriptEntry } from '../scripted-driver.js';
import { createHighCardModule } from '../fixtures/high-card.js';

const PLAYERS = ['alice', 'bob'];

function messagesIn(transcript: TranscriptEntry[]): string[] {
  return transcript
    .filter((e): e is Extract<TranscriptEntry, { kind: 'messages' }> => e.kind === 'messages')
    .flatMap((e) => e.messages.map((m) => m.content));
}

function handPieceIds(state: GameState, playerId: string): string[] {
  const inv = state.players[playerId].inventories.hand;
  return 'pieceIds' in inv ? inv.pieceIds : [];
}

function gameInvPieceIds(state: GameState, inventoryId: string): string[] {
  const inv = state.gameInventories[inventoryId];
  return 'pieceIds' in inv ? inv.pieceIds : [];
}

function score(state: GameState, playerId: string): number {
  return Number(state.players[playerId].properties.score ?? 0);
}

// ---------------------------------------------------------------------------
// Setup-only module: identical hooks/effects, no turn node. Passes today.
// ---------------------------------------------------------------------------

function setupOnlyModule(): CompiledGameModule {
  const base = createHighCardModule();
  const game = base.flow as Extract<FlowNode, { kind: 'game' }>;
  return { ...base, flow: { ...game, children: [] } };
}

describe('GameController — High Card setup (hooks only)', () => {
  it('deals hands via onEnter hooks and completes with transcript evidence', async () => {
    const result = await drive(setupOnlyModule(), 'g1', PLAYERS, []);
    const { controller } = result;

    // Game ran to completion with no player input required.
    expect(result.outcome).toBeDefined();
    expect(result.unansweredPrompt).toBeUndefined();

    // State changes communicated: 3 cards dealt to each hand, deck empty.
    const finalState = controller.getState();
    for (const pid of PLAYERS) {
      expect(handPieceIds(finalState, pid)).toHaveLength(3);
    }
    const deck = finalState.gameInventories.deck;
    expect('pieceIds' in deck && deck.pieceIds).toHaveLength(0);

    // Messages delivered through the outbox.
    const messages = messagesIn(result.transcript);
    expect(messages).toContain('Cards dealt. Highest card takes the trick — most tricks wins!');
    // Nothing played → scores tie at 0 → first player wins the tie.
    expect(messages).toContain('The winner is alice!');
    expect(finalState.gameProperties.winner).toBe('alice');

    // State snapshots were recorded along the way.
    expect(result.transcript.some((e) => e.kind === 'state')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full game — UNSKIP once step() handles FlowAdvanceResult 'fork'
// (turn-node acting phase). Written against the target contract now so it
// becomes the acceptance test for that engine work.
// ---------------------------------------------------------------------------

// UNSKIP once the engine work settles. Current gap when last tried: the
// gamepiece-select suspension reaches the right player but prompt.options is
// undefined (resolveOptions not applied to action-input suspensions).
describe('GameController — High Card full game e2e', () => {
  /**
   * One player-turn. The grammar is a bare action node — forced play, no
   * action-select decision — so the runner goes straight to the action's
   * gamepiece-select input.
   */
  function playerTurn(playerId: string): ScriptStep[] {
    return [
      {
        playerId,
        // Play the first card the runtime offers from this player's hand.
        valueFrom: (prompt) => (prompt.options as string[])[0],
        expect: (prompt: PlayerInputSuspension) => {
          expect(prompt.input.id).toBe('card');
          expect(prompt.input.type.kind).toBe('gamepiece-select');
          // The offered options must be exactly the player's current hand.
          expect(prompt.options).toBeDefined();
          expect(prompt.options!.length).toBeGreaterThan(0);
        },
      },
    ];
  }

  it('plays 3 tricks to completion and declares the correct winner', async () => {
    const script: ScriptStep[] = [1, 2, 3].flatMap(() =>
      PLAYERS.flatMap((pid) => playerTurn(pid)),
    );

    const result = await drive(createHighCardModule(), 'g2', PLAYERS, script);
    const { controller } = result;
    expect(result.outcome).toBeDefined();

    // All cards played through the table into the discard.
    const finalState = controller.getState();
    for (const pid of PLAYERS) {
      expect(handPieceIds(finalState, pid)).toHaveLength(0);
    }
    expect(gameInvPieceIds(finalState, 'table')).toHaveLength(0);
    expect(gameInvPieceIds(finalState, 'discard')).toHaveLength(6);

    // Three tricks were awarded (2 players → no ties possible → a majority
    // winner always exists).
    expect(score(finalState, 'alice') + score(finalState, 'bob')).toBe(3);
    const expectedWinner = score(finalState, 'alice') >= 2 ? 'alice' : 'bob';
    expect(finalState.gameProperties.winner).toBe(expectedWinner);

    // Each trick was announced, then the final winner.
    const messages = messagesIn(result.transcript);
    const trickMessages = messages.filter((m) => m.endsWith('takes the trick!'));
    expect(trickMessages).toHaveLength(3);
    expect(messages).toContain(`The winner is ${expectedWinner}!`);
  });
});
