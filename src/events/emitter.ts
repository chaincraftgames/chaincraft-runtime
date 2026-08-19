// ---------------------------------------------------------------------------
// GameEventEmitter — lightweight typed observable for runtime game events.
//
// Always present on GameSession. Zero-cost when no listeners are attached
// (emit() short-circuits). Consumers subscribe by kind or wildcard.
// ---------------------------------------------------------------------------

import type { EffectContext, Message } from "#chaincraft/types.js";
import type {
  GameOutcome,
  PlayerInputSuspension,
} from "#chaincraft/orchestration/types.js";

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export type GameEvent =
  | GameInitEvent
  | GameCompleteEvent
  | FlowEnterEvent
  | FlowPhaseEvent
  | FlowExitEvent
  | EffectExecuteEvent
  | InputPromptEvent
  | InputResolveEvent
  | MessageEmitEvent;

/** An event emitted when a game is initialized. */
export interface GameInitEvent {
  kind: "game:init";
  gameId: string;
  players: string[];
}

/** An event emitted when a game is completed. */
export interface GameCompleteEvent {
  kind: "game:complete";
  outcome: GameOutcome;
}

/** An event emitted when a flow node is entered. */
export interface FlowEnterEvent {
  kind: "flow:enter";
  nodeId: string;
  nodeType: string;
}

/** An event emitted when a flow node phase is entered. */
export interface FlowPhaseEvent {
  kind: "flow:phase";
  nodeId: string;
  phase: string;
}

/** An event emitted when a flow node is exited. */
export interface FlowExitEvent {
  kind: "flow:exit";
  nodeId: string;
}

/** An event emitted when an effect is executed. */
export interface EffectExecuteEvent {
  kind: "effect:execute";
  effectId: string;
  effectKind: string;
  context: EffectContext;
}

/** An event emitted when a player is prompted for input. */
export interface InputPromptEvent {
  kind: "input:prompt";
  playerId: string;
  suspension: PlayerInputSuspension;
}

/** An event emitted when a player resolves an input prompt. */
export interface InputResolveEvent {
  kind: "input:resolve";
  playerId: string;
  value: unknown;
}

/** An event emitted when a message is emitted. */
export interface MessageEmitEvent {
  kind: "message:emit";
  message: Message;
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

/**
 * A lightweight typed observable for runtime game events.
 */
type Listener = (event: GameEvent) => void;

/** The event emitter for runtime game events. */
export class GameEventEmitter {
  /** The sequence number of the last emitted event. */
  private seq = 0;

  /** Listeners that are subscribed to all events. */
  private readonly wildcardListeners: Listener[] = [];

  /** Listeners that are subscribed to specific event kinds. */
  private readonly kindListeners = new Map<string, Listener[]>();

  /** 
   * Emit an event. No-op if no listeners are attached, or if the game module
   * opts out of event emission. 
   */
  emit(event: GameEvent): void {
    if (this.wildcardListeners.length === 0 && this.kindListeners.size === 0)
      return;
    this.seq++;
    // Wildcard listeners
    for (const listener of this.wildcardListeners) {
      listener(event);
    }
    // Kind-specific listeners
    const kindList = this.kindListeners.get(event.kind);
    if (kindList) {
      for (const listener of kindList) {
        listener(event);
      }
    }
  }

  /** Subscribe to all events. Returns unsubscribe function. */
  on(listener: Listener): () => void;
  /** Subscribe to a specific event kind. Returns unsubscribe function. */
  on(kind: string, listener: Listener): () => void;
  on(kindOrListener: string | Listener, maybeListener?: Listener): () => void {
    if (typeof kindOrListener === "function") {
      this.wildcardListeners.push(kindOrListener);
      return () => {
        const idx = this.wildcardListeners.indexOf(kindOrListener);
        if (idx >= 0) this.wildcardListeners.splice(idx, 1);
      };
    }
    const kind = kindOrListener;
    const listener = maybeListener!;
    let list = this.kindListeners.get(kind);
    if (!list) {
      list = [];
      this.kindListeners.set(kind, list);
    }
    list.push(listener);
    return () => {
      const idx = list!.indexOf(listener);
      if (idx >= 0) list!.splice(idx, 1);
      if (list!.length === 0) this.kindListeners.delete(kind);
    };
  }

  /** Current sequence number (total events emitted). */
  get eventCount(): number {
    return this.seq;
  }
}
