import { Logger } from '#chaincraft/logger.js';
import { EffectBus } from '#chaincraft/effects/effect-bus.js'
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
  orientationIndex?: number; // meaningful when type has orientationCount; range [0, orientationCount)
  exhausted: boolean;    // meaningful when type has exhaustible: true
  visibleTo: string[] | 'all' | null; // null = fall back to inventory default
  inventories?: Record<string, InventoryData>; // piece-scoped inventories
};

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------

export type PlayerState = {
  /** Role IDs currently held by this player. Managed by the engine; do not mutate directly. */
  roles: string[];
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

/**
 * Predicate function compiled from an infix condition expression.
 * Replaces JsonLogic for all flow conditions and player/piece filters.
 */
export type Predicate = (session: GameSession, actorId?: string) => boolean;

export type GameSession = {
  readonly gameId: string;
  readonly specId: string;
  readonly config: GameConfig;
  readonly state: GameState;
  readonly players: string[];
  readonly outbox: Message[];
  readonly rng: RngProvider;
  /** 
   * Effect bus for named-effect intercept (passives/reactives). 
   * Writable for testing only; production code should use the bus on the GameSession.
   */
  bus?: EffectBus;
  readonly logger?: Logger;
  /** Internal cache — do not access directly. Use getInventory(). */
  readonly _inventoryCache: Map<string, import('./inventory/Inventory.js').Inventory>;
};

export type Message = {
  /** Spec-level recipient intent: 'all', 'actor', 'opponents', 'role:<id>', or a player ID. */
  to: string;
  /**
   * Resolved list of player IDs who should receive this message. Set by the runtime
   * at effect execution time (where actor context is available). Hosts should use
   * this list for delivery rather than interpreting `to` themselves.
   */
  recipients: string[];
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

/**
 * Visibility for gamepiece properties. Mirrors PropertyVisibilitySchema in gamedef.
 *   always   — visible to all players regardless of face state (e.g. card-back set symbol)
 *   revealed — visible to all when the piece is face-up; hidden when face-down (e.g. card rank)
 *   owner    — visible only to the player who owns the piece
 *   never    — engine-tracked only; never shown to any player (e.g. internal flags)
 */
export type GamepiecePropertyVisibility = 'always' | 'revealed' | 'owner' | 'never';

/**
 * Visibility for player- and game-scoped state properties.
 *   public    — visible to all players (e.g. score, health)
 *   private   — visible only to the owning player (e.g. secret bid, hidden hand value)
 *   same-role — visible to players who share a role (e.g. team-scoped collaboration state)
 *   never     — engine-tracked only; never shown to any player
 */
export type StatePropertyVisibility = 'public' | 'private' | 'same-role' | 'never';

export type PropertyConfig = {
  mutable: boolean;
  min?: number;
  max?: number;
  enumValues?: string[];
  computed?: ComputedPropertyConfig;
  /** When set, set-state validates that written values are valid entity IDs of this kind. */
  refType?: RefType;
  /** For player/game properties. Defaults to 'public' if omitted. */
  visibility?: StatePropertyVisibility;
};

export type GamepiecePropertyConfig = {
  mutable: boolean;
  min?: number;
  max?: number;
  enumValues?: string[];
  /** Defaults to 'always' if omitted. */
  visibility?: GamepiecePropertyVisibility;
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
  properties: Record<string, GamepiecePropertyConfig>;
  hasFaceState?: boolean;
  exhaustible?: boolean;
  faceCount?: number;
  orientationCount?: number;
  inventorySlots?: string[];
};

export type RoleVisibility = 'public' | 'hidden';

export type GameConfig = {
  inventories: Record<string, InventoryConfig>;
  gamepieceTypes: Record<string, GamepieceTypeConfig>;
  gameProperties: Record<string, PropertyConfig>;
  playerProperties: Record<string, PropertyConfig>;
  playerCount: { min: number; max: number };
  /** Valid role IDs from the players module. Used to validate player-role-id ref writes. */
  roles?: string[];
  /** Visibility per role ID. Roles not listed default to 'public'. */
  roleVisibility?: Record<string, RoleVisibility>;
};

// ---------------------------------------------------------------------------
// Effect context (execution-time, not persisted)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EffectContext<T = any> = {
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
 * A simple (non-suspending) effect registration. Registered in
 * CompiledGameModule.effects for all deterministic effect kinds.
 */
export type EffectExecutor = {
  readonly kind: 'effect-executor';
  execute: (session: GameSession, ctx: EffectContext) => Promise<void>;
};

/**
 * Outbound payload for the first phase of a suspending effect.
 * The engine assigns the requestId; buildRequest provides only
 * the kind-specific content. The result is delivered back via
 * group.collected[requestId] before consume() is called.
 */
export type SuspensionRequest =
  | { kind: 'llm' }
  | { kind: 'external-data'; source: string; query: Record<string, unknown> };

/**
 * A two-phase effect registration for effects that require a system
 * round-trip (llm-effect, external-data).
 *
 * Phase 1 — buildRequest: assembles and emits the outbound request from
 * current state and inputs. The engine suspends and assigns a requestId.
 *
 * Phase 2 — consume: called once the system response arrives, with the
 * result delivered via EffectContext.actionInputs[requestId]. Applies
 * the result to session state deterministically.
 */
export type SuspendingEffectExecutor = {
  readonly kind: 'suspending-effect-executor';
  buildRequest(session: GameSession, ctx: EffectContext): SuspensionRequest;
  consume(session: GameSession, ctx: EffectContext, result: unknown): Promise<void>;
};

/**
 * Discriminated union of all effect registrations, keyed by effect kind
 * in CompiledGameModule.effects. Discriminant is the `kind` field.
 */
export type EffectRegistration = EffectExecutor | SuspendingEffectExecutor;

// ---------------------------------------------------------------------------
// Flow tree (mirrors gamedef flow module — compiled from YAML)
// ---------------------------------------------------------------------------

export type FlowNode =
  | GameFlowNode
  | TurnFlowNode
  | LoopFlowNode;

export type GameFlowNode = {
  kind: 'game';
  id: string;
  hooks?: FlowHooks;
  children: FlowNode[];
};

/**
 * How players are ordered and scheduled within a turn node.
 *
 * - round-robin: players act one at a time in seat/ranked/start order.
 *   `reversedPath` is a game state boolean path (default: 'game.property.turnOrderReversed')
 *   that flips direction when true — update it with the built-in `reverseTurnOrder` effect.
 * - simultaneous: all eligible players act at once (fork-join); outcomes hidden until join
 *   when `revealAtJoin` is true on the parent TurnFlowNode.
 * - single: one specific player acts, resolved from a state path or role.
 * - custom: escape hatch for game-specific resolver logic registered at startup.
 */
export type TurnOrdering =
  | {
      kind: 'round-robin';
      /** State path to the player ID who acts first. Defaults to session.players[0]. */
      startPath?: string;
      /**
       * State path to a boolean that reverses iteration direction when true.
       * Defaults to 'game.property.turnOrderReversed'.
       * Toggle with the built-in `reverseTurnOrder` effect.
       */
      reversedPath?: string;
      /** Restrict to players holding one of these role IDs. */
      roleIds?: string[];
      /** Sort eligible players by a property or inventory value before applying direction. */
      sort?: {
        by: { playerProperty: string } | { playerInventory: string };
        order: 'ascending' | 'descending';
      };
    }
  | { kind: 'simultaneous'; roleIds?: string[] }
  | {
      kind: 'single';
      actor: { kind: 'state-ref'; path: string } | { kind: 'roles'; roleIds: string[] };
    }
  | { kind: 'custom'; resolverId: string };

export type TurnFlowNode = {
  kind: 'turn';
  id: string;
  label: string;
  ordering: TurnOrdering;
  grammar: Grammar;
  /**
   * When true, effect outcomes are withheld from all players until every eligible
   * actor has completed their grammar (simultaneous reveal).
   * Only meaningful when ordering.kind is 'simultaneous'.
   */
  revealAtJoin?: boolean;
  hooks?: FlowHooks;
};

export type LoopFlowNode = {
  kind: 'loop';
  id: string;
  label: string;
  /**
   * Exit when this predicate returns true, checked after each full iteration
   * (all children processed).
   */
  endCondition?: Predicate;
  /**
   * Run exactly this many iterations then exit. Mutually exclusive with
   * endCondition; use count: 1 for a one-shot sequence of phases.
   */
  count?: number;
  /**
   * When true and endCondition fires mid-iteration, allow the current
   * iteration to complete before exiting.
   */
  finalRound?: boolean;
  /** Write the current iteration count to this game state path after each onEnter. */
  writeIterationTo?: string;
  hooks?: FlowHooks;
  children: FlowNode[];
};

export type FlowHooks = {
  onEnter?: EffectRef[];
  onComplete?: EffectRef[];
};

export type EffectRef = { ref: string } | Record<string, unknown>; // named ref or inline effect

// ---------------------------------------------------------------------------
// Grammar (player action patterns within a turn or simultaneous node)
// ---------------------------------------------------------------------------

export type Grammar =
  | ActionGrammar
  | ChoiceGrammar
  | SequenceGrammar
  | RepeatGrammar;

/** Player must take exactly this one action (no choice). */
export type ActionGrammar = {
  kind: 'action';
  ref: string; // action id
};

/**
 * Player picks one action from the listed set.
 * If passable is true, passing (taking no action) is also legal.
 */
export type ChoiceGrammar = {
  kind: 'choice';
  actions: string[]; // available action IDs
  passable?: boolean;
};

/** Player executes these actions in order (each is mandatory, no choice). */
export type SequenceGrammar = {
  kind: 'sequence';
  actions: string[];
};

/**
 * Player executes the body grammar repeatedly.
 * - Fixed count: repeat exactly N times.
 * - Range: repeat between min and max times. Pass becomes legal once repeatCount
 *   >= min; the body does not need to be passable — passing is a property of
 *   the count boundary, not the body.
 * - 'until-pass': repeat until the player elects to pass. Pass is always legal;
 *   again the body does not need to be passable.
 *   In a simultaneous node, the phase exits when ALL actors have passed.
 */
export type RepeatGrammar = {
  kind: 'repeat';
  /** Inner grammar to repeat each iteration. */
  body: Grammar;
  /** Repeat exactly N times, up to a range, or until player passes. */
  count: number | { min?: number; max?: number } | 'until-pass';
};

// ---------------------------------------------------------------------------
// Action definitions (compiled from spec actions module)
// ---------------------------------------------------------------------------

// --- Action input type variants (discriminated on `kind`) ---

export type NumberInputType = {
  readonly kind: 'number';
  readonly min?: number;
  readonly max?: number;
  /** If true, only whole numbers accepted. Defaults to true. */
  readonly integer?: boolean;
};

export type StringInputType = { readonly kind: 'string' };

export type BooleanInputType = { readonly kind: 'boolean' };

export type EnumInputType = {
  readonly kind: 'enum';
  readonly values: string[];
};

export type EffectOriginatorInputType = { readonly kind: 'effect-originator' };

export type TriggerInputType = {
  readonly kind: 'trigger-input';
  readonly inputId: string;
};

export type GamepieceSelectInputType = {
  readonly kind: 'gamepiece-select';
  readonly inventory: string;
  readonly ofType?: string;
  readonly count?: number;
  readonly fromPlayer?: 'self' | { param: string };
  readonly filter?: (session: GameSession, pieceId: string) => boolean;
};

export type PlayerSelectInputType = {
  readonly kind: 'player-select';
  readonly excludeSelf?: boolean;
  readonly filter?: (session: GameSession, playerId: string) => boolean;
};

export type InventoryPositionInputType = {
  readonly kind: 'inventory-position';
  readonly inventory: string;
  readonly fromPlayer?: 'self' | { param: string };
};

export type ActionInputType =
  | NumberInputType
  | StringInputType
  | BooleanInputType
  | EnumInputType
  | EffectOriginatorInputType
  | TriggerInputType
  | GamepieceSelectInputType
  | PlayerSelectInputType
  | InventoryPositionInputType;

export type ActionInputDef = {
  readonly id: string;
  readonly label?: string;
  readonly type: ActionInputType;
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

/** Information about the number of players a game supports. */
export interface PlayerCount { min: number; max: number };

export interface CompiledGameModule {
  readonly specId: string;
  readonly metadata: { name: string; playerCount: PlayerCount };

  /** Create a new GameSession for this spec with the given players. */
  createSession(gameId: string, players: string[]): GameSession;

  /** The flow tree to execute. */
  readonly flow: FlowNode;

  /** Effect executors — built-in + custom effects merged, keyed by effect kind. */
  readonly effects: Record<string, EffectRegistration>;

  /** Named effect definitions from the spec (for ref resolution), keyed by id. */
  readonly effectDefs: Record<string, Record<string, unknown>>;

  /** Action definitions, keyed by action id. */
  readonly actions: Record<string, ActionDef>;
};
