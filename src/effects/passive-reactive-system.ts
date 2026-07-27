/** 
 * This system allows for the registry of passive and reactive effects, and triggering
 * of those effects in response to events emitted by the game engine.
 * 
 * Passive effects are triggered automatically in response to events, and can modify
 * the game state or trigger other effects. 
 * 
 * Reactive opportunities are triggered in response to events, and allow players to 
 * choose whether to respond with a reactive effect.
 * 
 * The system is designed to be extensible, allowing for new types of passive and reactive
 * effects to be added as needed.
 */

import { EffectExecutor } from "#chaincraft/types.js";
import { PassiveTrigger } from "./effect-bus.js";



type PassiveWithTrigger = {
  trigger: PassiveTrigger;
  effectExecutor: EffectExecutor;
};

type ReactiveWithTrigger = {
  trigger: string;
  effectDef: any;
};

const registeredPassives: 