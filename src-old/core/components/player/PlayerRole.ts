import { World, WorldContext } from "#core/engine.js";
import { getMaxEntityCount } from '#core/EntitySizingConfig.js';

const createPlayerRoleProps = () => ({
    role: new Uint8Array(getMaxEntityCount() + 1)
});

export const registerPlayerRole = (world: World<WorldContext>) => {
    world.components.PlayerRole = createPlayerRoleProps();
}

export const setPlayerRole = (world: World<WorldContext>, playerId: number, role: number) => {
    world.components.PlayerRole.role[playerId] = role;
};

export const getPlayerRole = (world: World<WorldContext>, playerId: number): number => {
    // Required component, so we can directly access.
    return world.components.PlayerRole.role[playerId];
};
