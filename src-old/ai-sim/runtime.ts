import { Runnable } from "@langchain/core/runnables";
import { StructuredOutputParser } from "langchain/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z, ZodObject, ZodSchema } from "zod";
import { getModel } from "./model.js";
import { PlayerInput } from "#core/messaging/MessageQueues.js";

const initializationTemplate = `
  You are an AI simulation expert tasked with initializing a text-based game simulation.
  You will set up the initial game state and provide welcome messages and initial instructions 
  to all players.

  The description of the game is as follows:
  <game_description>
  {gameDescription}
  </game_description>

  The players participating in the game are:
  <players>
  {players}
  </players>

  The schema for the game state is as follows:
  <schema>
  {game_state_schema}
  </schema>

  Perform an analysis of the game description and player information to set up the game state
  according to the provided schema and provide the necessary instructions.  Conduct your analysis 
  inside a <game_analysis> tag.

  <game_analysis>
  1. Looking at the properties in the schema and the game description, list out starting values
     for each player and the game state.
  2. List out messages to send to the players including:
      - Welcome messages
      - The starting game state
      - Initial instructions and the actions that are valid for the players to take
        at game start.
      - Any input needed from the players to start the game.
  </game_analysis>

  Based on the analysis, initialize the game state and provide welcome messages including 
  initial instructions according to the following format:
  {formattingInstructions}
`;

const runtimeTemplate = `
  You are an AI game master responsible for processing and updating an EXISTING game state based on incoming player actions. You do NOT initialize new games - you only process actions within an ongoing game session. Your task is to:
  1. Process the incoming player action against the current game state
  2. Update the game state accordingly
  3. Generate appropriate messages for all players

  Here is the game description:
  <game_description>
  {gameDescription}
  </game_description>

  Here is the current game state:
  <game_state>
  {gameState}
  </game_state>

  Here is the action taken by a player:
  <player_action>
  {playerAction}
  </player_action>

  You MUST think carefully about the current state of the game and the player action 
  and perform a thorough analysis of the situation. Conduct your analysis inside 
  <game_analysis> tags.

  <game_analysis>
  Current State Analysis
  1. Break down the current game state, listing key information for each player.
  2. List all possible valid actions for each player in the current state.
  3. Analyze the player's action:
    - Is it valid? If not, explain why.
    - How does it affect the current round and overall game state?
  4. Write out the exact updates needed for the game state based on the player action.
  5.  List the messages that should be sent to each player based on the state updates, including
      - Informing players of their opponents actions.  IMPORTANT - never reveal the specific 
        actions of other players unless the game rules specify that the player action is public (
        e.g. by specifying that a card is played face up or a player choice is shown to other players).
      - Updates to the game state.
      - The valid actions and/or input required from each player.
  6. Check for any special game conditions or rules that might apply in the current situation.
  7. For each player, write down their current score and status, numbering each player as you go.
  8. If any player has made an illegal move, note how many illegal moves they've made so far.

  Next State Analysis
  1.  Determine if the player action should result in a transition to another phase or round.
  2.  List the required updates to the state, including:
      - Advancing to the next round if the current round is complete
      - Incrementing the round number
      - Updating the game phase
      - Resetting any temporary state for the game or players (such as actions or choices)
  3.  List the messages that should be sent to the players 
      - Informing the player that the next round, phase, etc... has begun 
      - Inform players of the legal actions and request their choice for the next round 

  End Game Analysis
  1.  Determine if the player action completes the final round, phase, etc... of the game
  2.  If end game is warranted, tally final scores.
  3.  If end game is warranted, list the messages that should be sent to the players
      - Informing players that the game has ended
      - Informing the players of the final results of the game

  Final Analysis
  1.  List out the combined state taking into account Current State Analysis, Next State Analysis, and End Game Analysis
  2.  List out the combined messages to each player taking into account Current State Analysis, Next State Analysis, and End Game Analysis
  </game_analysis>

  After your analysis, follow these steps:

  1. Process the player action and update the game state according to the Final Analysis.  Include all messages to players identified in the final analysis.

  2. If the action completes a round:
    a. Resolve the round (determine the winner)
    b. Update scores
    c. Clear player choices
    d. Advance to the next round or end the game if all rounds are complete

  3. Provide messages for all players. These messages must include:
    - What happened (results of the action and/or round)
    - What to do next (instructions for the next action or round)
    - Specific options or choices available to the player

  4. Format your response as a JSON object that adheres to the provided schema.  
  CRITICAL: Provide ALL state updates and messages in a SINGLE JSON response.

  Important Rules:
  - If a player makes an invalid move, remind them of the rules and valid actions.
  - Track illegal action count (reset on legal action).
  - End the game after 3 illegal actions or if a player attempts to circumvent the rules.
  - When the game ends, set the gameEnded flag to true and provide final results to all 
    players.
  - Always include clear instructions for the next possible actions in player messages to 
    ensure the game doesn't get stuck.
  - If the current round is complete, update the state to reflect that we are in the next 
    round within the same execution.
  
  Provide updated game state and player messages according to the following format:
  {formattingInstructions}
  
  Remember to process all updates and messaging in your single response, and ensure that 
  your output is a valid JSON object according to the provided schema. Always include 
  clear instructions for the next possible actions in player messages to keep the game 
  moving forward.
`;

const runtimeGameStateSchemaExtension = z.object({
  gameEnded: z.boolean().default(false),
});

const runtimePlayerStateSchemaExtension = z.object({
  illegalActionCount: z.number().default(0),
  messageToPlayer: z.string().optional(),
});

interface BaseRuntimeState {
  gameState: {
    gameEnded: boolean;
  };
  players: Record<string, RuntimePlayerState>;
}

interface RuntimePlayerState {
  illegalActionCount: number;
  messageToPlayer?: string;
}

export interface Runtime {
  initializeGame: (players: string[]) => Promise<RuntimeResponse>;
  processPlayerAction: (playerAction: PlayerInput) => Promise<RuntimeResponse>;
}

// Custom error types for better error handling
export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

export class ValidationError extends RuntimeError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// Update RuntimeResponse to be more specific
export interface RuntimeResponse {
  gameEnded: boolean;
  playerMessages: Map<string, string | undefined>;
}

export const initializeRuntime = async (
  gameDescription: string,
  stateSchema: ZodSchema
): Promise<Runtime> => {
  // Ensure we're working with an object schema
  if (!(stateSchema instanceof z.ZodObject)) {
    throw new Error("State schema must be an object schema");
  }

  const initializationPrompt = ChatPromptTemplate.fromTemplate(
    initializationTemplate
  );
  const runtimePrompt = ChatPromptTemplate.fromTemplate(runtimeTemplate);

  const schema = extendSchema(stateSchema);
  type GameState = z.infer<typeof schema> & BaseRuntimeState;
  const parser = new StructuredOutputParser(schema);
  const model = await getModel();

  const partialInitializationChain = await initializationPrompt.partial({
    gameDescription,
    formattingInstructions: parser.getFormatInstructions(),
  });

  const initializationChain = partialInitializationChain
    .pipe(model)
    .pipe(parser);

  const partialRuntimeChain = await runtimePrompt.partial({
    gameDescription,
    formattingInstructions: parser.getFormatInstructions(),
  });

  const runtimeChain = partialRuntimeChain.pipe(model).pipe(parser);

  let currentState: GameState = {
    gameState: {
      gameEnded: false,
    },
    players: {},
  };

  return {
    initializeGame: async (players: string[]): Promise<RuntimeResponse> => {
      try {
        const response = await initializationChain.invoke({
          game_state_schema: schema,
          players,
        });

        // Validate response against schema
        currentState = schema.parse(response) as GameState;
        const playerMessages = extractPlayerMessages(currentState);

        return {
          playerMessages,
          gameEnded: currentState.gameState?.gameEnded ?? false,
        };
      } catch (error) {
        handleError("Error initializing game", error);
        return Promise.reject(error);
      }
    },

    processPlayerAction: async (
      playerAction: PlayerInput
    ): Promise<RuntimeResponse> => {
      try {
        const response = await runtimeChain.invoke({
          playerAction: playerAction,
          gameState: currentState,
        });

        // Validate response against schema
        currentState = schema.parse(response) as GameState;

        const playerMessages = extractPlayerMessages(currentState);

        return {
          playerMessages,
          gameEnded: currentState.gameState?.gameEnded ?? false,
        };
      } catch (error) {
        handleError(`Error processing action ${playerAction}`, error);
        return Promise.reject(error);
      }
    },
  };
};

const extendSchema = (schema: ZodObject<any>) => {
  // Get the value type of the players record
  const playerSchema =
    schema.shape.players instanceof z.ZodRecord
      ? schema.shape.players.valueSchema
      : schema.shape.players;

  const extendedSchema = z.object({
    gameState: runtimeGameStateSchemaExtension.merge(schema.shape.gameState),
    players: z.record(runtimePlayerStateSchemaExtension.merge(playerSchema)),
  });

  return schema.merge(extendedSchema);
};

/**
 * Get the player messages from the state.  Note this will remove the messages after
 * they are retrieved.
 * @param currentState
 * @returns
 */
const extractPlayerMessages = (currentState: BaseRuntimeState) => {
  const playerMessages = new Map<string, string>();
  for (const [playerId, playerData] of Object.entries(
    currentState.players as Record<string, RuntimePlayerState>
  )) {
    const playerMessage = playerData?.messageToPlayer;
    if (playerMessage) {
      playerMessages.set(playerId, playerMessage);
      // Remove the message to keep it from confusing the AI on the next turn
      playerData.messageToPlayer = undefined;
    }

    
  }
  return playerMessages;
};

const handleError = (message: string, error: unknown): never => {
if (error instanceof z.ZodError) {
    throw new ValidationError(`Invalid game state: ${error.message}`);
  }
  throw new RuntimeError(
    `${message}: ${
      error instanceof Error ? error.message : "Unknown error"
    }`
  );
}
