import { World, WorldContext, addComponent, getComponent, hasComponent } from "#core/engine.js";
import { getMaxEntityCount } from '#core/EntitySizingConfig.js';

const createGamepieceOwnerProps = () => ({
    owner: new Uint8Array(getMaxEntityCount() + 1),
    getName: () => "GamepieceOwner",
});

export const registerGamepieceOwner = (world: World<WorldContext>) => {
    world.components.GamepieceOwner = createGamepieceOwnerProps();
}

export const setGamepieceOwner = (
    world: World<WorldContext>, 
    gamepieceId: number, 
    owner: number) => {
    // addComponent is idempotent, so we don't need to check if it already exists.
    addComponent(world, gamepieceId, world.components.GamepieceOwner);
    world.components.GamepieceOwner.owner[gamepieceId] = owner;
};

export const getGamepieceOwner = (
    world: World<WorldContext>, 
    gamepieceId: number
): number | undefined => {
    return getComponent(world, gamepieceId, world.components.GamepieceOwner)?.owner[gamepieceId];
};