import { World, WorldContext, query, removeComponent } from '#core/engine.js';
import { getPlayerMessage } from '#core/components/player/PlayerMessage.js';
import { getPlayerName } from '#core/components/player/PlayerName.js';

export const createPlayerMessagingSystem = (world: World<WorldContext>, messages: string[]) => {
    const system = async (world: World<WorldContext>, player?: number): Promise<void> => {
        const playersWithMessages = player ? [player] : query(world, [world.components.PlayerMessage]);
        console.debug('[PlayerMessagingSystem] Players with messages:', playersWithMessages);
        
        for (const player of playersWithMessages) {
            const messageId = getPlayerMessage(world, player);
            if (!messageId) {
                return;
            }
            const playerName = getPlayerName(world, player);
            if (!playerName) {
                console.error('[PlayerMessagingSystem] Player name not found for player:', player);
                return;
            }
            
            const queue = world.outputQueue
            if (!queue) {
                console.error('[PlayerMessagingSystem] Queue not found for player:', playerName);
                return;
            }

            console.debug('[PlayerMessagingSystem] Queueing message to player:', playerName, messageId);

            queue.enqueue({
                playerId: playerName,
                message: messages[messageId]
            });
    
            removeComponent(world, player, world.components.PlayerMessage);
        };
        return;
    };

    world.systems.PlayerMessaging = system;
    return system;
};
