import { Component, observe, onSet, World, WorldContext } from "#core/engine.js";
import { getMaxEntityCount } from "#core/EntitySizingConfig.js";
import { withExtension } from "#core/extension.js";
import { registerActionHandler } from "#core/systems/action/ActionSystem.js";
import { moveBetweenInventoriesActionHandler } from "#core/systems/action/handlers/MoveBetweenInventoriesActionHandler.js";
import { ActionParams, addAction } from "#core/components/actions/Action.js";
import { createComponentObserver } from "#core/helpers/componentHelpers.js";

const actionType = "MoveBetweenInventories";

const createMoveBetweenInventoriesActionProps = () => {
    const maxEntityCount = getMaxEntityCount();
    const arrayType = maxEntityCount + 1 <= 255 ? Uint8Array : 
                      (maxEntityCount + 1 <= 65535 ? Uint16Array : Uint32Array);

    return {
        sourceInventoryType: new Uint8Array(maxEntityCount + 1),
        sourceInventoryOwner: new arrayType(maxEntityCount + 1),
        destinationInventoryType: new Uint8Array(maxEntityCount + 1),
        destinationInventoryOwner: new arrayType(maxEntityCount + 1),
        item: new arrayType(maxEntityCount + 1),
        order: new Uint8Array(maxEntityCount + 1),
        getName: () => "MoveBetweenInventoriesAction",
        getActionType: () => actionType
    };
};

export interface MoveBetweenInventoriesParams extends ActionParams {
    sourceInventoryType: number;
    sourceInventoryOwner: number;
    destinationInventoryType: number;
    destinationInventoryOwner: number;
    item: number;
  }

/** Register component with a world */
export const registerMoveBetweenInventoriesAction = (world: World<WorldContext>) => {
    // Extend the Action component
    world.components.MoveBetweenInventoriesAction = withExtension(
        world.components.Action,
        createMoveBetweenInventoriesActionProps()
    );

    // Register the action
    registerActionHandler(
        world,
        actionType,
        moveBetweenInventoriesActionHandler
    )

    // Create set observer so we can use set to set the data when added
    createComponentObserver(world, world.components.MoveBetweenInventoriesAction);
}

export const addMoveBetweenInventoriesAction = (
    world: World<WorldContext>,
    entity: number,
    component: Component, // Allow passing extended component
    params: Partial<MoveBetweenInventoriesParams>
  ) => {
    addAction(world, entity, component, params);
  };

