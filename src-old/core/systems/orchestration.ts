import { observe, onAdd, onRemove, QueryTerm, World, WorldContext } from "#core/engine.js"
import { exit } from "process";

export type GameSystemsConfig = {
    description: string;
    reactiveSystems?: ReactiveSystem[];
    managedSystems: SystemGroup;
}

export enum ReactiveSystemTrigger {
    ADD,
    REMOVE,
    ADD_REMOVE
}

export type System = (world: World, entity?: number) => Promise<void>;

export type ReactiveSystem = {
    description: string;
    query: QueryTerm[];
    trigger: ReactiveSystemTrigger;
    system: System;
}

export enum SystemExecutionType {
    PARALLEL,
    SEQUENTIAL
}

export type DescribedSystem = {
    description: string;
    execute: System;
}

export type SystemGroup = {
    type: SystemExecutionType;
    systems: (DescribedSystem | SystemGroup)[];
    precondition?: (world: World) => boolean;
    description: string;
}

export const createSystem = (description: string, system: System): DescribedSystem => ({
    description,
    execute: system
});

export const createReactiveSystem = (
    description: string,
    query: QueryTerm[],
    trigger: ReactiveSystemTrigger,
    system: System
): ReactiveSystem => ({
    description,
    query,
    trigger,
    system
});

export type ExitCondition = (world: World) => boolean;

const registerReactiveSystems = (world: World<WorldContext>, reactiveSystems: ReactiveSystem[]): void => {
    console.debug('[Orchestration] Registering reactive systems');
    for (const reactiveSystem of reactiveSystems) {
        console.debug(`[Orchestration] Registering reactive system: ${reactiveSystem.description}`);
        switch (reactiveSystem.trigger) {
            case ReactiveSystemTrigger.ADD:
                observe(world, onAdd(...reactiveSystem.query), 
                    async (entity) => await reactiveSystem.system(world, entity));
                break;
            case ReactiveSystemTrigger.REMOVE:
                observe(world, onRemove(...reactiveSystem.query), 
                    async (entity) => await reactiveSystem.system(world, entity));
                break;
            case ReactiveSystemTrigger.ADD_REMOVE:
                observe(world, onAdd(...reactiveSystem.query), 
                    async (entity) => await reactiveSystem.system(world, entity));
                observe(world, onRemove(...reactiveSystem.query), 
                    async (entity) => await reactiveSystem.system(world, entity));
                break;
        }
    }
}

async function executeSystem(
    world: World, 
    system: DescribedSystem | SystemGroup, 
    exitCondition: (world: World) => boolean): Promise<void> {
    if (exitCondition(world)) {
        return;
    }
    
    if ('type' in system) {
        console.debug(`[Orchestration] Executing ${system.description}`);
        return executeGroup(world, system, exitCondition);
    }
    console.debug(`[Orchestration] Executing ${system.description}`);
    return system.execute(world);
}

async function executeGroup(world: World, group: SystemGroup, exitCondition: (world: World) => boolean): Promise<void> {
    if (group.precondition && !group.precondition(world)) {
        console.debug(`[Orchestration] Precondition failed for ${group.description}`);
        return;
    }

    console.debug(`[Orchestration] System Group ${group.description} executing as ${SystemExecutionType[group.type]}`);

    if (group.type === SystemExecutionType.PARALLEL) {
        await Promise.all(group.systems.map(system => 
            executeSystem(world, system, exitCondition)));
    } else {
        for (const system of group.systems) {
            await executeSystem(world, system, exitCondition);
        }
    }
}

export async function execute(
    world: World<WorldContext>, 
    config: GameSystemsConfig, 
    exitCondition: ExitCondition
): Promise<void> {
    console.debug('[Orchestrator] Starting system execution %s', config.description);

    // Register reactive systems
    if (config.reactiveSystems) {
        // Ensure unsubscribes array exists
        world.unsubscribes = world.unsubscribes || [];
        registerReactiveSystems(world, config.reactiveSystems);
    }

    // Run managed systems until exit condition is met
    while (!exitCondition(world)) {
        console.debug('[Orchestrator] Starting tick');
        await executeGroup(world, config.managedSystems, exitCondition);
        console.debug('[Orchestrator] Completed tick');
    }
    
    console.debug('[Orchestrator] Execution complete');

    // Cleanup reactive systems
    world.unsubscribes?.forEach(unsubscribe => unsubscribe());
}