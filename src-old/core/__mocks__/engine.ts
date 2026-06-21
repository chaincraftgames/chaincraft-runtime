import { jest } from '@jest/globals';

export interface WorldContext {
    components: Record<string, any>;
    gameState: number;
    systems: Record<string, any>;
    completionTracking: Record<string, any>;
}

export interface World<T = WorldContext> {
    components: Record<string, any>;
    gameState: number;
    systems: Record<string, any>;
    completionTracking: Record<string, any>;
}

// Create a mock TrumpResults component
const mockTrumpResults = {
    rank: new Int32Array(10)
};

export const createWorld = jest.fn().mockImplementation(() => {
    return ({
    components: {
        TrumpResults: mockTrumpResults
    },
    systems: {},
    gameState: 0,
    completionTracking: {}
})});

export const addComponent = jest.fn().mockImplementation((world, entity, component) => component);
export const removeComponent = jest.fn();
export const hasComponent = jest.fn();
export const getComponent = jest.fn();
export const set = jest.fn().mockImplementation((component) => component);
export const addEntity = jest.fn();
export const observe = jest.fn();
export const onAdd = jest.fn();
export const onRemove = jest.fn();
export const onSet = jest.fn();
export const query = jest.fn();

export const getGameState = jest.fn<(world: World<WorldContext>) => number>()
    .mockImplementation(world => world.gameState);

export const setGameState = jest.fn<(world: World<WorldContext>, state: number) => void>()
    .mockImplementation((world, state) => {
        if (state == 0) console.trace('setGameState', state);
        world.gameState = state;
    });

export const isCompleted = jest.fn<(world: World<WorldContext>, ref: string) => boolean>()
    .mockImplementation((world, ref) => {
        const completion = world.completionTracking[ref];
        return completion?.type === 'fixed' 
            ? completion.current >= completion.target
            : completion?.completed;
    });

export const updateCompletion = jest.fn<(world: World<WorldContext>, ref: string) => void>()
    .mockImplementation((world, ref) => {
        const completion = world.completionTracking[ref];
        if (completion.type === 'fixed') {
            completion.current++;
        } else {
            completion.completed = true;
        }
    });
