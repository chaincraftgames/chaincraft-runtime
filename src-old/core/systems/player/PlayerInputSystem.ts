import { World, WorldContext, query } from '#core/engine.js';
import { getPlayerName } from '#core/components/player/PlayerName.js';
import { getActive } from '#core/components/player/PlayerState.js';

export type InputMapping<T extends World<WorldContext>> = {
    pattern: RegExp | string;
    action: (world: T, playerId: number, match?: RegExpMatchArray) => void;
}

export const createPlayerInputSystem = <T extends World<WorldContext>>(world: T, mappings: InputMapping<T>[]) => {
    const processInput = (world: T, playerId: number, input: string): boolean => {
        for (const mapping of mappings) {
            const pattern = typeof mapping.pattern === 'string' 
                ? new RegExp(`^${mapping.pattern}$`, 'i')
                : mapping.pattern;
            
            const match = input.match(pattern);
            if (match) {
                mapping.action(world, playerId, match);
                return true;
            }
        }
        return false;
    };

    const system = async (world: T) => {
        console.debug('[PlayerInputSystem] - execute.');
        // Get all active players
        const activePlayers = query(world, [world.components.PlayerState])
        // TODO: Properly handle active players.  probably need an add/remove observer
        //       and Active becomes a component that can be added/removed.  When
        //       the observer fires, we add/remove the player from the active list.
        //       we'll have to change the code to rerace any new active players.
            // .filter(playerId => getActive(world, playerId));
        
        // Wait for any player to have input
        await world.inputQueue?.waitForAvailableMessage();
        const playerInput = world.inputQueue?.dequeue();
        if (playerInput) {
            const { playerId: playerName, input } = playerInput;
            console.debug(`[PlayerInputSystem] Received input from player ${playerName}: ${input}`);

            // Get the player id and make sure the player is active
            const playerId = activePlayers.find(
                playerId => getPlayerName(world, playerId) === playerName);
            // TODO: Implement better handling of a player that is not active.  This discards their action.
            if (!playerId) return;
            processInput(world, playerId, input.trim());
        }
    };

    world.systems.PlayerInput = system;
    return system;
};