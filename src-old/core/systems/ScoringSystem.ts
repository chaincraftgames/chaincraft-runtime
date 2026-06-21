import { World, WorldContext, getGameState, query } from '#core/engine.js';
import { updatePlayerScore } from '#core/components/player/PlayerScore.js';

export type ScoringRule = {
  evaluate: (world: World<WorldContext>) => Map<number, number>;
}

export const createScoringSystem = (world: World<WorldContext>, rules: ScoringRule[]) => {
  const system = async (world: World<WorldContext>): Promise<void> => {
    console.debug('[ScoringSystem] - execute.');
    
    // Get all players
    const players = query(world, [world.components.PlayerRole]);
    const gameState = getGameState(world);

    // Apply each rule
    for (const rule of rules) {
      const scores = rule.evaluate(world);
      // Update scores for all players
      for (const playerId of players) {
        const points = scores.get(playerId) || 0;
        updatePlayerScore(world, playerId, points, gameState);
        console.debug(`[ScoringSystem] Player ${playerId} scored ${points} points`);
      }
    }
  };

  world.systems.Scoring = system;
  return system;
}