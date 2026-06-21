import { addComponent, getComponent, set, World, WorldContext } from "#core/engine.js";
import { getMaxEntityCount } from '#core/EntitySizingConfig.js';
import { createComponentObserver } from "#core/helpers/componentHelpers.js";

const createPlayerScoreProps = () => ({
    /** Current player score */
    score: new Uint16Array(getMaxEntityCount() + 1),

    /** State when score was last updated */
    state: new Uint8Array(getMaxEntityCount() + 1),
    getName: () => "PlayerScore"
});

export const registerPlayerScore = (world: World<WorldContext>) => {
    world.components.PlayerScore = createPlayerScoreProps();

    // Add an observer so we can set the component data when adding.
    createComponentObserver(world, world.components.PlayerScore);
}

/**
 * Updates the player score
 * @param world 
 * @param playerId 
 * @param scoreChange The amount to add to (or subtract from if negative) the player's score.
 * @param state The state when the score was last updated.
 */
export const updatePlayerScore = (
    world: World<WorldContext>, 
    playerId: number, 
    scoreChange: number,
    state: number
) => {
    const currentScore = getComponent(world, playerId, world.components.PlayerScore)?.score[playerId] ?? 0;
    addComponent(
        world, 
        playerId, 
        set(world.components.PlayerScore, { score: currentScore + scoreChange, state })
    );
};

export const getPlayerScore = (world: World<WorldContext>, playerId: number): 
        number | undefined => {
    return getComponent(world, playerId, world.components.PlayerScore)?.score[playerId];
};

export const getPlayerScoreState = (world: World<WorldContext>, playerId: number): 
        number | undefined => {
    return getComponent(world, playerId, world.components.PlayerScore)?.state[playerId];
};