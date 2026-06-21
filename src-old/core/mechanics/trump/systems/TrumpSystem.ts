import { getGamepiecesInInventory } from '#core/components/Inventory.js';
import { World, WorldContext } from '#core/engine.js';
import { setTrumpResults } from '#core/mechanics/trump/components/TrumpResults.js';
import { set } from 'bitecs/core';

export interface MatrixRuleConfig {
    /** 
     * Explicit head to head matchups.  E.g.
     * [ 0,  -1,  2,  1], // Fire
     * [ 1,   0, -1,  2], // Water
     * [-2,   1,  0, -1], // Earth
     * [-1,  -2,  1,  0]  // Air
     * Positive number means row beats column
     * Negative means column beats row
     * Magnitude indicates strength of victory   
     */
    matchupMatrix: number[][];

    /** Maps the values to row/col indices in the matchup matrix */
    valueToIndex: Map<number, number>;    
}

export interface InventoryConfig {
    /** 
     * The entity that owns the inventory
     */
    owner: number;

    /** 
     * The inventory type
     */
    type: number;
}

/** Base configuration all rules share */
interface BaseTrumpRule {
    type: 'dominant' | 'comparison' | 'matrix';
    getValue: (world: World<WorldContext>, entityId: number) => number;
}

/** Rule using dominant value */
interface DominantValueRule extends BaseTrumpRule {
    type: 'dominant';
    dominantValue: number;
}

/** Rule using highest/lowest wins */
interface ComparisonRule extends BaseTrumpRule {
    type: 'comparison';
    useHighestWins: boolean;
}

/** Rule using matrix */
interface MatrixRule extends BaseTrumpRule {
    type: 'matrix';
    matrixRule: {
        matchupMatrix: number[][];
        valueToIndex: Map<number, number>;
    }
}

/** Combined type - only one variant possible */
export type TrumpRuleConfig = DominantValueRule | ComparisonRule | MatrixRule;

export const createDominantValueRule = (
    getValue: (world: World<WorldContext>, entityId: number) => number,
    dominantValue: number
): DominantValueRule => ({
    type: 'dominant',
    getValue,
    dominantValue
});

export const createComparisonRule = (
    getValue: (world: World<WorldContext>, entityId: number) => number,
    useHighestWins: boolean
): ComparisonRule => ({
    type: 'comparison',
    getValue,
    useHighestWins
});

export const createMatrixRule = (
    getValue: (world: World<WorldContext>, entityId: number) => number,
    matchupMatrix: number[][],
    valueToIndex: Map<number, number>
): MatrixRule => ({
    type: 'matrix',
    getValue,
    matrixRule: {
        matchupMatrix,
        valueToIndex
    }
});

interface ItemValue {
    id: number;
    value: number;
}

type ItemGroups = ItemValue[][];

interface ItemScore {
    id: number;
    value: number;
    points: number;
}

/** 
 * Compare values and return a negative if value1 beats value2 according to the rule,
 * 0 if they are equal, and a positive if value2 beats value1. 
 */
const compareValues = (
    rule: TrumpRuleConfig, 
    value1: number, 
    value2: number
): number => {
    switch (rule.type) {
        case 'dominant':
            if (value1 === rule.dominantValue) return -1;  
            if (value2 === rule.dominantValue) return 1;   
            return 0;  // items tie if neither is dominant
        case 'matrix':
            const index1 = rule.matrixRule.valueToIndex.get(value1);
            const index2 = rule.matrixRule.valueToIndex.get(value2);
            if (index1 !== undefined && index2 !== undefined) {
                return -rule.matrixRule.matchupMatrix[index1][index2]; // Negated to match contract
            }
            return 0;  // items tie if they are not in the matrix
        case 'comparison':
            const comparison = value1 - value2;
            return rule.useHighestWins ? -comparison : comparison;
    }
};

const calculatePoints = (items: ItemValue[], rule: TrumpRuleConfig): ItemScore[] => {
    const scores = items.map(item => ({
        id: item.id,
        value: item.value,
        points: 0
    }));

    // Round-robin comparison
    for (let i = 0; i < scores.length; i++) {
        for (let j = i + 1; j < scores.length; j++) {
            const result = compareValues(rule, scores[i].value, scores[j].value);
            if (result < 0) {
                scores[i].points++;
                scores[j].points--;
            } else if (result > 0) {
                scores[i].points--;
                scores[j].points++;
            }
        }
    }

    return scores;
};

const groupByPoints = (scores: ItemScore[]): ItemValue[][] => {
    if (scores.length === 0) return [];

    scores.sort((a, b) => b.points - a.points);
    
    const groups: ItemValue[][] = [];
    let currentGroup: ItemValue[] = [];
    let currentPoints = scores[0].points;

    for (const score of scores) {
        if (score.points === currentPoints) {
            currentGroup.push({ id: score.id, value: score.value });
        } else {
            groups.push([...currentGroup]);
            currentGroup = [{ id: score.id, value: score.value }];
            currentPoints = score.points;
        }
    }
    
    groups.push(currentGroup);
    return groups;
};

export const createTrumpSystem = (
    world: World<WorldContext>,
    inventory: InventoryConfig, 
    rules: TrumpRuleConfig[]
) => {
    const system = async (world: World<WorldContext>): Promise<void> => {
        // Get the items in the inventory
        const items = getGamepiecesInInventory(world, inventory.owner, inventory.type);
        if (items.length === 0) return;
        if (items.length === 1) {
            setTrumpResults(world, items[0], 0);    
            console.debug(`[TrumpSystem] Winner: ${items[0]}`);
            return;
        }

        // Process first rule to create initial groups
        const initialItems = items.map(id => ({
            id,
            value: rules[0].getValue(world, id)
        }));
        const scores = calculatePoints(initialItems, rules[0]);
        console.debug('[TrumpSystem] scores:', scores);
        let groups = groupByPoints(scores);

        // Process subsequent rules
        for (let i = 1; i < rules.length; i++) {
            const rule = rules[i];
            const nextGroups: ItemGroups = [];

            // Process each existing group
            for (const group of groups) {
                if (group.length === 1) {
                    nextGroups.push(group);
                    continue;
                }

                // Update values and calculate points for this group
                const groupItems = group.map(({ id }) => ({
                    id,
                    value: rule.getValue(world, id)
                }));
                const groupScores = calculatePoints(groupItems, rule);
                const subGroups = groupByPoints(groupScores);
                nextGroups.push(...subGroups);
            }

            groups = nextGroups;
        }

        console.debug('[TrumpSystem] groups:', groups.map(group => group.map(item => item.id)));

        // Assign ranks based on group index
        groups.forEach((group, groupIndex) => {
            group.forEach(item => {
                setTrumpResults(world, item.id, groupIndex);
            });
        });
    };

    world.systems.Trump = system;
    return system;
};

