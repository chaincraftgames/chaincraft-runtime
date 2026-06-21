// import { defineQuery, enterQuery, hasComponent, removeComponent, addComponent, World } from 'bitecs';
// import { Turn } from '../components/player/Active';
// import { PlayerRole } from '../components/player/PlayerRole';

// const playerQuery = defineQuery([PlayerRole]);
// const turnQuery = defineQuery([Turn]);

// export const turnSystem = (world: World) => {
//     const currentTurns = turnQuery(world);
    
//     // If no turn exists, start with first player
//     if (currentTurns.length === 0) {
//         const players = playerQuery(world);
//         if (players.length > 0) {
//             addComponent(world, Turn, players[0]);
//         }
//         return world;
//     }

//     // Handle turn completion (would be triggered by some kind of event/action)
//     // For now, just rotating turns between players
//     const players = playerQuery(world);
//     if (players.length > 0) {
//         const currentTurnIndex = players.findIndex(pid => hasComponent(world, Turn, pid));
//         if (currentTurnIndex !== -1) {
//             // Remove current turn
//             removeComponent(world, Turn, players[currentTurnIndex]);
//             // Add turn to next player
//             const nextPlayerIndex = (currentTurnIndex + 1) % players.length;
//             addComponent(world, Turn, players[nextPlayerIndex]);
//         }
//     }

//     return world;
// };
