import { addComponent, Component, set, World, WorldContext } from "#core/engine.js";
import { getMaxEntityCount } from "#core/EntitySizingConfig.js";

export interface ActionParams {
    order?: number;
}

const createActionProps = () => {
    const maxEntityCount = getMaxEntityCount();
    return {
        order: new Uint8Array(maxEntityCount + 1),
        getName: () => "Action",
        getActionType: () => "Action"
    };
};

export const registerAction = (world: World<WorldContext>) => {
    world.components.Action = createActionProps();
};

export const addAction = <T extends ActionParams>(
    world: World<WorldContext>,
    entity: number, 
    component: Component,
    params: T
  ) => {
    console.debug('[ActionComponent] Adding action %s to %d with params %o', component.getActionType(), entity, params);
    addComponent(world, entity, set(component, params));
  };

