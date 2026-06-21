import WebSocket from 'ws';
import readline from 'readline';
import { 
  MessageType, 
  CreateGameMessage, 
  JoinGameMessage, 
  GameCreatedMessage, 
  GameJoinedMessage, 
  GameEventMessage,
  PlayerMessage,
  CreateAiGameMessage,
} from './cli-messages.js';

let localPlayerId: string;
let gameId: number;
let gameStarted = false;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ws = new WebSocket('ws://localhost:8080');

// Handle player input continuously
function startInputLoop() {
  // console.log('\nEnter commands at any time:');
  rl.prompt();

  rl.on('line', (input) => {
    console.debug(colors.red('[CLI Client] Received input: %s'), input);
    if (gameStarted) {
      const message = {
        type: MessageType.PlayerAction,
        gameId,
        playerId: localPlayerId,
        action: input
      };
      console.debug(colors.red('[CLI Client] Sending player %s action: %s'), message.playerId, message.action);
      ws.send(JSON.stringify(message));
    }
    rl.prompt();
  });
}

// Add color helper functions
const colors = {
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`
};

ws.on('open', () => {
  rl.question(colors.cyan('Enter your player ID: '), (playerId) => {
    localPlayerId = playerId;
    rl.question(colors.cyan('Would you like to (c)reate a game, create an (a)i game or (j)oin a game?'), (answer) => {
      if (answer === 'c') {
        rl.question(colors.cyan('Enter the module name: '), (moduleName) => {
          const createGameMessage: CreateGameMessage = { 
            type: MessageType.CreateGame, 
            moduleName,
            playerId 
          };
          ws.send(JSON.stringify(createGameMessage));
        });
      } else if (answer === 'a') {
        rl.question(colors.cyan('Enter the ipfs hash for the PAIT: '), (ipfsHash) => {
          const createGameMessage: CreateAiGameMessage = { 
            type: MessageType.CreateAiGame, 
            ipfsHash,
            playerId,
          };
          ws.send(JSON.stringify(createGameMessage));
          console.log(colors.yellow('AI is creating game.  Please wait...'));
        });
      } else if (answer === 'j') {
        rl.question(colors.cyan('Enter the game ID: '), (gameId: string) => {
          const joinGameMessage: JoinGameMessage = { 
            type: MessageType.JoinGame, 
            playerId, 
            gameId: parseInt(gameId) 
          };
          ws.send(JSON.stringify(joinGameMessage));
          startInputLoop();
        });
      }
    });
  });
});

ws.on('message', (message) => {
  const parsedMessage = JSON.parse(message.toString()) as 
    GameCreatedMessage | 
    GameJoinedMessage | 
    GameEventMessage | 
    PlayerMessage;

  if (parsedMessage.type === MessageType.GameCreated) {
    gameId = parsedMessage.gameId;
    console.log(colors.green(`Game created with ID: ${gameId}. Waiting for players to join...`));
    startInputLoop();
  } else if (parsedMessage.type === MessageType.GameJoined) {
    gameId = parsedMessage.gameId;
    console.log(colors.green(`Game joined. Players in game: ${parsedMessage.players.join(', ')}. Waiting for game to start...\n`));
  } else if (parsedMessage.type === MessageType.GameEvent) {
    const { event, data } = parsedMessage;
    switch (event) {
      case "playerJoined":
        if (data.playerName !== localPlayerId) {
          console.log(colors.green(`\nPlayer ${data.playerName} has joined the game.`));
        }
        break;
      case "gameReady":
        console.log(colors.green('\nStarting the game...'));
        break;
      case "gameEnded":
        console.log(colors.green('\nThanks for playing!'));
        rl.close();
        process.exit(0);
        break;
    }
    rl.prompt();
  } else if (parsedMessage.type === MessageType.PlayerMessage) {
    console.log(colors.cyan(`\n${parsedMessage.message}`));
    gameStarted = true;
    rl.prompt();
  }
});

ws.on('close', () => {
  console.log(colors.green('Thanks for playing!'));
  process.exit(0);
});