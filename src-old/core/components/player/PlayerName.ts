import { World, WorldContext } from "#core/engine.js";
import { getMaxEntityCount } from '#core/EntitySizingConfig.js';

const createPlayerNameProps = () => ({
    name: new Uint8Array(getMaxEntityCount() + 1),
    namesList: new Array<string>()
});

export const registerPlayerName = (world: World<WorldContext>) => {
    world.components.PlayerName = createPlayerNameProps();
}

export const setPlayerName = (world: World<WorldContext>, playerId: number, name: string) => {
    world.components.PlayerName.namesList.push(name);
    world.components.PlayerName.name[playerId] = world.components.PlayerName.namesList.length - 1;
};

export const getPlayerName = (world: World<WorldContext>, playerId: number): string | undefined => {
    // Player name is required, so we can directly access.
    return world.components.PlayerName.namesList[world.components.PlayerName.name[playerId]];
};