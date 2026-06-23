// ---------------------------------------------------------------------------
// Entity reference types
// ---------------------------------------------------------------------------

/**
 * The kind of entity a ref-typed property references.
 * Matches the gamedef PropertyTypeSchema entity-ref kinds directly.
 */
export type RefType = 'player-id' | 'player-role-id' | 'gamepiece-id';

/**
 * Branded string types for entity IDs — plain strings at runtime,
 * but TypeScript-distinguishable so resolver return types carry intent.
 */
declare const __playerIdBrand: unique symbol;
export type PlayerId = string & { readonly [__playerIdBrand]: void };

declare const __playerRoleIdBrand: unique symbol;
export type PlayerRoleId = string & { readonly [__playerRoleIdBrand]: void };

declare const __gamepieceIdBrand: unique symbol;
export type GamepieceId = string & { readonly [__gamepieceIdBrand]: void };

// ---------------------------------------------------------------------------
// Inventory data (serializable state)
// ---------------------------------------------------------------------------

export type InventoryStructure = 'none' | 'stack' | 'line' | 'grid' | 'graph';

export type BagInventoryData = {
  structure: 'none';
  pieceIds: string[];
};

export type StackInventoryData = {
  structure: 'stack';
  pieceIds: string[];
};

export type LineInventoryData = {
  structure: 'line';
  slots: (string | null)[];
};

export type GridInventoryData = {
  structure: 'grid';
  cells: Record<string, string | null>; // key: "row:col"
};

export type GraphInventoryData = {
  structure: 'graph';
  nodes: Record<string, string | null>; // key: nodeId
};

export type InventoryData =
  | BagInventoryData
  | StackInventoryData
  | LineInventoryData
  | GridInventoryData
  | GraphInventoryData;

// ---------------------------------------------------------------------------
// Inventory placement (for add/move-to operations)
// ---------------------------------------------------------------------------

export type InventoryPlacement =
  | { kind: 'stack-top' }
  | { kind: 'stack-bottom' }
  | { kind: 'line-index'; index: number }
  | { kind: 'grid-cell'; row: string | number; col: string | number }
  | { kind: 'graph-node'; nodeId: string };

// ---------------------------------------------------------------------------
// Selection mode (for query operations — what the Inventory interface uses)
// 'player-chooses' is handled by the flow runner / IO adapter layer, not here.
// ---------------------------------------------------------------------------

export type SelectionMode = 'top' | 'bottom' | 'random' | 'all' | { id: string };

// ---------------------------------------------------------------------------
// Gamepiece
// ---------------------------------------------------------------------------

export type Gamepiece = {
  typeId: string;
  ownerId: string;
  properties: Record<string, unknown>;
  faceUp: boolean;       // meaningful when type has hasFaceState: true
  faceValue?: number;    // meaningful when type has faceCount (dice); range [1, faceCount]
  exhausted: boolean;    // meaningful when type has exhaustible: true
  visibleTo: string[] | 'all' | null; // null = fall back to inventory default
  inventories?: Record<string, InventoryData>; // piece-scoped inventories
};

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------

export type PlayerState = {
  properties: Record<string, unknown>;
  inventories: Record<string, InventoryData>;
};

// ---------------------------------------------------------------------------
// Game state (fully serializable — snapshot / on-chain commit target)
// ---------------------------------------------------------------------------

export type GameState = {
  gameProperties: Record<string, unknown>;
  gameInventories: Record<string, InventoryData>;
  players: Record<string, PlayerState>;
  gamepieces: Record<string, Gamepiece>;
};

// ---------------------------------------------------------------------------
// Branded base interfaces for generated typed state projections
//
// The compiler emits per-game interfaces extending these bases so that
// getGameState<T>, getPlayerState<T>, getPieceState<T> reject accidental
// misuse with unrelated types. The brand field is never set at runtime —
// it exists only to make the structural type system treat these as nominal.
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;

/** Base for generated game-scoped state interfaces (e.g., RPSGameState). */
export interface GameStateBase {
  readonly [__brand]?: 'GameState';
}

/** Base for generated player-scoped state interfaces (e.g., RPSPlayerState). */
export interface PlayerStateBase {
  readonly [__brand]?: 'PlayerState';
}

/** Base for generated piece-scoped state interfaces (e.g., WeaponProperties). */
export interface GamepieceStateBase {
  readonly [__brand]?: 'GamepieceState';
}

// ---------------------------------------------------------------------------
// RNG provider — pluggable entropy source for verifiable fairness
//
// The runtime never calls Math.random() directly. All randomness flows
// through an RngProvider injected into the GameSession at creation.
//
// Environments:
//   - Dev/test:   seeded PRNG (deterministic replays, reproducible tests)
//   - Production: commit-reveal or hash-chain backed provider
//   - On-chain:   replay with revealed seed — same PRNG, same outputs
//
// Effect executors (set-random, shuffle, distribute with random select)
// call nextFloat() and apply their distribution logic on top.
// ---------------------------------------------------------------------------

export interface RngProvider {
  /** Returns a uniformly distributed float in [0, 1). */
  nextFloat(): number;
}

// ---------------------------------------------------------------------------
// GameSession — the live state container for one running game
//
// Holds all mutable state for a single game instance. Effect executors,
// the flow runner, and mechanic resolvers receive this as their handle.
// The typed state accessors below operate on the untyped Records inside
// this container, projecting them through the generated interfaces.
// ---------------------------------------------------------------------------

export type GameSession = {
  readonly gameId: string;
  readonly specId: string;
  readonly config: GameConfig;
  readonly state: GameState;
  readonly players: string[];
  readonly outbox: Message[];
  readonly rng: RngProvider;
  /** Internal cache — do not access directly. Use getInventory(). */
  readonly _inventoryCache: Map<string, import('./inventory/Inventory.js').Inventory>;
};

export type Message = {
  /** Recipient: 'all', 'actor', 'opponents', 'role:<id>', or a specific player ID.
   * Broadcast targets ('all', 'opponents', 'role:<id>') are visible to all matched players.
   * Point targets ('actor', player ID) are private to that player only.
   */
  to: string;
  content: string;
};

// ---------------------------------------------------------------------------
// Typed state accessors — see state/accessors.ts for implementations.
//
// Generated code uses these to read/write state with compile-time safety.
// At runtime the implementations validate mutability, min/max, enum
// membership, and throw StateAccessError for the LLM repair loop.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Game config (immutable, derived from spec at init time)
// ---------------------------------------------------------------------------

export type InventoryConfig = {
  structure: InventoryStructure;
  scope: 'game' | 'player' | 'team' | 'piece';
  visibility: 'always' | 'revealed' | 'owner' | 'count-only' | 'never';
  accepts: string[];
  capacity?: { min?: number; max?: number };
  gridDimensions?: { rows: number; columns: number };
  role?: string;
};

export type PropertyConfig = {
  mutable: boolean;
  min?: number;
  max?: number;
  enumValues?: string[];
  computed?: ComputedPropertyConfig;
  /** When set, set-state validates that written values are valid entity IDs of this kind. */
  refType?: RefType;
};

/**
 * Configuration for a computed (derived) property. When present on a
 * PropertyConfig, the property is read-only and its value is evaluated
 * lazily from inventory/piece state on every read.
 */
export type ComputedPropertyConfig = {
  inventory: string;
  ofType?: string;
  property?: string;
  aggregate: 'count' | 'exists' | 'sum' | 'min' | 'max';
};

export type GamepieceTypeConfig = {
  category: 'card' | 'token' | 'dice' | 'tile' | 'board';
  properties: Record<string, PropertyConfig>;
  hasFaceState?: boolean;
  exhaustible?: boolean;
  faceCount?: number;
  orientationCount?: number;
  inventorySlots?: string[];
};

export type GameConfig = {
  inventories: Record<string, InventoryConfig>;
  gamepieceTypes: Record<string, GamepieceTypeConfig>;
  gameProperties: Record<string, PropertyConfig>;
  playerProperties: Record<string, PropertyConfig>;
  playerCount: { min: number; max: number };
  /** Valid role IDs from the players module. Used to validate player-role-id ref writes. */
  roles?: string[];
};

// ---------------------------------------------------------------------------
// Effect context (execution-time, not persisted)
// ---------------------------------------------------------------------------

export type EffectContext<T = Record<string, unknown>> = {
  /** The player whose turn/action triggered this effect chain (null for game-level effects). */
  actorId: string | null;
  /** The player this effect iteration is currently targeting (set by executors that resolve PlayerTarget). */
  targetPlayerId?: string;
  /** Action inputs from player submission, keyed by input id. */
  actionInputs: Record<string, unknown>;
  /** Resolved effect definition from the spec (the YAML node). */
  effectDef: T;
};

/**
 * An effect executor is an async function that mutates the session.
 * One per effect `kind`. Registered in the CompiledGameModule's effect map.
 */
export type EffectExecutor = (
  session: GameSession,
  ctx: EffectContext,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Flow tree (mirrors gamedef flow module — compiled from YAML)
// ---------------------------------------------------------------------------

export type FlowNode =
  | GameFlowNode
  | SimultaneousFlowNode
  | LoopFlowNode;

export type GameFlowNode = {
  kind: 'game';
  hooks?: FlowHooks;
  children: FlowNode[];
};

export type SimultaneousFlowNode = {
  kind: 'simultaneous';
  id: string;
  label: string;
  actor: 'all-players';
  grammar: Grammar;
  hooks?: FlowHooks;
};

export type LoopFlowNode = {
  kind: 'loop';
  id: string;
  label: string;
  endCondition: Record<string, unknown>; // JsonLogic expression
  writeIterationTo?: string;             // state dot-path
  hooks?: FlowHooks;
  children: FlowNode[];
};

export type FlowHooks = {
  onEnter?: EffectRef[];
  onComplete?: EffectRef[];
};

export type EffectRef = { ref: string } | Record<string, unknown>; // named ref or inline effect

// ---------------------------------------------------------------------------
// Grammar (player action patterns within a flow node)
// ---------------------------------------------------------------------------

export type Grammar =
  | ActionGrammar
  | RepeatGrammar;

export type ActionGrammar = {
  kind: 'action';
  ref: string; // action id
};

export type RepeatGrammar = {
  kind: 'repeat';
  count: number;
  body: Grammar;
};

// ---------------------------------------------------------------------------
// Action definitions (compiled from spec actions module)
// ---------------------------------------------------------------------------

export type ActionInputDef = {
  readonly id: string;
  readonly label: string;
  readonly type: { kind: string; values?: string[] };
  readonly validation?: string;
};

export type ActionDef = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly inputs: ActionInputDef[];
  readonly effects: EffectRef[];
};

// ---------------------------------------------------------------------------
// Compiled game module — what the deterministic compiler produces
//
// One per game spec. The server loads this to run game sessions.
// Mechanic types are imported from their own modules (e.g. mechanics/trump).
// ---------------------------------------------------------------------------

import type { TrumpMechanic } from '#chaincraft/mechanics/trump/types.js';

export type CompiledGameModule = {
  readonly specId: string;
  readonly metadata: { name: string; playerCount: { min: number; max: number } };

  /** Create a new GameSession for this spec with the given players. */
  createSession(gameId: string, players: string[]): GameSession;

  /** The flow tree to execute. */
  readonly flow: FlowNode;

  /** Effect executors — built-in + custom effects merged, keyed by effect id. */
  readonly effects: Record<string, EffectExecutor>;

  /** Named effect definitions from the spec (for ref resolution), keyed by id. */
  readonly effectDefs: Record<string, Record<string, unknown>>;

  /** Mechanic instances (each mechanic module defines its own type). */
  readonly trumpMechanics: TrumpMechanic[];

  /** Action definitions, keyed by action id. */
  readonly actions: Record<string, ActionDef>;
};
