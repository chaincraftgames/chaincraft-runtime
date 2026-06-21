import { Runnable, RunnableSequence } from "@langchain/core/runnables";
import { StructuredOutputParser } from "langchain/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { buildStateSchema } from "#ai-sim/schemaBuilder.js";
import { getModel } from "#ai-sim/model.js";
import { Client } from "langsmith";

let processingChain: Runnable | undefined;

const analysisTemplate = `
  You are a game design expert analyzing requirements for a text-based game.
  Your task is to analyze the game description and explain:

  1. What core game state needs to be tracked? Consider:
     - Game phases (setup, playing, finished)
     - Turn/round management
     - Victory conditions
     - Shared resources or board state

  2. What player-specific state is needed? Think about:
     - What actions players can take
     - What resources or attributes they maintain
     - How their progress is tracked
     - How their current status is represented

  3. How should this state be structured for optimal updates during gameplay?
     - What fields belong at the game level vs player level
     - What types should each field be
     - Which fields are required vs optional

  Game Description:
  {gameDescription}

  Provide your analysis as a clear explanation of the state structure needed.
`;

const schemaTemplate = `
  Using the following game analysis, create a formal state schema that follows this nested structure:

  Top Level Fields:
  1. gameState - Contains all game-level state fields
  2. players - Defines the structure for individual player states

  Important Nesting Rules:
  - Game state fields must be nested under the gameState object
  - Player state fields must be nested under the players object
  - Use items.properties to define the structure of nested objects
  - Do not use dot notation (e.g. "gameState.phase")

  Example Schema Structure:
  {{
    "fields": [
      {{
        "name": "gameState",
        "type": "object",
        "description": "Core game state tracking",
        "required": true,
        "items": {{
          "type": "object",
          "properties": {{
            "phase": {{
              "name": "phase",
              "type": "string",
              "description": "Current game phase",
              "required": true
            }},
            "currentRound": {{
              "name": "currentRound",
              "type": "number",
              "description": "Current round number",
              "required": true
            }}
          }}
        }}
      }},
      {{
        "name": "players",
        "type": "object",
        "description": "Player state tracking",
        "required": true,
        "items": {{
          "type": "object",
          "properties": {{
            "status": {{
              "name": "status",
              "type": "string",
              "description": "Player's current status",
              "required": true
            }},
            "score": {{
              "name": "score",
              "type": "number",
              "description": "Player's current score",
              "required": true
            }}
          }}
        }}
      }}
    ]
  }}

  Analysis:
  {analysis}

  {formattingInstructions}

  Requirements:
  1. Follow the exact nesting structure shown in the example
  2. Include complete descriptions for all fields
  3. Mark fields as required or optional appropriately
  4. Use null for uninitialized values
`;

const processingTemplate = `
  You are assisting an AI in simulating the gameplay for a text-based game.  Your task is to extract
  from the game description the information needed to create a game instance.  This information includes:
    - The game name
    - The maximum number of players
    - The game state object that includes:
      1. Core game state (phases, turns, rounds)
      2. Player-specific state tracking
      3. Game-specific data structures
      4. Any counters, flags, or status tracking needed
      5. State needed for victory condition evaluation
    - The state schema that defines the structure of the game state object

  The state structure should be the minimum information needed to:
    - Initialize a new game
    - Process player actions
    - Track game progression
    - Determine game completion
      - Support all game rules

  Make sure the state only includes things that can change during the game and not things that are 
  fixed for the game, such as game rules.

  For example, given the game description:  Rock, Paper, Scissors played over 3 rounds by 2 players.
  Your state object should include:
    - The current round
    - The ids of the players
    - The current score for each player
    - The choices made by each player in the current round

  Please review the game description and extract the necessary information to create a game instance.
  {gameDescription}

  {formattingInstructions}

  Requirements:
  1. All fields must be present and properly typed
  2. State must support the entire game lifecycle
  3. Include only the JSON response, no additional text
  4. Use null for uninitialized values, not undefined
`;

export type GameDefinition = {
  name: string;
  maxPlayers: number;
  stateSchema: z.ZodSchema;
};

export const processGameDescription = async (
  gameDescription: string
): Promise<GameDefinition> => {
  await initialize();

  const response = await processingChain?.invoke({ gameDescription });
  console.log("[processGameDescription] response: %o", response);
  const schema = buildStateSchema(response.stateSchema.fields);
  return {
    name: response.gameName,
    maxPlayers: response.maxPlayers,
    stateSchema: schema,
  }
};

const initialize = async () => {
  if (processingChain) {
    return;
  }

  // const prompt = ChatPromptTemplate.fromTemplate(processingTemplate);
  const analysisPrompt = ChatPromptTemplate.fromTemplate(analysisTemplate);
  const schemaPrompt = ChatPromptTemplate.fromTemplate(schemaTemplate);

  const responseSchema = z.object({
    gameName: z
      .string()
      .describe(
        "A short, descriptive name for the game that clearly identifies it"
      ),
    maxPlayers: z
      .number()
      .describe("The exact number of players required/supported by the game"),
    state: z.object({
      gameState: z.record(z.any())
          .describe(`Game-level state containing all shared game progress fields such as:
              - Current phase (setup, playing, finished)
              - Round/turn tracking
              - Victory conditions
              - Shared resources or board state
              Do not include player-specific state here.`),
      players: z.record(z.any())
          .describe(`Map of player IDs to player state objects. Should contain all player specific state such as:
            - Current status in the game
            - Score or progress tracking
            - Current choices or actions
            - Inventories or resources
            - Any other player-specific state`)
    }), 
    stateSchema: z.object({
      fields: z.array(
        z.object({
          name: z.string(),
          type: z.enum(["string", "number", "boolean", "array", "object"]),
          description: z.string(),
          required: z.boolean(),
          items: z.object({
            type: z.string(),
            properties: z.record(
              z.object({
                name: z.string(),
                type: z.enum(["string", "number", "boolean", "array", "object"]),
                description: z.string(),
                required: z.boolean(),
                items: z.object({
                  type: z.string(),
                  properties: z.record(z.any()),
                }).optional(),
              })
            ),
          }).optional(),
        })
      )
      .describe("Schema definition that matches the nested structure of the state object")
    })
  });

  const parser = StructuredOutputParser.fromZodSchema(responseSchema);

  const model = await getModel();

  // const partialChain = await prompt.partial({
  //   formattingInstructions: parser.getFormatInstructions(),
  // });

  // processingChain = partialChain.pipe(model).pipe(parser);
  const partialSchemaChain = await schemaPrompt.partial({
    formattingInstructions: parser.getFormatInstructions(),
  });

  processingChain = RunnableSequence.from([
    // First get the analysis
    {
      analysis: analysisPrompt.pipe(model),
    },
    // Transform the output into schema prompt input
    {
      analysis: (input) => input.analysis.content,
    },
    // Generate and parse schema
    partialSchemaChain,
    model,
    parser
  ]);
};
