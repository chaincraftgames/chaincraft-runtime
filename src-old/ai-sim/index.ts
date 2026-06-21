import dotenv from "dotenv";
import { resolve } from "path";

import { IEngine, IModule } from "#core/IModule.js";
import { processGameDescription } from "#ai-sim/gameDescriptionProcessorv2.js";
import { initializeRuntime, RuntimeResponse, Runtime } from "./runtime.js";
import { PlayerInput, PlayerMessageQueue } from "#core/messaging/MessageQueues.js";

// Set environment
// Load environment variables from .env file in project root
dotenv.config({ path: resolve(process.cwd(), ".env") });

console.debug("[model] - env:", process.env);

let nextGameId = 0;

export const createAiGameModule = async (
  gameDescription: string
): Promise<IModule> => {
  const { maxPlayers, name, stateSchema } = await processGameDescription(
    gameDescription
  );

  const games = new Map<number, Runtime>();

  let runtime: Runtime;
  let gameLoop: () => void;

  return {
    name,
    maxPlayers,
    createGame: async () => {
      runtime = await initializeRuntime(gameDescription, stateSchema);
      const gameId = ++nextGameId;
      games.set(gameId, runtime);
      return gameId;
    },
    initializeGame: async (gameId: number, players: string[], engine: IEngine) => {
      console.info(
        `[AI Sim] Initializing game ${gameId} with players: ${players.join(
          ", "
        )}.`
      );

      try {
        // Initialize the game state and get welcome messages
        const initialResponse = await runtime.initializeGame(players);
        console.debug("[AI Sim] Initial response:", initialResponse);
        messagePlayers(initialResponse, engine.outputQueue);
        gameLoop = createGameLoop(gameId, runtime, players, engine);
      } catch (error) {
        console.error(
          "[AI Sim] Error initializing game %d: %s",
          gameId,
          error instanceof Error ? error.message : "Unknown error"
        );
        engine.endGame(gameId);
        throw error;
      }
    },
    startGame: (gameId: number) => {
      console.info(`[AI Sim] Starting game ${gameId}.`);
      gameLoop();
    },
    getGeneralInstructions: () => {
      return gameDescription;
    },
    getSpecificInstructions: () => {
      return `This is a game for AI players.`;
    },
  } satisfies IModule;
};

const createGameLoop = (
  gameId: number,
  runtime: Runtime,
  players: string[],
  engine: IEngine
) => {
  let gameEnded = false;
  let playerAction: PlayerInput;

  const { inputQueue, outputQueue, endGame } = engine;

  return async () => {
    console.log("[AI Sim] Starting game loop for game %d.", gameId);
    try {
      while (!gameEnded) {
        // Listen for player input on queue
        await inputQueue.waitForAvailableMessage();
        const playerAction = inputQueue.dequeue();
        if (!playerAction) continue;
        // Invoke runtime with player input.  
        console.debug("[AI Sim] Processing player action:", playerAction);
        const response = await runtime.processPlayerAction(playerAction);
        gameEnded = response.gameEnded;

        // send messages to players
        messagePlayers(response, outputQueue);
      }

      // Handle game end
      console.log("[AI Sim] Game %d has ended.", gameId);
      endGame(gameId);
    } catch (error) {
      console.error(
        "[AI Sim] Error in game loop for game %d: %s",
        gameId,
        error instanceof Error ? error.message : "Unknown error"
      );
      endGame(gameId);
    }
  };
};

const messagePlayers = (
  response: RuntimeResponse, 
  outputQueue: PlayerMessageQueue
) => {
  // Send welcome messages to all players
  console.debug("[AI Sim] Sending messages to players:", response.playerMessages);
  for (const [playerId, message] of response.playerMessages.entries()) {
    if (message) {
      outputQueue.enqueue({ playerId, message });
    }
  }
}