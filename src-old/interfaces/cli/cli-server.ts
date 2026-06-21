import { WebSocketServer, WebSocket as WS } from "ws";
import * as gameEngine from "../../core/GameEngine.js";
import {
  MessageType,
  CreateGameMessage,
  CreateAiGameMessage,
  JoinGameMessage,
  GameCreatedMessage,
  GameJoinedMessage,
  GameEventMessage,
  PlayerMessage,
  PlayerActionMessage,
} from "./cli-messages.js";
// import { getAiGameDescription as getAiGameDecriptionUsingRegistry } from '#ai-sim/aiGameRegistry.js';
import {
  createPlayerInputQueue,
  createPlayerMessageQueue,
  PlayerInputQueue,
  PlayerMessageQueue,
} from "#core/messaging/MessageQueues.js";
import { getIpfsFile } from "#utils/ipfs.js";

const wss = new WebSocketServer({ port: 8080 });

const clients = new Map<string, WS>();
const gamePlayers = new Map<number, Set<string>>();
const gameQueues = new Map<
  number,
  {
    inputQueue: PlayerInputQueue;
    outputQueue: PlayerMessageQueue;
  }
>();

type CreateGameOptions = {
  playerId: string;
} & (
  | {
      type: "module";
      moduleName: string;
    }
  | {
      type: "ai";
      ipfsHash: string;
    }
);

wss.on("connection", (ws: WS) => {
  ws.on("message", async (message) => {
    const parsedMessage = JSON.parse(message.toString()) as
      | CreateGameMessage
      | CreateAiGameMessage
      | JoinGameMessage
      | PlayerActionMessage;
    const playerId = parsedMessage.playerId;
    clients.set(playerId, ws);

    switch (parsedMessage.type) {
      case MessageType.CreateGame:
      case MessageType.CreateAiGame: {
        const config: CreateGameOptions =
          parsedMessage.type === MessageType.CreateGame
            ? {
                type: "module",
                moduleName: parsedMessage.moduleName,
                playerId: parsedMessage.playerId,
              }
            : {
                type: "ai",
                ipfsHash: parsedMessage.ipfsHash,
                playerId: parsedMessage.playerId,
              };

        try {
          const gameId = await createGame(config);
          const gameCreatedMessage: GameCreatedMessage = {
            type: MessageType.GameCreated,
            gameId,
          };
          ws.send(JSON.stringify(gameCreatedMessage));
          listenForMessages(gameId);
        } catch (error) {
          console.error("Error creating game:", error);
          ws.close();
        }
        break;
      }
      case MessageType.JoinGame: {
        const gameId = parsedMessage.gameId;
        const players = await joinGame(gameId, playerId);
        const gameJoinedMessage: GameJoinedMessage = {
          type: MessageType.GameJoined,
          gameId: parsedMessage.gameId,
          players,
        };
        ws.send(JSON.stringify(gameJoinedMessage));
        break;
      }
      case MessageType.PlayerAction: {
        console.debug(
          "[CLI Server] Received player %s action: %s",
          parsedMessage.playerId,
          parsedMessage.action
        );
        const queues = gameQueues.get(parsedMessage.gameId);
        queues?.inputQueue.enqueue({
          playerId: parsedMessage.playerId,
          input: parsedMessage.action,
        });
        break;
      }
      default:
        console.error(
          "[CLI Server] Unhandled message type:",
          (parsedMessage as any).type
        );
        break;
    }
  });
});

wss.on("error", (error) => {
  if ((error as any).code === "EADDRINUSE") {
    console.error(
      "Error: Port 8080 is already in use. Please ensure no other server is running on this port."
    );
  } else {
    console.error("WebSocket Server Error:", error);
  }
  process.exit(1);
});

async function listenForMessages(gameId: number) {
  const queues = gameQueues.get(gameId);
  if (!queues) return;

  const queue = queues.outputQueue;
  if (!queue) return;

  while (true) {
    try {
      console.debug("[CLI Server] Waiting for message for game %d...", gameId);
      await queue.waitForAvailableMessage();
      const playerMessage = queue.dequeue();
      if (!playerMessage) continue;
      const { playerId, message } = playerMessage;
      const ws = clients.get(playerId);
      if (!ws) continue;
      const messageToPlayer: PlayerMessage = {
        type: MessageType.PlayerMessage,
        message,
      };
      ws.send(JSON.stringify(messageToPlayer));
    } catch (error) {
      console.error("Error in message loop:", error);
      break;
    }
  }
}

async function createGame(options: CreateGameOptions): Promise<number> {
  const messageQueues = {
    inputQueue: createPlayerInputQueue(),
    outputQueue: createPlayerMessageQueue(),
  };

  let gameId: number;
  if (options.type === "module") {
    gameId = await gameEngine.createGameUsingModule(
      options.moduleName,
      [options.playerId],
      messageQueues
    );
  } else {
    const ipfsContents = (await getIpfsFile(options.ipfsHash)) as any;
    if (!ipfsContents || !ipfsContents["game_description"]) {
      throw new Error("Game description not found in IPFS");
    }
    gameId = await gameEngine.createGameUsingAI(
      ipfsContents["game_description"],
      [options.playerId],
      messageQueues
    );
  }

  gameQueues.set(gameId, messageQueues);
  gamePlayers.set(gameId, new Set([options.playerId]));
  registerGameEvents(gameId);

  return gameId;
}

function joinGame(gameId: number, playerId: string) {
  const players = gameEngine.joinGame(gameId, playerId);
  gamePlayers.get(gameId)?.add(playerId);
  return players;
}

function registerGameEvents(gameId: number) {
  gameEngine.subscribeToGameEvents(gameId, async (gameId, event, data) => {
    const players = gamePlayers.get(gameId);
    if (players) {
      // Events should be delivered last to ensure all other messages are processed first
      queueMicrotask(async () => {
        const gameEventMessage: GameEventMessage = {
          type: MessageType.GameEvent,
          event,
          data,
        };
        console.debug("[CLI Server] Sending game event:", gameEventMessage);
        const message = JSON.stringify(gameEventMessage);
        players.forEach((playerId) => {
          clients.get(playerId)?.send(message);
        });

        if (event === gameEngine.GameEvent.GameReady) {
          const message = await gameEngine.getGameInstructions(gameId);
          const gameInstructionsMessage: PlayerMessage = {
            type: MessageType.PlayerMessage,
            message,
          };
          const instructionsMessage = JSON.stringify(gameInstructionsMessage);
          players.forEach((playerId) => {
            clients.get(playerId)?.send(instructionsMessage);
          });

          gameEngine.startGame(gameId);
        }
      });
    }
  });
}

console.log("WebSocket server is running on ws://localhost:8080");
