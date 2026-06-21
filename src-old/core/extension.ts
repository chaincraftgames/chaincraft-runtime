import { get } from "http";
import { Component, World, WorldContext, query, hasComponent, Or } from "./engine.js";
import { ComponentProps, createEmptyComponentCopy } from "./helpers/componentHelpers.js";
import exp from "constants";
import { register } from "module";

// Registry mapping base components to their extensions and vice versa
const extensionToBase = new Map<Component, Component>();
const baseToExtension = new Map<Component, Set<Component>>();

const registerExtension = (baseComponent: Component, extension: Component) => {
    // Register direct relationship
    extensionToBase.set(extension, baseComponent);
    if (!baseToExtension.has(baseComponent)) {
        baseToExtension.set(baseComponent, new Set());
    }
    baseToExtension.get(baseComponent)!.add(extension);

    // Register with all ancestors
    let currentParent = baseComponent;
    while (extensionToBase.has(currentParent)) {
        const ancestor = extensionToBase.get(currentParent)!;
        if (!baseToExtension.has(ancestor)) {
            baseToExtension.set(ancestor, new Set());
        }
        baseToExtension.get(ancestor)!.add(extension);
        currentParent = ancestor;
    }
};

const getAllExtensions = (component: Component): Component[] => {
    const result = new Set<Component>();
    
    // Get direct children
    const directChildren = baseToExtension.get(component) || new Set();
    directChildren.forEach(child => result.add(child));

    // Get children's extensions recursively
    directChildren.forEach(child => {
        getAllExtensions(child).forEach(ext => result.add(ext));
    });

    return Array.from(result);
}

/**
 * Extends a component such that queryExtends and hasComponentExtends can be used
 * to query and check for the base component and all its extensions.
 * @param baseComponent 
 * @param newProperties 
 * @returns 
 */
export const withExtension = <T extends ComponentProps<T>>(
    baseComponent: T,
    newProperties: Partial<T> = {}
): T => {
    const extendedComponent = {
        ...createEmptyComponentCopy(baseComponent as object),
        ...newProperties
    } as T;
    
    registerExtension(baseComponent, extendedComponent);
    console.debug('[Extension] withExtension - extended component: %o', (baseComponent as any).getName?.());
    return extendedComponent;
};

export const Extends = (component: Component) => {
    const extensions = getAllExtensions(component);
    console.debug('[Extension] Extends - expanded components: %o', extensions.map(c => (c as any).getName?.()));
    return Or(component, ...extensions);
};

export const hasComponentExtends = (
    world: World<WorldContext>,
    entity: number,
    component: Component
): boolean => {
    // Check base component
    if (hasComponent(world, entity, component)) {
        return true;
    }
    
    // Check all extensions
    const extended = getAllExtensions(component);
    
    return Array.from(extended).some(ext => 
        hasComponent(world, entity, ext)
    );
};