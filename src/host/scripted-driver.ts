// ---------------------------------------------------------------------------
// ScriptedDriver — automated e2e verification over a GameController.
//
// Feeds a script of player responses to the controller and returns the
// transcript. A script entry may assert against the prompt it answers, so
// tests verify both directions of the contract: the runtime asks for the
// right inputs (prompt assertions) and communicates the right state changes
// (transcript state snapshots / message entries).
// ---------------------------------------------------------------------------

import type { 
  CompiledGameModule, 
  GameState, 
  Message
} from '#chaincraft/types.js';
import type { 
  PlayerInputSuspension, 
  GameOutcome 
} from '#chaincraft/orchestration/types.js';
import {
  GameController,
  type SystemResponder,
} from '#chaincraft/api/game-controller.js';

// ---------------------------------------------------------------------------
// Transcript types (moved from game-host.ts)
// ---------------------------------------------------------------------------

export type TranscriptEntry =
  | { kind: 'prompt'; prompt: PlayerInputSuspension }
  | { kind: 'player-response'; playerId: string; value: unknown }
  | { kind: 'system-response'; requestId: string }
  | { kind: 'messages'; messages: Message[] }
  | { kind: 'state'; state: GameState }
  | { kind: 'complete'; outcome: GameOutcome };

// ---------------------------------------------------------------------------
// Drive script types
// ---------------------------------------------------------------------------

export interface ScriptStep {
  /** Player expected to be (among those) awaited by the current prompt. */
  playerId: string;
  /** Value to submit. Mutually exclusive with valueFrom. */
  value?: unknown;
  /** Derive the value from the prompt (e.g. "first option in my hand"). */
  valueFrom?: (prompt: PlayerInputSuspension) => unknown;
  /** Optional assertion against the prompt this step answers. Throw to fail. */
  expect?: (prompt: PlayerInputSuspension) => void;
}

export interface DriveResult {
  transcript: TranscriptEntry[];
  /** Defined when the script ran to game completion. */
  outcome: GameOutcome | undefined;
  /** Defined when the script was exhausted while the game still wanted input. */
  unansweredPrompt: PlayerInputSuspension | undefined;
}

// ---------------------------------------------------------------------------
// drive()
// ---------------------------------------------------------------------------

/**
 * Constructs a GameController, runs init(), then plays through the script.
 * Fails fast when a prompt doesn't await the scripted player, an expectation
 * throws, or the game completes with script steps left over.
 *
 * Transcript entries are recorded from controller events:
 *   - messages are batched between prompts into {kind:'messages'}
 *   - a {kind:'state'} snapshot is recorded after init() and each processAction()
 *   - {kind:'prompt'} is recorded when the controller raises a player-input prompt
 *   - {kind:'complete'} is recorded when the game ends
 */
export async function drive(
  module: CompiledGameModule,
  gameId: string,
  players: string[],
  script: ScriptStep[],
  options?: { systemResponder?: SystemResponder },
): Promise<DriveResult & { controller: GameController }> {
  const transcript: TranscriptEntry[] = [];
  // Accumulates messages fired between prompt/complete events.
  const pendingMessages: Message[] = [];

  const controller = new GameController(module, {
    systemResponder: options?.systemResponder,
    events: {
      onMessage(message) {
        pendingMessages.push(message);
      },
      onPrompt(prompt) {
        // Flush accumulated messages before recording the prompt.
        if (pendingMessages.length > 0) {
          transcript.push({ kind: 'messages', messages: pendingMessages.splice(0) });
        }
        transcript.push({ kind: 'prompt', prompt });
      },
      onComplete(outcome) {
        // Flush accumulated messages before recording completion.
        if (pendingMessages.length > 0) {
          transcript.push({ kind: 'messages', messages: pendingMessages.splice(0) });
        }
        transcript.push({ kind: 'complete', outcome });
      },
    },
  });

  await controller.init(gameId, players);
  // Record a state snapshot after initialization.
  transcript.push({ kind: 'state', state: controller.getState() });

  for (const [index, entry] of script.entries()) {
    if (controller.isComplete) {
      throw new Error(
        `Game completed but ${script.length - index} script step(s) remain ` +
        `(next: ${entry.playerId} → ${JSON.stringify(entry.value)})`,
      );
    }

    const prompt = controller.promptFor(entry.playerId);
    if (!prompt) {
      throw new Error(`Script step ${index}: no prompt pending for player "${entry.playerId}" (input: ${entry.playerId})`);
    }
    entry.expect?.(prompt);

    const value = entry.valueFrom ? entry.valueFrom(prompt) : entry.value;
    transcript.push({ kind: 'player-response', playerId: entry.playerId, value });
    await controller.processAction({ playerId: entry.playerId, value });
    // Record a state snapshot after each action.
    transcript.push({ kind: 'state', state: controller.getState() });
  }

  return {
    transcript,
    outcome: controller.outcome,
    unansweredPrompt: controller.pendingPrompts.size > 0
      ? (controller.pendingPrompts.values().next().value ?? undefined)
      : undefined,
    controller,
  };
}

// ---------------------------------------------------------------------------
// printTranscript — human-readable transcript dump for scripts / debugging.
// ---------------------------------------------------------------------------

function invPieceIds(state: GameState, key: string, scope: 'game' | 'player', playerId?: string): string[] {
  let inv: unknown;
  if (scope === 'game') {
    inv = state.gameInventories[key];
  } else if (playerId) {
    inv = state.players[playerId]?.inventories?.[key];
  }
  return inv && typeof inv === 'object' && 'pieceIds' in inv ? (inv as { pieceIds: string[] }).pieceIds : [];
}

/**
 * Prints a human-readable transcript to stdout. Pass `players` to include
 * per-player hand snapshots in state lines.
 */
export function printTranscript(transcript: TranscriptEntry[], players?: string[]): void {
  console.log('\n=== TRANSCRIPT ===');
  for (const entry of transcript) {
    switch (entry.kind) {
      case 'messages':
        for (const m of entry.messages) console.log(`  [msg]      ${m.content}`);
        break;
      case 'prompt':
        console.log(
          `  [prompt]   ${entry.prompt.awaiting} → ${entry.prompt.input.id}` +
          ` (${entry.prompt.input.type.kind})` +
          ` options=${JSON.stringify(entry.prompt.options)}`,
        );
        break;
      case 'player-response':
        console.log(`  [response] ${entry.playerId} played ${JSON.stringify(entry.value)}`);
        break;
      case 'state': {
        const s = entry.state as Record<string, unknown> & {
          gameInventories?: Record<string, unknown>;
          players?: Record<string, Record<string, unknown>>;
        };
        const hands = players
          ? players.map((p) => `${p}:[${invPieceIds(entry.state, 'hand', 'player', p).join(',')}]`).join(' ')
          : '';
        const table = invPieceIds(entry.state, 'table', 'game');
        const discard = invPieceIds(entry.state, 'discard', 'game');
        const parts = [
          hands,
          table.length ? `table:[${table.join(',')}]` : '',
          `discard:[${discard.join(',')}]`,
        ].filter(Boolean);
        console.log(`  [state]    ${parts.join('  ')}`);
        break;
      }
      case 'complete':
        console.log(`  [complete] ${JSON.stringify(entry.outcome)}`);
        break;
    }
  }
}
