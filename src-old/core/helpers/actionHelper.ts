import { World, WorldContext } from "#core/engine.js";
import { ArrayProps, ComponentProps, registerCustomComponent, withDefaultValues } from "./componentHelpers.js";

type BaseActionArrays = {
    order: Uint8Array;
};

type BaseActionProps = BaseActionArrays & {
    getActionType: () => string;
};

type ActionProps<T> = ComponentProps<T> & BaseActionProps;

/**
 * Registers a new action component with the proper type information
 */
export const registerCustomActionComponent = <T extends ActionProps<T>>(
    world: World<WorldContext>,
    name: string,
    baseAction: T,
    defaultValues: Partial<Record<keyof T, number>>
) => {
    const component = registerCustomComponent<ArrayProps<T>>(
        world,
        name,
        () => withDefaultValues(baseAction, defaultValues) as ArrayProps<T>
    );
    world.components[name].getActionType = baseAction.getActionType;
};