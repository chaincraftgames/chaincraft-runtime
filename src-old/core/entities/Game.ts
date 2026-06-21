import { addEntity, World, WorldContext } from "#core/engine.js";

/**
 * Keep track of all the games and associated worlds
 */
const games: Map<number, World> = new Map();

export const createGameEntity = (world: World<WorldContext>) => {
    const gameId = addEntity(world);
    games.set(gameId, world);

    return gameId;
}

export const getGameWorld = (gameId: number): World | undefined => {
    return games.get(gameId);
}