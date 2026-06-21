import { getComponent, World, WorldContext } from "#core/engine.js";
import { getMaxEntityCount } from '#core/EntitySizingConfig.js';

const createTurnOrderProps = () => ({
    turnOrder: new Uint8Array(getMaxEntityCount() + 1)
});

export const registerTurnOrder = (world: World<WorldContext>) => {
    world.components.TurnOrder = createTurnOrderProps();
}

export const setTurnOrder = (world: World<WorldContext>, playerId: number, turnOrder: number) => {
    world.components.TurnOrder.turnOrder[playerId] = turnOrder;
};

export const getTurnOrder = (world: World<WorldContext>, playerId: number): number | undefined => {
    return getComponent(world, playerId, world.components.TurnOrder)?.turnOrder[playerId];
};