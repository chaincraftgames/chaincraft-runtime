import { addComponent, getComponent, set, World, WorldContext } from "#core/engine.js";
import { getMaxEntityCount } from '#core/EntitySizingConfig.js';
import { createComponentObserver } from "#core/helpers/componentHelpers.js";

const createPlayerMessageProps = () => ({
    message: new Uint8Array(getMaxEntityCount() + 1),
    getName: () => "PlayerMessage"
});

export interface PlayerMessageParams {
    message?: number;
}

export const registerPlayerMessage = (world: World<WorldContext>) => {
    world.components.PlayerMessage = createPlayerMessageProps();

    // Add an observer so we can set the component data when adding.
    createComponentObserver(world, world.components.PlayerMessage);
}

export const addPlayerMessage = (world: World<WorldContext>, playerId: number, messageId: number) => {
    // addComponent is idempotent, so we don't need to check if it already exists.
    addComponent(world, playerId, set(world.components.PlayerMessage, { message: messageId }));
};

export const getPlayerMessage = (
    world: World<WorldContext>, 
    playerId: number
): number | undefined => {
    return getComponent(world, playerId, world.components.PlayerMessage)?.message[playerId];
};