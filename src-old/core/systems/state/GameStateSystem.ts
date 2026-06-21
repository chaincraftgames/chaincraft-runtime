import {
  World,
  WorldContext,
  getGameState,
  setGameState,
  getComponent,
  updateCompletion,
  getBaseState,
} from "#core/engine.js";

type W = World<WorldContext>;

export const GAME_STATE_INIT = 0;
export const GAME_STATE_END = 2 ** 32 - 1;

interface Transition<T extends W> {
  from: number;
  to: number;
  when?: (world: W) => boolean;
  execute?: (world: W) => void;
}

export interface FixedRepeat {
  times: number;
}

export interface VariableRepeat<T extends W> {
  until: (world: T) => boolean;
}

type Repeat<T extends W> = FixedRepeat | VariableRepeat<T>;

export interface RepeatTransition<
  T extends W, 
  R extends Repeat<T> = FixedRepeat | VariableRepeat<T>
> extends Transition<T> {
  repeat: R;
  transitions: TransitionConfig<T>[];
}

export type TransitionConfig<T extends W> = Transition<T> | RepeatTransition<T>;

// Type guards
const isRepeatTransition = <T extends W>(
  transition: TransitionConfig<T>
): transition is RepeatTransition<T> => {
  return "repeat" in transition;
};

const isFixedRepeat = <T extends W>(
  transition: Repeat<T>
): transition is FixedRepeat => {
  return "times" in transition;
};

const isVariableRepeat = <T extends W>(
  transition: Repeat<T>
): transition is VariableRepeat<T> => {
  return "until" in transition;
};

type TransitionProviderResult<T extends W> = { value: Transition<T> | null, done: boolean };
type TransitionProviderOptions = { reset?: boolean };
type TransitionGenerator<T extends W> = Generator< 
  TransitionProviderResult<T>, 
  void,
  TransitionProviderOptions
>;

interface TransitionProvider<T extends W> {
  nextTriggeredTransition(options?: { reset?: boolean }): TransitionProviderResult<T>;
  triggered: boolean;
}

const shouldTriggerTransition = <T extends W>(
  world: W, 
  transition: Transition<T>
): boolean => {
  const baseState = getBaseState(getGameState(world));
  return baseState === transition.from && 
    (transition.when?.(world) ?? true);
}

class SimpleTransitionProvider<T extends W> implements TransitionProvider<T> {
  triggered = false;
  
  constructor(
    private transition: Transition<T>,
    private world: T
  ) {}

  nextTriggeredTransition(): TransitionProviderResult<T> {
    // Simply check current state and condition
    if (shouldTriggerTransition(this.world, this.transition)) {
      // this.triggered = true;
      const result = { value: this.transition, done: false };
      // this.triggered = false;  // One-shot transitions immediately untrigger
      return result;
    }
    console.debug('[GameStateSystem] - Failed to match transition %d -> %d game base state: %d', this.transition.from, this.transition.to, getBaseState(getGameState(this.world)));
    return { value: null, done: false };
  }
}

// New provider to manage collections of transitions
class TransitionsProvider<T extends W> implements TransitionProvider<T> {
  triggered = false;
  needsReset = false;
  private providers: TransitionProvider<T>[];  // Now private implementation detail

  constructor(
    transitions: TransitionConfig<T>[],
    private world: T
  ) {
    this.providers = transitions.map(t => 
      isRepeatTransition(t) 
        ? new RepeatTransitionProvider(t, world)
        : new SimpleTransitionProvider(t, world)
    );
  }

  nextTriggeredTransition(options?: { reset?: boolean }): TransitionProviderResult<T> {
    if (options?.reset) {
      this.needsReset = true;
    }
    
    let hasTriggeredProviders = false;

    // First check triggered providers.
    // console.log('Checking triggered providers...');
    for (const provider of this.providers) {
      if (provider.triggered) {
        console.debug('[GameStateSystem] Found triggered provider:', provider instanceof RepeatTransitionProvider ? 'RepeatTransitionProvider' : 'SimpleTransitionProvider');
        const result = provider.nextTriggeredTransition({ reset: this.needsReset });
        console.log('Triggered provider returned:', result);
        if (result.value) {
          hasTriggeredProviders = !result.done;
          return result;
        }
      }
    }

    // If we had triggered providers, but none found a valid transition, 
    // wait for next iteration.
    if (hasTriggeredProviders) {
      console.log('Had triggered providers but no valid transitions');
      return { value: null, done: false };
    }

    // Then check untriggered in config order.
    // console.log('Checking untriggered providers...');
    for (const provider of this.providers) {
      if (!provider.triggered) {
        const result = provider.nextTriggeredTransition({ reset: this.needsReset });
        console.log('Untriggered provider returned:', result);
        if (result.value) {
          return result;
        }
      }
    }
        
    return { value: null, done: false };
  }
}

class RepeatTransitionProvider<T extends W> implements TransitionProvider<T> {
  triggered = false;
  private generator: TransitionGenerator<T>;
  private transitionsProvider: TransitionsProvider<T>;

  constructor(
    private repeat: RepeatTransition<T>,
    private world: T
  ) {
    this.transitionsProvider = new TransitionsProvider(repeat.transitions, world);
    this.generator = isFixedRepeat(repeat.repeat)
      ? createFixedRepeatGenerator(
        repeat as RepeatTransition<T, FixedRepeat>, 
        this.transitionsProvider
      )
      : createVariableRepeatGenerator(
        world, 
        repeat as RepeatTransition<T, VariableRepeat<T>>,
        this.transitionsProvider
      );
  }

  nextTriggeredTransition(options: { reset?: boolean }): TransitionProviderResult<T> {
    // First check if this repeat transition should trigger
    if (!this.triggered) {
      if (shouldTriggerTransition(this.world, this.repeat)) {
        console.log('[GameStateSystem] - Repeat transition triggered %d -> %d', this.repeat.from, this.repeat.to);
        this.triggered = true;
        return { value: this.repeat, done: false };
      } else {
        return { value: null, done: false };
      }
    }

    // Only delegate to generator if we're triggered
    const value = this.generator.next(options).value as TransitionProviderResult<T>;
    // console.debug('[GameStateSystem] - Repeat transition generator returned:', value);
    if (value.done) {
      console.debug('[GameStateSystem] RepeatTransitionProvider done, setting triggered to false for %d -> %d', this.repeat.from, this.repeat.to);
      this.triggered = false;
    }
    return value as TransitionProviderResult<T>;  // Safe cast since our generators never return void
  }
}

// Keep all existing repeat generator implementations
function createFixedRepeatGenerator<T extends W>(
  repeatTransition: RepeatTransition<T, FixedRepeat>,
  provider: TransitionProvider<T>
): TransitionGenerator<T> {
  let iterations = 0;
  let needsReset = false;

  function* generator(): TransitionGenerator<T> {
    let options: TransitionProviderOptions | undefined;
    
    while (true) {      
      if (options?.reset) {
        console.debug('[GameStateSystem] - Resetting fixed repeat transition %d -> %d', repeatTransition.from, repeatTransition.to);
        iterations = 0;
        needsReset = true;
      }

      const result = provider.nextTriggeredTransition({ reset: needsReset });
      needsReset = false;

      if (!result.value) {
        options = yield { value: null, done: false };
        continue;
      }

      const transition = result.value;
      
      if (transition.to === repeatTransition.to) {
        if (iterations + 1 >= repeatTransition.repeat.times) {
          options = yield { value: transition, done: true };
        } else {
          iterations++;
          needsReset = true;
          options = yield { value: transition, done: false };
        }
      } else {
        options = yield { value: transition, done: false };
      }
    }
  }

  return generator();
}

function createVariableRepeatGenerator<T extends W>(
  world: T,
  repeatTransition: RepeatTransition<T, VariableRepeat<T>>,
  provider: TransitionProvider<T>
): TransitionGenerator<T> {
  let needsReset = false;

  function* generator(): TransitionGenerator<T> {
    let options: TransitionProviderOptions | undefined;
    
    while (true) {
      if (options?.reset) {
        needsReset = true;
      }

      const result = provider.nextTriggeredTransition({ reset: needsReset });
      needsReset = false;

      if (!result.value) {
        options = yield { value: null, done: false };
        continue;
      }

      const transition = result.value;
      if (transition.to === repeatTransition.to) {
        if (repeatTransition.repeat.until(world)) {
          // Done - this is our last transition
          options = yield { value: transition, done: true };
        } else {
          // Not done - reset for next iteration
          needsReset = true;
          options = yield { value: transition, done: false };
        }
      } else {
        options = yield { value: transition, done: false };
      }
    }
  }

  return generator();
}

export const createGameStateSystem = <T extends W>(world: T, config: TransitionConfig<T>[]) => {
  const provider = new TransitionsProvider(config, world);
  const stateGenerations: Map<number, number> = new Map();

  const generateStateId = (state: number): number => {
    const generation = (stateGenerations.get(state) ?? 0) + 1;
    stateGenerations.set(state, generation);
    return state * 100 + generation;
  };
  
  const system = () => {
    console.log('[GameStateSystem] - execute. Current base state:', getBaseState(getGameState(world)));
    const result = provider.nextTriggeredTransition();
    const transition = result.value;
    if (transition) {
      console.log('[GameStateSystem] Transitioning from %d to %d', transition.from, transition.to);
      setGameState(world, generateStateId(transition.to));
      transition.execute?.(world);
    } else {
      console.log('[GameStateSystem] No transition found for current state.  State unchanged.');
    }
  };

  world.systems.GameState = system;
  return system;
};


