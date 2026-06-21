import { World, WorldContext } from "#core/engine.js";
import { getMaxEntityCount } from "#core/EntitySizingConfig.js";

const enum ActiveValues {
    INACTIVE = 0,
    ACTIVE = 1
}

const createPlayerStateProps = () => ({
    active: new Uint8Array(getMaxEntityCount() + 1),
});

export const registerPlayerState = (world: World<WorldContext>) => {
    world.components.PlayerState = createPlayerStateProps();
}

export const setActive = (world: World<WorldContext>, playerId: number) => {
    world.components.PlayerState.active[playerId] = ActiveValues.ACTIVE;
}

export const setInactive = (world: World<WorldContext>, playerId: number) => {
    world.components.PlayerState.active[playerId] = ActiveValues.INACTIVE;
}

export const getActive = (world: World<WorldContext>, playerId: number): boolean => {
    // Required component, so we can directly access.
    return world.components.PlayerState.active[playerId] === ActiveValues.ACTIVE;
}