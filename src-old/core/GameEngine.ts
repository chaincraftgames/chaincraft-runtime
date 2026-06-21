import path from 'path';
import fs from 'fs';

import { IModule, IEngine } from '#core/IModule.js';
import { createAiGameModule } from '#ai-sim/index.js';
import { PlayerInputQueue, PlayerMessageQueue } from './messaging/MessageQueues.js';

const loadedModules: Map<string, IModule> = new Map();

const pendingGames: Map<number, { module: IModule, players: string[], engine: IEngine }> = new Map();
const inProgressGames: Map<number, { module: IModule, players: string[], engine: IEngine }> = new Map();

type EventCallback = (gameId: number, event: GameEvent, data?: any) => void;

const eventSubscribers: Map<number, EventCallback[]> = new Map();

export enum GameEvent {
  GameCreated = 'gameCreated',
  GameStarted = 'gameStarted',
  PlayerJoined = 'playerJoined',
  PlayerLeft = 'playerLeft',
  GameEnded = 'gameEnded',
  GameReady = "GameReady"
}
export interface GameMessageQueues {
  inputQueue: PlayerInputQueue;
  outputQueue: PlayerMessageQueue;
}

export async function loadModule(moduleName: string): Promise<any> {
    if (loadedModules.has(moduleName)) {
       return loadedModules.get(moduleName) as IModule;
    }

    try {
      // Load module from local file (initially)
      const moduleUrl = new URL(`../../modules/dist/${moduleName}/index.js`, import.meta.url);
      const module = await import(moduleUrl.toString()) as IModule;
      loadedModules.set(moduleName, module);
      return module;
    } catch (error: any) {
      throw new Error(`Failed to load module: ${moduleName}.  Error message: ${error.message}`);
    }

    // Load module from CDN (future)
    // const moduleUrl = `https://cdn.example.com/modules/${moduleName}.js`;
    // try {
    //   const response = await axios.get(moduleUrl);
    //   const module = eval(response.data); // Be cautious with eval in production
    //   this.modules[moduleName] = module;
    //   return module;
    // } catch (error) {
    //   throw new Error(`Failed to load module: ${moduleName}`);
    // }
}

/** 
 * This function creates a new game with the specified players.  It gets the max player 
 * count from the module and if the number of players is equal to the player count, it
 * initializes the game state.  If it is less than the max player count, it registers
 * a pending game and returns an id that can be used to join the game.  If it is greater
 * than the max player count, it returns an error message.
 */
export async function createGameUsingModule(
  moduleName: string, 
  players: string[], 
  messageQueues: GameMessageQueues
): Promise<number> {
  const module = await loadModule(moduleName);
  if (!module) {
    throw new Error(`Module not found: ${moduleName}`);
  }
  return await createGame(module, players, messageQueues);
}

export async function createGameUsingAI(
  gameDescription: string,
  players: string[],
  messageQueues: GameMessageQueues,
) {
  const module = await createAiGameModule(gameDescription);

  return await createGame(module, players, messageQueues);
}

/** 
 * Join a pending game that is waiting for players. 
 * If the game is found, the player is added to the game.  If the number of players
 * is equal to the max player count, the game is initialized and the pending game is
 * removed.  If the number of players is less than the max player count, the player
 * is added to the game and a message is sent to the subscribers that a player has
 * joined the game.
 * @param gameId The id of the game to join.
 * @param playerName The name of the player joining the game.
 * @returns An array of strings that represent the players in the game.
 */
export async function joinGame(gameId: number, playerName: string): Promise<string[]> {
  if (pendingGames.has(gameId)) {
    const { module, players, engine } = pendingGames.get(gameId)!;
    players.push(playerName);
    notifySubscribers(gameId, GameEvent.PlayerJoined, { playerName });
    if (players.length === module.maxPlayers) {
        await module.initializeGame(gameId, players, engine);
        inProgressGames.set(gameId, { module, players, engine });
        pendingGames.delete(gameId);
        notifySubscribers(gameId, GameEvent.GameReady);
    } else {
      console.info(`Waiting for ${module.maxPlayers - players.length} more players to join game ${gameId}.`);
    }
    console.info("Player %s joined game %s.", playerName, gameId);
    return players;
  } else {
    throw new Error(`Game ${gameId} not found.`);
  }
}

export function startGame(gameId: number) {
  inProgressGames.get(gameId)?.module.startGame(gameId);
}

export function subscribeToGameEvents(gameId: number, callback: EventCallback): void {
  if (!eventSubscribers.has(gameId)) {
    eventSubscribers.set(gameId, []);
  }
  eventSubscribers.get(gameId)!.push(callback);
}

export async function getGameInstructions(gameId: number): Promise<string> {
  const game = inProgressGames.get(gameId);
  if (game) {
    return `Game Instructions: ${game.module.getGeneralInstructions()}`;
  } else {
    throw new Error(`Game ${gameId} not found.`);
  }
}

async function createGame(
  module: IModule,
  players: string[], 
  messageQueues: GameMessageQueues
): Promise<number> {
  const maxPlayers = module.maxPlayers;
  if (players.length > maxPlayers) {
    throw new Error(`Too many players (${players.length}) for game ${module.name}.`);
  }
  
  const gameId = await module.createGame();

  console.info(`Creating game ${gameId} with players: ${players.join(', ')}.`);
  const engine: IEngine = {
    inputQueue: messageQueues.inputQueue,
    outputQueue: messageQueues.outputQueue,
    endGame
  };
  if (players.length === maxPlayers) {
    await module.initializeGame(gameId, players, engine);
    notifySubscribers(gameId, GameEvent.GameReady);
  } else {
    console.info(`Waiting for ${maxPlayers - players.length} more players to join game ${gameId}.`); 
    pendingGames.set(gameId, { 
      module, 
      players, 
      engine
    });
    notifySubscribers(gameId, GameEvent.GameCreated);
  }
  return gameId;
} 

function notifySubscribers(gameId: number, event: GameEvent, data?: any): void {
  if (eventSubscribers.has(gameId)) {
    queueMicrotask(() => {
      for (const callback of eventSubscribers.get(gameId)!) {
        callback(gameId, event, data);
      }
    });
  }
}

function endGame(gameId: number) {
  console.debug('[GameEngine] Ending game %d.', gameId);
  const game = inProgressGames.get(gameId);
  if (game) {
    inProgressGames.delete(gameId);

    // Notify subscribers and clear
    notifySubscribers(gameId, GameEvent.GameEnded);

    // Cleanup after all events have been processed
    queueMicrotask(() => {
      // Clear subscribers for this game
      eventSubscribers.delete(gameId);

      // Clear queues
      // game.engine.inputQueues.forEach(queue => queue.clear());
      // game.engine.outputQueues.forEach(queue => queue.clear());
    });

    
  }
}

