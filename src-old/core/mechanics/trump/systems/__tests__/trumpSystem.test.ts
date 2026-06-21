import { jest } from '@jest/globals';
import { World, WorldContext, createWorld } from "#core/engine.js";
import { createTrumpSystem, createComparisonRule, createDominantValueRule, createMatrixRule } from "#core/mechanics/trump/systems/TrumpSystem.js";
import { getGamepiecesInInventory } from "#core/components/Inventory.js";
import { setTrumpResults } from "#core/mechanics/trump/components/TrumpResults.js";

describe('TrumpSystem', () => {
    let world: World<WorldContext>;
    const inventoryConfig = {
        owner: 0,
        type: 1
    };

    beforeEach(() => {
        world = createWorld();
        (getGamepiecesInInventory as jest.Mock).mockClear();  // No type assertion needed
        (setTrumpResults as jest.Mock).mockClear();  // No type assertion needed
    });

    test('single item should have rank 0', async () => {
        (getGamepiecesInInventory as jest.Mock).mockReturnValueOnce([0]);
        const trumpSystem = createTrumpSystem(
            world,
            inventoryConfig,
            [createComparisonRule(() => 0, true)]
        );

        await trumpSystem(world);
        
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            0,
            0
        );
    });

    test('two items with clear winner', async () => {
        (getGamepiecesInInventory as jest.Mock).mockReturnValueOnce([0, 1]);
        const trumpSystem = createTrumpSystem(
            world,
            inventoryConfig,
            [createComparisonRule(
                (world: World, entity: number) => entity === 0 ? 1 : 0,
                true
            )]
        );

        await trumpSystem(world);
        
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            0,
            0
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            1,
            1
        );
    });

    test('items tied with matrix rule', async () => {
        (getGamepiecesInInventory as jest.Mock).mockReturnValueOnce([0, 1, 2]);
        const trumpSystem = createTrumpSystem(
            world,
            inventoryConfig,
            [createMatrixRule(
                (world: World, entity: number) => entity,
                [
                    [0, 1, -1],
                    [-1, 0, 1],
                    [1, -1, 0]
                ],
                new Map([[0, 0], [1, 1], [2, 2]])
            )]
        );

        await trumpSystem(world);
        
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            0,
            0
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            1,
            0
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            2,
            0
        );
    });

    test('dominant value wins', async () => {
        (getGamepiecesInInventory as jest.Mock).mockReturnValueOnce([0, 1, 2]);
        const trumpSystem = createTrumpSystem(
            world,
            inventoryConfig,
            [createDominantValueRule(
                (world: World, entity: number) => entity,
                1
            )]
        );

        await trumpSystem(world);
        
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            0,
            1
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            1,
            0
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            2,
            1
        );
    });

    test('multiple rules break ties', async () => {
        (getGamepiecesInInventory as jest.Mock).mockReturnValueOnce([0, 1, 2]);
        const trumpSystem = createTrumpSystem(
            world,
            inventoryConfig,
            [
                createComparisonRule(
                    (world: World, entity: number) => 1,
                    true
                ),
                createComparisonRule(
                    (world: World, entity: number) => entity,
                    true
                )
            ]
        );

        await trumpSystem(world);
        
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            0,
            2
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            1,
            1
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            2,
            0
        );
    });

    test('breaks ties within multiple ranked groups', async () => {
        (getGamepiecesInInventory as jest.Mock).mockReturnValueOnce([0, 1, 2, 3]);
        const trumpSystem = createTrumpSystem(
            world,
            inventoryConfig,
            [
                createComparisonRule(
                    (world: World, entity: number) => entity < 2 ? 1 : 0,
                    true
                ),
                createComparisonRule(
                    (world: World, entity: number) => entity,
                    true
                )
            ]
        );

        await trumpSystem(world);
        
        // First group should be split into ranks 0 and 1
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            0,
            1  // Lower value entity gets higher rank within group
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            1,
            0  // Higher value entity gets lower rank within group
        );
        
        // Second group should be split into ranks 2 and 3
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            2,
            3
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            3,
            2
        );
    });

    test('two items tied stay tied', async () => {
        (getGamepiecesInInventory as jest.Mock).mockReturnValueOnce([0, 1]);
        const trumpSystem = createTrumpSystem(
            world,
            inventoryConfig,
            [createComparisonRule(() => 1, true)]
        );

        await trumpSystem(world);
        
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            0,
            0
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            1,
            0
        );
    });

    test('three items with circular hierarchy all tie', async () => {
        (getGamepiecesInInventory as jest.Mock).mockReturnValueOnce([0, 1, 2]);
        const trumpSystem = createTrumpSystem(
            world,
            inventoryConfig,
            [createMatrixRule(
                (world: World, entity: number) => entity,
                [
                    [ 0,  1, -1],
                    [-1,  0,  1],
                    [ 1, -1,  0]
                ],
                new Map([[0, 0], [1, 1], [2, 2]])
            )]
        );

        await trumpSystem(world);
        
        // All items should have rank 0 due to circular relationship
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            0,
            0
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            1,
            0
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            2,
            0
        );
    });

    test('three items with two tied and one different', async () => {
        (getGamepiecesInInventory as jest.Mock).mockReturnValueOnce([0, 1, 2]);
        const trumpSystem = createTrumpSystem(
            world,
            inventoryConfig,
            [createComparisonRule(
                (world: World, entity: number) => entity === 2 ? 0 : 1,
                true
            )]
        );

        await trumpSystem(world);
        
        // First two items tie at rank 0, last item gets rank 2
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            0,
            0
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            1,
            0
        );
        expect(setTrumpResults).toHaveBeenCalledWith(
            expect.anything(),
            2,
            1
        );
    });
});
