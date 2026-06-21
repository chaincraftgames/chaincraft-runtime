import { registerGamepieceOwner, setGamepieceOwner } from "#core/components/gamepiece/GamepieceOwner.js";
import { registerGamepieceType, setGamepieceType } from "#core/components/gamepiece/GamepieceType.js";
import { addComponent, addEntity, World, WorldContext } from "#core/engine.js";

export const registerGamepieceComponents = (world: World<WorldContext>) => {
    registerGamepieceType(world);
    registerGamepieceOwner(world);
}

export const addGamepieceEntity = (world: World<WorldContext>, gamepieceType: number, gamepieceOwner?: number) => {
    const gamepiece = addEntity(world);
    addComponent(world, gamepiece, world.components.GamepieceType);
    setGamepieceType(world, gamepiece, gamepieceType);
    if (gamepieceOwner) {
        setGamepieceOwner(world, gamepiece, gamepieceOwner);
    }
    return gamepiece;
};

