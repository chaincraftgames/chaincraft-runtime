import { Runnable } from "@langchain/core/runnables";
import { StructuredOutputParser } from "langchain/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { buildStateSchema } from "#ai-sim/schemaBuilder.js";
import { getModel } from "#ai-sim/model.js";

let processingChain: Runnable | undefined;

const processingTemplate = `
  You are a game design expert analyzing requirements for a text-based game.
  Your task is to:
  1. Analyze the game requirements
  2. Define the state structure
  3. Provide a formal schema

  Think through these aspects:
  1. Core game state:
     - Game phases (setup, playing, finished)
     - Turn/round management
     - Victory conditions
     - Shared resources or board state

  2. Player-specific state:
     - What actions players can take
     - What resources or attributes they maintain
     - How their progress is tracked
     - How their current status is represented

  3. State structure:
     - Fields at game level vs player level
     - Required types and validation
     - Optional vs required fields

  Include your analysis in the response JSON under the "analysis" field,
  then provide the formal schema following this structure:

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

  Game Description:
  {gameDescription}

  {formattingInstructions}

  Requirements:
  1. Include your analysis in the analysis field
  2. Follow the exact schema structure shown
  3. All fields must be properly typed
  4. Use null for uninitialized values
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

  const prompt = ChatPromptTemplate.fromTemplate(processingTemplate);

  const responseSchema = z.object({
    gameName: z
      .string()
      .describe(
        "A short, descriptive name for the game that clearly identifies it"
      ),
    maxPlayers: z
      .number()
      .describe("The exact number of players required/supported by the game"),
    analysis: z
      .string()
      .describe("Your analysis of the game state requirements and structure"),
    state: z.object({
      gameState: z.record(z.any())
          .describe(`Game-level state containing all shared game progress fields`),
      players: z.record(z.any())
          .describe(`Map of player IDs to player state objects`)
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

  const partialChain = await prompt.partial({
    formattingInstructions: parser.getFormatInstructions(),
  });

  processingChain = partialChain.pipe(model).pipe(parser);
};
