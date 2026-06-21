import { Component, World, WorldContext, query, getEntityComponents, removeComponent } from "#core/engine.js";
import { Extends } from "#core/extension.js";

export const registerActionHandler = (
    world: World<WorldContext>,
    actionType: string,
    handler: (world: World<WorldContext>, entity: number, action: Component) => void
) => {
    world.actionHandlers.set(actionType, handler);
    console.debug('[ActionSystem] registered action: %s', actionType);
}

export const createActionSystem = (world: World<WorldContext>) => {
    const system = async (world: World<WorldContext>, entity?: number): Promise<void> => {
        const actionEntities = entity ? [entity] : query(world,[Extends(world.components.Action)]);
        console.debug('[ActionSystem] - execute. Processing actions on entities %o...', actionEntities);

        for (const entity of actionEntities) {
            // Get all components and filter for actions
            const components = getEntityComponents(world, entity)
                .filter(c => c.getActionType !== undefined)
                .sort((a, b) => a.order[entity] - b.order[entity]);

            console.debug('[ActionSystem] - processing actions for entity %d: %o', entity, components.map(c => c.getActionType()));    

            for (const component of components) {
                const actionType = component.getActionType();
                console.debug('[ActionSystem] - processing action: %s for entity %d', actionType, entity);
                const handler = world.actionHandlers.get(actionType);
                if (handler) {
                    handler(world, entity, component);
                }

                // Remove the action component, once processed.
                removeComponent(world, entity, component);
            }
        }
    };

    world.systems.Action = system;
    return system;
};