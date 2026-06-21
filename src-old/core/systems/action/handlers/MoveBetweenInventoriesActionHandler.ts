import { addGamepieceToInventory, getGamepiecesInInventory, getInventory, removeGamepieceFromInventory } from "#core/components/Inventory.js";
import { Component, World, WorldContext } from "#core/engine.js";

export const moveBetweenInventoriesActionHandler = (
    world: World<WorldContext>, 
    entity: number,
    component: Component
) => {
    console.debug('[MoveBetweenInventoriesActionHandler] handling action: %s for entity %d', component.getActionType(), entity);
    
    // Remove the item from the source inventory and add it to the destination inventory
    const sourceInventoryType = component.sourceInventoryType[entity];
    const sourceEntity = component.sourceInventoryOwner[entity];
    const itemEntity = component.item[entity];
    const destinationEntity = component.destinationInventoryOwner[entity];
    const destinationInventoryType = component.destinationInventoryType[entity];
    console.debug('[MoveBetweenInventoriesActionHandler] Moving item %d from %d inventory %d to %d inventory %d', itemEntity, sourceEntity, sourceInventoryType, destinationEntity, destinationInventoryType);
    removeGamepieceFromInventory(
        world, 
        sourceEntity, 
        sourceInventoryType, 
        itemEntity
    );
    addGamepieceToInventory(
        world, 
        destinationEntity, 
        destinationInventoryType, 
        itemEntity
    );
    const sourceGamepieces = getGamepiecesInInventory(world, sourceEntity, sourceInventoryType);
    const destinationGamepieces = getGamepiecesInInventory(world, destinationEntity, destinationInventoryType);
    console.debug('[MoveBetweenInventoriesActionHandler] source inventory contents after move %o', sourceGamepieces);
    console.debug('[MoveBetweenInventoriesActionHandler] destination inventory contents after move %o', destinationGamepieces);
};

