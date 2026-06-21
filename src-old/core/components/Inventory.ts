import { 
    createRelation, 
    getRelationTargets,
    Relation, 
    addComponent, 
    removeComponent,
    World,
    WorldContext
} from "#core/engine.js";
import { get } from "http";
import { getGamepieceType } from "./gamepiece/GamepieceType.js";

interface InventoryTypeInfo {
    /** An id for the type of inventory, e.g. player hand, deck, discard, etc... */
    typeId: number;

    /** An array of gamepiece type ids that can be held in this inventory. */
    allowedItemTypes: number[];
}

type InventoryTypes = Map<number, InventoryTypeInfo>;
const worldInventoryTypes: WeakMap<World, InventoryTypes> = new Map();

type InventoriesByType = Map<number, Inventory>;
type InventoriesByEntity = Map<number, InventoriesByType>;
const worldInventories: WeakMap<World, InventoriesByEntity> = new Map();

type Inventory = Relation<any>;

export const getInventory = (world: World, entityId: number, inventoryType: number): Inventory | undefined => {
    return worldInventories.get(world)?.get(entityId)?.get(inventoryType);
}

export const defineInventoryType = (world: World, typeId: number, allowedItemTypes: number[]): void => {
    const inventoryTypeInfo: InventoryTypeInfo = {
        typeId,
        allowedItemTypes
    };
    const inventoryTypes = worldInventoryTypes.get(world) ?? new Map();
    inventoryTypes.set(typeId, inventoryTypeInfo);
    worldInventoryTypes.set(world, inventoryTypes);
}

/**
 * Creates an inventory for the specified type
 * @param typeId 
 * @param itemConstraints 
 * @returns 
 */
export const createInventory = (
    world: World,
    entity: number,
    inventoryType: number
): Inventory  => {
    const inventoryRelation = createRelation();
    const inventoryTypesByEntity = worldInventories.get(world) ?? new Map();
    const inventoriesByType = inventoryTypesByEntity.get(entity) ?? new Map();
    inventoryTypesByEntity.set(entity, inventoriesByType);
    inventoriesByType.set(inventoryType, inventoryRelation);
    worldInventories.set(world, inventoryTypesByEntity);
    return inventoryRelation as Inventory;
}

export const getInventoryConstraints = (world: World, typeId: number): number[] => {
    return worldInventoryTypes.get(world)?.get(typeId)?.allowedItemTypes ?? [];
}

/** Adds a gamepiece to the specified inventory */
export const addGamepieceToInventory = (
    world: World<WorldContext>, 
    entityId: number, 
    inventoryType: number, 
    gamepieceId: number
): void => {
    const gamepieceType = getGamepieceType(world, gamepieceId);
    const constraints = getInventoryConstraints(world, inventoryType);
    if (constraints && constraints.includes(gamepieceType)) {
        const inventory = getInventory(world, entityId, inventoryType);
        if (inventory) {
            addComponent(world, entityId, inventory(gamepieceId));    
        }   
    }
}

/** Removes a gamepiece from the specified inventory */
export const removeGamepieceFromInventory = (
    world: World, 
    entityId: number, 
    inventoryType: number, 
    gamepieceId: number
): void => {
    const inventory = getInventory(world, entityId, inventoryType);
    if (inventory) {
        removeComponent(world, entityId, inventory(gamepieceId)); 
    }  
}

/** Get the gamepieces in the inventory */
export const getGamepiecesInInventory = (
    world: World, 
    entityId: number, 
    inventoryType: number
): number[] => {
    const inventory = getInventory(world, entityId, inventoryType);
    if (!inventory) {
        return [];
    }
    return getRelationTargets(world, entityId, inventory);
}
