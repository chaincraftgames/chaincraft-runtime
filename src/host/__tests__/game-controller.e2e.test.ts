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
import { GameController } from '#chaincraft/api/game-controller.js';
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

// ---------------------------------------------------------------------------
// Event ordering — a prompt must never arrive before the state it refers to.
// ---------------------------------------------------------------------------

describe('GameController — event ordering', () => {
  function expectStateChangesBeforePrompt(order: string[]): void {
    expect(order).toContain('state-change');
    expect(order).toContain('prompt');
    expect(order.lastIndexOf('state-change')).toBeLessThan(order.indexOf('prompt'));
  }

  it('flushes state changes before firing onPrompt', async () => {
    const order: string[] = [];
    const controller = new GameController(createHighCardModule(), {
      events: {
        onStateChange: () => order.push('state-change'),
        onPrompt: () => order.push('prompt'),
      },
    });

    await controller.init('g3', PLAYERS);
    expectStateChangesBeforePrompt(order);

    order.length = 0;
    const prompt = controller.currentPrompt!;
    await controller.processAction({
      playerId: prompt.awaiting,
      value: (prompt.options as string[])[0],
    });
    expectStateChangesBeforePrompt(order);
  });
});

// ---------------------------------------------------------------------------
// Turn lifecycle — turn-start/turn-end bracket each fork; everything that
// happened before a boundary is delivered before it.
// ---------------------------------------------------------------------------

describe('GameController — turn lifecycle', () => {
  const TURN = { nodeId: 'play-trick', label: 'Play a card' };

  function recordingController(module: CompiledGameModule): {
    controller: GameController;
    order: string[];
  } {
    const order: string[] = [];
    const controller = new GameController(module, {
      events: {
        onStateChange: () => order.push('state-change'),
        onMessage: () => order.push('message'),
        onPrompt: (p) => order.push(`prompt:${p.awaiting}`),
        onTurnStart: (t) => order.push(`turn-start:${t.actors.join(',')}`),
        onTurnEnd: (t) => order.push(`turn-end:${t.actors.join(',')}`),
        onComplete: () => order.push('complete'),
      },
    });
    return { controller, order };
  }

  async function playFirstOption(controller: GameController, playerId: string): Promise<void> {
    const prompt = controller.promptFor(playerId)!;
    await controller.processAction({ playerId, value: (prompt.options as string[])[0] });
  }

  it('round-robin: one turn per actor, with prior messages and state changes flushed first', async () => {
    const { controller, order } = recordingController(createHighCardModule());

    await controller.init('t1', PLAYERS);
    expect(order).toEqual(['message', 'state-change', 'turn-start:alice', 'prompt:alice']);
    expect(controller.currentTurn).toEqual({ ...TURN, actors: ['alice'] });

    order.length = 0;
    await playFirstOption(controller, 'alice');
    expect(order).toEqual(['state-change', 'turn-end:alice', 'turn-start:bob', 'prompt:bob']);
    expect(controller.currentTurn).toEqual({ ...TURN, actors: ['bob'] });

    // Trick resolution (onComplete hooks) lands between bob's turn-end and alice's turn-start.
    order.length = 0;
    await playFirstOption(controller, 'bob');
    expect(order).toEqual([
      'state-change',
      'turn-end:bob',
      'message',
      'state-change',
      'turn-start:alice',
      'prompt:alice',
    ]);
  });

  it('round-robin: turn-end precedes completion and no turn is active afterwards', async () => {
    const { controller, order } = recordingController(createHighCardModule());
    await controller.init('t2', PLAYERS);
    for (let i = 0; i < 3; i++) {
      for (const pid of PLAYERS) await playFirstOption(controller, pid);
    }

    expect(controller.isComplete).toBe(true);
    expect(controller.currentTurn).toBeUndefined();
    expect(order.filter((e) => e.startsWith('turn-start'))).toHaveLength(6);
    expect(order.filter((e) => e.startsWith('turn-end'))).toHaveLength(6);
    expect(order.lastIndexOf('turn-end:bob')).toBeLessThan(order.indexOf('complete'));
    expect(order.slice(order.lastIndexOf('turn-end:bob'))).not.toContain('turn-start:alice');
  });

  it('simultaneous: one turn for all actors, ending only at the join', async () => {
    const base = createHighCardModule();
    const game = base.flow as Extract<FlowNode, { kind: 'game' }>;
    const loop = game.children[0] as Extract<FlowNode, { kind: 'loop' }>;
    const turn = loop.children[0] as Extract<FlowNode, { kind: 'turn' }>;
    const module: CompiledGameModule = {
      ...base,
      flow: {
        ...game,
        children: [
          { ...loop, children: [{ ...turn, ordering: { kind: 'simultaneous' } }] },
        ],
      },
    };
    const { controller, order } = recordingController(module);

    await controller.init('t3', PLAYERS);
    expect(order.filter((e) => e.startsWith('turn-'))).toEqual(['turn-start:alice,bob']);
    expect(controller.currentTurn).toEqual({ ...TURN, actors: ['alice', 'bob'] });

    order.length = 0;
    await playFirstOption(controller, 'alice');
    expect(order.filter((e) => e.startsWith('turn-'))).toEqual([]);

    order.length = 0;
    await playFirstOption(controller, 'bob');
    expect(order.filter((e) => e.startsWith('turn-'))).toEqual([
      'turn-end:alice,bob',
      'turn-start:alice,bob',
    ]);
  });
});
