export enum EntityType {
    GAME = 'game',
    PLAYER = 'player',
    GAMEPIECE = 'gamepiece',
}

const entitySizingConfig: Map<string, number> = new Map();

// Always have a single game entity
entitySizingConfig.set(EntityType.GAME, 1);

export const setMaxEntityCount = (entityType: EntityType | string, maxEntityCount: number) => {
    entitySizingConfig.set(entityType, maxEntityCount);
}

export const getMaxEntityCount = (): number => {
    let sum = 0;
    entitySizingConfig.forEach((value) => {
        sum += value;
    });
    return sum;
}

