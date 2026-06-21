import { registerPlayerName, setPlayerName } from "#core/components/player/PlayerName.js";
import { registerPlayerRole, setPlayerRole } from "#core/components/player/PlayerRole.js";
import { registerPlayerState, setInactive } from "#core/components/player/PlayerState.js";
import { registerTurnOrder, setTurnOrder } from "#core/components/player/TurnOrder.js";
import { addEntity, World, WorldContext, addComponent } from "#core/engine.js";
import { register } from "module";

export const registerPlayerComponents = (world: World<WorldContext>) => {
    registerPlayerName(world);
    registerPlayerRole(world);
    registerPlayerState(world);
};


export const addPlayerEntity = (
    world: World<WorldContext>, 
    name: string, 
    role: number
) => {
    const player = addEntity(world);
    addComponent(world, player, world.components.PlayerName);
    setPlayerName(world, player, name);
    addComponent(world, player, world.components.PlayerRole);
    setPlayerRole(world, player, role);
    addComponent(world, player, world.components.PlayerState);
    setInactive(world, player);
    return player;
};