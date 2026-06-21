export enum MessageType {
  CreateGame = 'create',
  CreateAiGame = 'createAi',
  JoinGame = 'join',
  GameCreated = 'gameCreated',
  GameJoined = 'gameJoined',
  MessagePlayer = 'messagePlayer',
  GameEvent = 'gameEvent',
  PlayerMessage = 'playerMessage',
  PlayerAction = 'playerAction',
}

export interface Message {
  type: MessageType;
  [key: string]: any;
}

export interface CreateGameMessage extends Message {
  type: MessageType.CreateGame;
  moduleName: string;
  playerId: string;
}

export interface CreateAiGameMessage extends Message {
  type: MessageType.CreateAiGame;
  ipfsHash: string;
  playerId: string;
}

export interface JoinGameMessage extends Message {
  type: MessageType.JoinGame;
  playerId: string;
  gameId: number;
}

export interface GameCreatedMessage extends Message {
  type: MessageType.GameCreated;
  gameId: number;
}

export interface GameJoinedMessage extends Message {
  type: MessageType.GameJoined;
  gameId: number;
  players: string[];
}

export interface GameEventMessage extends Message {
  type: MessageType.GameEvent;
  event: string;
}

export interface PlayerMessage extends Message {
  type: MessageType.PlayerMessage;
  message: string;
}

export interface PlayerActionMessage extends Message {
  type: MessageType.PlayerAction;
  playerId: string;
  action: string;
}
