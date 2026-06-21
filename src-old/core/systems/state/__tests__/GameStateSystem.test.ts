import { World, WorldContext, createWorld, getGameState } from "#core/engine.js";
import { createGameStateSystem, GAME_STATE_INIT, GAME_STATE_END, TransitionConfig } from "../GameStateSystem.js";


describe('GameStateSystemv - repeat and nested transitions', () => {
    let world: World<WorldContext>;
    let stateLog: number[];
    let nestedCount: number;
    let variableRepeatDone: boolean;
    let callCount: number;  // Add to track across all tests
    let stateByTick: Array<{ tick: number, state: number }>;

    beforeEach(() => {
        world = createWorld({}) as World<WorldContext>;
        stateLog = [];
        stateByTick = [];
        nestedCount = 0;
        variableRepeatDone = false;
        callCount = 0;  // Reset for each test
    });

    const logStateChange = (tick: number, state: number) => {
        stateByTick.push({ tick, state });
    };

    test('handles nested repeat transitions', () => {
        let iterationCount = 0;
        let nestedCount = 0;
        let shouldTriggerFixedRepeat = false;
        const actionLog: string[] = [];
        
        const config: TransitionConfig<World<WorldContext>>[] = [
            { from: GAME_STATE_INIT, to: 101, execute: () => actionLog.push('init->101') },
            {
                from: 101, to: 102,
                repeat: { times: 2 },
                execute: () => actionLog.push('outer-repeat'),
                transitions: [
                    { from: 102, to: 101, execute: () => actionLog.push('102->101') },
                    { from: 101, to: 102, execute: () => actionLog.push('101->102') }
                ]
            },
            {
                from: 102, to: 201,
                when: () => iterationCount < 2,
                // repeat: { until: () => iterationCount >= 2 },
                repeat: { times: 2 },
                execute: () => actionLog.push('variable-repeat'),
                transitions: [
                    { from: 201, to: 202, execute: () => {
                        shouldTriggerFixedRepeat = true;
                        actionLog.push('201->202') 
                    }},
                    {
                        from: 202, to: 202,
                        when: () => {
                            console.debug('Inside inner fixed repeat when - shouldTriggerFixedRepeat: %s, nestedCount %d', shouldTriggerFixedRepeat, nestedCount);
                            return shouldTriggerFixedRepeat;
                        },
                        repeat: { times: 2 },
                        execute: () => {
                            actionLog.push('fixed-repeat');
                        },
                        transitions: [
                            { from: 202, to: 202, execute: () => {
                                actionLog.push('202->202');
                                nestedCount++;
                                if (nestedCount >= 2) {
                                    shouldTriggerFixedRepeat = false;
                                    nestedCount = 0;
                                }
                            }},
                        ]
                    },
                    { from: 202, to: 201, execute: () => {
                        actionLog.push('202->201');
                        iterationCount++;
                    }}
                ]
            },
            { from: 201, to: GAME_STATE_END, when: () => iterationCount >= 2, execute: () => actionLog.push('end') }
        ];

        createGameStateSystem(world, config);

        // Run system multiple times to complete sequences
        for (let i = 0; i <= 20; i++) {
            world.systems.GameState(world);
            logStateChange(i, getGameState(world));
        }

        expect(actionLog).toEqual([
            'init->101',       // Initial transition
            'outer-repeat',    // First fixed repeat (outer)
            '102->101',       // Inner transition
            '101->102',       // Complete first iteration
            '102->101',       // Inner transition
            '101->102',       // Complete second iteration
            'variable-repeat', // First variable repeat
            '201->202',       // Enter nested state
            'fixed-repeat',    // First nested fixed repeat
            '202->202',       // Inner fixed repeat transition
            '202->202',       // Inner fixed repeat transition
            '202->201',       // Return to original state
            '201->202',       // Enter nested state again
            'fixed-repeat',    // First nested fixed repeat (second iteration)
            '202->202',       // Inner fixed repeat transition
            '202->202',       // Inner fixed repeat transition
            '202->201',       // Return to original state
            'end'             // Final transition
        ]);

        expect(stateByTick).toEqual([
            { tick: 0, state: 101 },   // Initial state
            { tick: 1, state: 102 },   // First outer repeat
            { tick: 2, state: 101 },   // First inner transition
            { tick: 3, state: 102 },   // Complete first iteration
            { tick: 4, state: 101 },   // Second outer repeat starts
            { tick: 5, state: 102 },   // Complete second iteration
            { tick: 6, state: 201 },   // First variable repeat
            { tick: 7, state: 202 },   // Enter nested state
            { tick: 8, state: 202 },   // First nested fixed repeat
            { tick: 9, state: 202 },   // Second nested fixed repeat
            { tick: 10, state: 201 },  // Return to original state
            { tick: 11, state: 202 },  // Second iteration nested state
            { tick: 12, state: 202 },  // First nested repeat (second time)
            { tick: 13, state: 202 },  // Second nested repeat (second time)
            { tick: 14, state: 201 },  // Return to original state
            { tick: 15, state: GAME_STATE_END }  // Complete
        ]);
    });
    /*
    test('handles alternating invalid transitions in repeat', () => {
        const actionLog: string[] = [];
        
        const alternatingCondition = () => {
            callCount++;
            return callCount % 2 === 0;  // True on even calls (2,4,6...)
        };

        const config: TransitionConfig<World<WorldContext>>[] = [
            { from: GAME_STATE_INIT, to: 101, execute: () => actionLog.push('init->101') },
            {
                from: 101, to: 102, when: () => true,
                repeat: { times: 2 },
                transitions: [
                    { 
                        from: 102, 
                        to: 101, 
                        execute: () => actionLog.push('102->101')
                    },
                    { 
                        from: 101, 
                        to: 102, 
                        when: alternatingCondition,
                        execute: () => actionLog.push('101->102')
                    }
                ]
            },
            { from: 102, to: GAME_STATE_END, execute: () => actionLog.push('102->end') }
        ];

        createGameStateSystem(world, config);
        
        // Run system multiple times
        for (let i = 0; i <= 8; i++) {
            world.systems.GameState(world);
            const stateAfter = getGameState(world);
            logStateChange(i, stateAfter);
            console.log('i:%d, callCount: %d, state: %d', i, callCount, stateAfter);
        }

        // Should have half as many transitions as calls due to alternating failures
        expect(actionLog).toEqual([
            'init->101',       // Initial transition
            '102->101',
            '101->102',       // First valid inner transition
            '102->101',       // Back to start
            '101->102',       // Second valid inner transition
            '102->end'        // Final transition
        ]);

        // Adjust the timing expectations to match the alternating condition behavior
        expect(stateByTick).toEqual([
            { tick: 0, state: 101 },    // Initial transition
            { tick: 1, state: 102 },    // Repeat triggers
            { tick: 2, state: 101 },    // First inner transition
            { tick: 3, state: 101 },
            { tick: 4, state: 102 },    // Back to start
            { tick: 5, state: 101 },    // Second inner transition
            { tick: 6, state: 101 },
            { tick: 7, state: 102 },    // Back to start
            { tick: 8, state: GAME_STATE_END }  // Final transition
        ]);
    });
    
    test('handles sequence ordering and skipping', () => {
        const actionLog: string[] = [];
        
        const config: TransitionConfig<World<WorldContext>>[] = [
            { from: GAME_STATE_INIT, to: 101, execute: () => actionLog.push('init->101') },
            {
                from: 101, to: 103, when: () => true,
                repeat: { times: 2 },
                transitions: [
                    // This transition should never execute (when is always false)
                    { 
                        from: 103, 
                        to: 102, 
                        when: () => false,
                        execute: () => actionLog.push('101->102-blocked')
                    },
                    // This one should execute when state is 101
                    { 
                        from: 101, 
                        to: 103, 
                        execute: () => {
                            actionLog.push('101->103-allowed');
                            // Remove state capture here as it's redundant
                        }
                    },
                    // This one should never execute (wrong from state)
                    { 
                        from: 102, 
                        to: 103, 
                        execute: () => actionLog.push('102->103-wrong-state')
                    },
                    {
                        from: 103,
                        to: 101,
                        execute: () => {
                            actionLog.push('103->101');
                            // Remove state capture here as it's redundant
                        }
                    }
                ]
            },
            { from: 103, to: GAME_STATE_END, execute: () => actionLog.push('103->end') }
        ];

        createGameStateSystem(world, config);
        
        // Run system multiple times and capture state at end of each tick
        for (let i = 0; i <= 6; i++) {  // Reduce iterations to match expected states
            world.systems.GameState(world);
            logStateChange(i, getGameState(world));
        }

        // Should skip blocked and wrong-state transitions
        expect(actionLog).toEqual([
            'init->101',
            '103->101',  
            '101->103-allowed',  
            '103->101',
            '101->103-allowed',
            '103->end'
        ]);

        // Verify state sequence including immediate transitions within repeat
        expect(stateByTick).toEqual([
            { tick: 0, state: 101 },  // Initial transition
            { tick: 1, state: 103 },  // 101 -> 103 in repeat
            { tick: 2, state: 101 },  // 103 -> 101
            { tick: 3, state: 103 },  // 101 -> 103
            { tick: 4, state: 101 },  // 103 -> 101
            { tick: 5, state: 103 },  // 101 -> 103
            { tick: 6, state: GAME_STATE_END },  // 103 -> END
        ]);
    });

    test('executes repeat transition handler on initial trigger', () => {
        console.log('starting test - executes repeat transition handler on initial trigger');
        const actionLog: string[] = [];
        const repeatExecuteCount = { value: 0 };
        
        const config: TransitionConfig<World<WorldContext>>[] = [
            { from: GAME_STATE_INIT, to: 101, execute: () => actionLog.push('init->101') },
            {
                from: 101, to: 102,
                when: () => true,
                repeat: { times: 2 },
                execute: () => {
                    actionLog.push('repeat-execute');
                    repeatExecuteCount.value++;
                },
                transitions: [
                    { 
                        from: 102, 
                        to: 101,
                        execute: () => actionLog.push('102->101')
                    },
                    { 
                        from: 101, 
                        to: 102,
                        execute: () => actionLog.push('101->102') 
                    }
                ]
            },
            { from: 102, to: GAME_STATE_END, execute: () => actionLog.push('102->end') }
        ];

        createGameStateSystem(world, config);
        
        // Run system multiple times
        for (let i = 0; i <= 6; i++) {
            world.systems.GameState(world);
            logStateChange(i, getGameState(world));
        }

        // Verify repeat execute handler called exactly once
        expect(repeatExecuteCount.value).toBe(1);
        
        // Verify execution order
        expect(actionLog).toEqual([
            'init->101',
            'repeat-execute',  // Should execute when repeat first triggers
            '102->101',       // First iteration
            '101->102',       
            '102->101',       // Second iteration
            '101->102',
            '102->end'        // Exit repeat
        ]);

        // Verify timing of state transitions
        expect(stateByTick).toEqual([
            { tick: 0, state: 101 },  // Initial transition
            { tick: 1, state: 102 },  // First iteration starts
            { tick: 2, state: 101 },  // Back to start
            { tick: 3, state: 102 },  // Second iteration starts
            { tick: 4, state: 101 },  // Back to start
            { tick: 5, state: 102 },
            { tick: 6, state: GAME_STATE_END }  // Exit repeat
        ]);
    });

    test('handles repeat with single internal transition and completion condition', () => {
        const actionLog: string[] = [];
        let roundCount: number = 0;
        
        const config: TransitionConfig<World<WorldContext>>[] = [
            {
                from: GAME_STATE_INIT, to: 101,
                when: () => roundCount < 3,
                execute: () => {
                    actionLog.push('repeat-execute');
                    roundCount++;
                },
                repeat: { times: 2 },
                transitions: [
                    {
                        from: 101, to: 101,
                        when: () => true,
                        execute: () => {
                            actionLog.push('round-complete');
                            roundCount++;
                        }
                    }
                ]
            },
            {
                from: 101, to: GAME_STATE_END,
                when: () => roundCount === 3,
                execute: () => actionLog.push('game-complete')
            }
        ];

        createGameStateSystem(world, config);

        // Run system multiple times
        for (let i = 0; i <= 3; i++) {
            world.systems.GameState(world);
            logStateChange(i, getGameState(world));
        }

        // Verify execution sequence
        expect(actionLog).toEqual([
            'repeat-execute',   // Initial repeat trigger
            'round-complete',   // First internal transition
            'round-complete',   // Second internal transition
            'game-complete'     // Final transition
        ]);

        // Verify state transitions per tick
        expect(stateByTick).toEqual([
            { tick: 0, state: 101 },    // Repeat triggers, sets initial state
            { tick: 1, state: 101 },    // First internal transition
            { tick: 2, state: 101 },    // Second internal transition
            { tick: 3, state: GAME_STATE_END }  // Final transition
        ]);
    });
    */
});

/*
describe('GameStateSystem - simple transitions', () => {
    let world: World<WorldContext>;
    let transitionLog: string[];
    let stateByTick: Array<{ tick: number, state: number }>;

    beforeEach(() => {
        world = createWorld({}) as World<WorldContext>;
        transitionLog = [];
        stateByTick = [];
    });

    const logStateChange = (tick: number, state: number) => {
        stateByTick.push({ tick, state });
    };

    test('executes transitions in priority order', () => {
        const config: TransitionConfig<World<WorldContext>>[] = [
            { from: GAME_STATE_INIT, to: 101, execute: () => transitionLog.push('init->101') },
            { from: 101, to: 102, execute: () => transitionLog.push('101->102') },
            { from: 101, to: 103, execute: () => transitionLog.push('101->103') } // Should never execute
        ];

        createGameStateSystem(world, config);

        for (let i = 0; i < 2; i++) {
            world.systems.GameState(world);
            logStateChange(i, getGameState(world));
        }

        expect(transitionLog).toEqual(['init->101', '101->102']);
        expect(getGameState(world)).toBe(102);

        expect(stateByTick).toEqual([
            { tick: 0, state: 101 },  // Initial transition
            { tick: 1, state: 102 }   // Second transition
        ]);
    });

    test('respects when conditions', () => {
        let condition = false;
        const config: TransitionConfig<World<WorldContext>>[] = [
            { from: GAME_STATE_INIT, to: 101, execute: () => transitionLog.push('init->101') },
            { 
                from: 101, 
                to: 102, 
                when: () => condition,
                execute: () => transitionLog.push('101->102') 
            }
        ];

        createGameStateSystem(world, config);

        for (let i = 0; i < 3; i++) {
            if (i === 2) condition = true;
            world.systems.GameState(world);
            logStateChange(i, getGameState(world));
        }

        expect(transitionLog).toEqual(['init->101', '101->102']);
        expect(getGameState(world)).toBe(102);

        expect(stateByTick).toEqual([
            { tick: 0, state: 101 },  // Initial transition
            { tick: 1, state: 101 },
            { tick: 2, state: 102 }   // Delayed transition after condition becomes true
        ]);
    });

    test('handles no valid transitions - from state mismatch', () => {
        const config: TransitionConfig<World<WorldContext>>[] = [
            { from: GAME_STATE_INIT, to: 101 },
            { from: 102, to: 103 } // No transition from 101
        ];

        createGameStateSystem(world, config);

        for (let i = 0; i < 2; i++) {
            world.systems.GameState(world);
            logStateChange(i, getGameState(world));
        }

        expect(stateByTick).toEqual([
            { tick: 0, state: 101 },  // Only initial transition
            { tick: 1, state: 101 }   // No valid transitions
        ]);
    });

    test('handles no valid transitions - when condition failure', () => {
        const condition = () => false;
        const action = () => {}; // Replace jest.fn() with simple function
        let actionCalled = false;
        
        const config: TransitionConfig<World<WorldContext>>[] = [
            { 
                from: GAME_STATE_INIT, 
                to: 101, 
                when: condition, 
                execute: () => actionCalled = true 
            }
        ];

        createGameStateSystem(world, config);
        const initialState = getGameState(world);
        
        for (let i = 0; i < 1; i++) {
            world.systems.GameState(world);
            logStateChange(i, getGameState(world));
        }

        expect(getGameState(world)).toBe(initialState);
        expect(actionCalled).toBe(false);
    });
});

*/
