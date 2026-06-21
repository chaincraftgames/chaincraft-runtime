import { World, WorldContext } from "#core/engine.js";
import { getMaxEntityCount } from '#core/EntitySizingConfig.js';

const createGamepieceTypeProps = () => ({
    type: new Uint8Array(getMaxEntityCount() + 1),
    getType: () => "GamepieceType"
});

export const registerGamepieceType = (world: World<WorldContext>) => {
    world.components.GamepieceType = createGamepieceTypeProps();
}

export const setGamepieceType = (world: World<WorldContext>, gamepieceId: number, type: number) => {
    world.components.GamepieceType.type[gamepieceId] = type;
};

export const getGamepieceType = (world: World<WorldContext>, gamepieceId: number): number => {
    // Required component, so we can directly access.
    return world.components.GamepieceType.type[gamepieceId];
};