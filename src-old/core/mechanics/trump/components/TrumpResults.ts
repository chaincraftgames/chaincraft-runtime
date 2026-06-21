import { addComponent, getComponent, set, World, WorldContext } from "#core/engine.js";
import { getMaxEntityCount } from '#core/EntitySizingConfig.js';
import { createComponentObserver } from "#core/helpers/componentHelpers.js";

const createTrumpResultsProps = () => ({
    rank: new Uint8Array(getMaxEntityCount() + 1),
    getName: () => "TrumpResults"
});

export interface TrumpResultsParams {
    rank: number;
}

export const registerTrumpResults = (world: World<WorldContext>) => {
    world.components.TrumpResults = createTrumpResultsProps();

    // Add an observer so we can set the component data when adding.
    createComponentObserver(world, world.components.TrumpResults);
}

export const setTrumpResults = (world: World<WorldContext>, gamepieceId: number, rank: number) => {
    // addComponent is idempotent, so we don't need to check if it already exists.
    addComponent(world, gamepieceId, set(world.components.TrumpResults, { rank }));
};

export const getTrumpResults = (
    world: World<WorldContext>, 
    gamepieceId: number
): number | undefined => {
    return getComponent(world, gamepieceId, world.components.TrumpResults)?.rank[gamepieceId];
};