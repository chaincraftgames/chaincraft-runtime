import { createHighCardModule } from '../src/host/fixtures/high-card.js';
import { drive, printTranscript, type ScriptStep } from '../src/host/scripted-driver.js';
import type { PlayerInputSuspension } from '../src/orchestration/types.js';

const module = createHighCardModule();
const PLAYERS = ['alice', 'bob'];

function playerTurn(pid: string): ScriptStep[] {
  return [{ playerId: pid, valueFrom: (prompt: PlayerInputSuspension) => (prompt.options as string[])[0] }];
}

const script: ScriptStep[] = [1, 2, 3].flatMap(() => PLAYERS.flatMap(pid => playerTurn(pid)));
const result = await drive(module, 'g1', PLAYERS, script);

printTranscript(result.transcript, PLAYERS);

console.log('\n=== FINAL STATE ===');
const s = result.controller.getState();
console.log('alice score:', s.players.alice.properties.score);
console.log('bob score:  ', s.players.bob.properties.score);
console.log('winner:     ', s.gameProperties.winner);
