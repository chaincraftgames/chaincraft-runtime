import { Component, World, WorldContext, observe, onSet } from '#core/engine.js'
import { getMaxEntityCount } from '#core/EntitySizingConfig.js'
import { withExtension } from '#core/extension.js';

const TYPED_ARRAYS = {
    'Uint8Array': Uint8Array,
    'Uint16Array': Uint16Array,
    'Uint32Array': Uint32Array,
    'Int8Array': Int8Array,
    'Int16Array': Int16Array,
    'Int32Array': Int32Array,
    'Float32Array': Float32Array,
    'Float64Array': Float64Array
} as const

type TypedArray = 
    | Uint8Array 
    | Uint16Array 
    | Uint32Array 
    | Int8Array 
    | Int16Array 
    | Int32Array 
    | Float32Array 
    | Float64Array

export type ArrayProps<T> = {
    [K in keyof T]: T[K] extends TypedArray ? T[K] : never
}

type ComponentFunction = (...args: any[]) => any;

export type ComponentProps<T> = {
    [K in keyof T]: T[K] extends TypedArray ? T[K] 
                  : T[K] extends ComponentFunction ? T[K]
                  : never
}

const getTypedArrayConstructor = (array: TypedArray) => {
    const constructorName = array.constructor.name
    return TYPED_ARRAYS[constructorName as keyof typeof TYPED_ARRAYS]
}

const isTypedArray = (value: unknown): value is TypedArray => {
    return ArrayBuffer.isView(value)
}

const isNumberRecord = (obj: unknown): obj is Record<string, number> => {
    if (typeof obj !== 'object' || obj === null) return false
    return Object.values(obj).every(value => typeof value === 'number')
}

export const createEmptyComponentCopy = <T extends ComponentProps<T>>(baseComponent: T): T => {
    const copy = {} as T;
    
    for (const [key, value] of Object.entries(baseComponent)) {
        if (isTypedArray(value)) {
            const constructor = getTypedArrayConstructor(value);
            copy[key as keyof T] = new constructor(value.length) as T[keyof T];
        } else if (typeof value === 'function') {
            copy[key as keyof T] = value as T[keyof T];
        }
    }
    
    return copy;
};

/**
 * Create a component with default values filled in.  By default, this will create
 * an extension of the base component.  If you do not want to extend the base component,
 * set `doNotExtend` to `true`.
 * @param baseComponent 
 * @param defaults 
 * @param doNotExtend 
 * @returns 
 */
export const withDefaultValues = <T extends ComponentProps<T>>(
    baseComponent: T,
    defaults: Partial<Record<keyof T, number>>,
    doNotExtend: boolean = false
): T => {
    if (defaults && !isNumberRecord(defaults)) {
        throw new Error('Defaults must contain only number values')
    }

    const component = doNotExtend ? createEmptyComponentCopy(baseComponent) 
            : withExtension(baseComponent);
    
    for (const key of Object.keys(defaults) as Array<keyof T>) {
        const value = defaults[key];
        if (key in component && isTypedArray(component[key])) {
            (component[key] as TypedArray).fill(value);
        }
    }
    
    return component;
}

export const registerCustomComponent = <T extends ArrayProps<T>>(
    world: World<WorldContext>,
    name: string,
    createProps: (size: number) => T
): void => {
    world.components[name] = createProps(getMaxEntityCount() + 1),
    world.components[name].getName = () => name;

    // Register an observer so we can set the data when added
    createComponentObserver(world, world.components[name]);
};

export const createComponentObserver = <T extends Record<string, number>>(
    world: World<WorldContext>, 
    component: Component,
) => {
    observe(world, onSet(component), (eid, params: T) => {
        // Iterate params and set corresponding SoA arrays
        for (const [key, value] of Object.entries(params)) {
            if (key in component && isTypedArray(component[key])) {
                (component[key] as TypedArray)[eid] = value;
            }
        }
    });
};