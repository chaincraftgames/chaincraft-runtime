# ChainCraft Runtime — Execution Design

This document describes how the runtime executes a compiled game module: how
turns are orchestrated, how actions are resolved, how effects and inputs are
processed, and how the system suspends and resumes across external interactions.

---

## Module structure

The orchestration layer lives in `src/orchestration/` and is composed of five
focused modules:

| Module | Responsibility |
|---|---|
| `flow-runner.ts` | Walks the flow tree (game/loop/turn nodes). Decides structure: phases, hooks, when to fork, when to pop. No queue processing. |
| `turn-order.ts` | Resolves which players are eligible to act next, given an ordering strategy. Stub — most ordering variants are unimplemented. |
| `grammar.ts` | Pure cursor/grammar queries: what actions are legal (`resolveLegalActions`), how to advance after a response (`advanceGrammarCursor`). No engine types. |
| `player-effects-resolver.ts` | Bridges grammar and engine mechanics. Given a cursor position, produces the next unit of work (queue items or a suspension descriptor). Does not execute or mutate state. |
| `effects-controller.ts` | The drain loop. Executes queue items, routes suspensions to the host, manages fork/join. The only module that mutates `EngineState`. |

---

## Queue scopes

There are two distinct queue scopes; the effects controller owns both.

### Game-level queue (`state.queue`)

Always active. Contains hook effects (`onEnter`, `onComplete`), join-phase
effects, and future game-wide bookkeeping effects. Input items in this queue
must be auto-resolvable (`effect-originator`, `trigger-input`) — game-level
hooks must never prompt a player directly.

### Player queues (`state.playerRunners[playerId].queue`)

Active only during a turn node's acting phase (fork mode). Each eligible player
gets their own isolated queue, drained independently. Items are produced by the
player-effects-resolver.

**Player queue items never flow into the game-level queue.** The two scopes are
entirely separate. Completion is signaled by a boolean flag (`runner.done`), not
by item transfer.

---

## The drain loop

`drainQueue(state, queue, ctx, module)` is the shared inner loop. It processes
items from the given queue until empty, then calls a `DrainContext` callback.
The callback's return value — a `DrainSignal` — tells the loop what to do next:

```
DrainSignal:
  continue     — new items were pushed; keep draining
  prompt       — suspend and return this suspension to the host
  complete     — game over
  runner-done  — this player's runner finished; trigger join check
```

The `DrainContext` has two callbacks that encode the branching between contexts:

| Callback | Game-level | Player-runner |
|---|---|---|
| `onEmpty()` | Calls `advanceFlow` on the flow tree | Calls `nextRunnerWork` for this player |
| `onPlayerInputNeeded()` | Throws — design error | Stores suspension on `runner.pending`, returns prompt signal |

---

## Turn execution: fork and join

When the flow runner reaches a turn node's acting phase, it returns a `fork`
result containing one `ForkRunnerInit` per eligible player. The effects
controller handles this as follows:

### Fork

1. `initPlayerRunners` populates `state.playerRunners` from the fork inits.
   Each `PlayerRunnerState` holds an empty queue, a `pending` slot, a `done`
   flag, and a shared cursor reference back into the flow frame.
2. `drainAllRunners` iterates runners and calls `drainPlayerRunner` on each
   that isn't already done or suspended.
3. Each runner's `DrainContext.onEmpty` calls `nextRunnerWork`, which consults
   the grammar and cursor to determine the first unit of work:
   - **Singleton actions / no pass** → no decision; explode the action into
     queue items and advance the cursor immediately.
   - **Choice / pass legal** → produce an action-select suspension.

### Player response

When the host delivers a `PlayerInput`, `step()` detects fork mode
(`state.playerRunners !== null`) and routes by `input.playerId`:

- If the pending suspension is an **action-select**: advance the grammar cursor
  (`advanceGrammarCursor`), then explode the chosen action's items onto the
  runner's queue if the player acted (not passed). Then drain the runner.
- If the pending suspension is a **queue-level input** (data collection for an
  in-progress action's input field): write the value into `group.collected`,
  clear the pending, then drain the runner.

### Join

After each runner drain completes, the effects controller checks whether all
runners have `done: true`. If so:

1. `state.playerRunners` is set to `null`.
2. `drainGameLevel` is called — the game-level `onEmpty` callback calls
   `advanceFlow`, which sees all cursors done and advances to complete-hooks or
   pops the turn frame.

---

## Suspension contract

**Suspensions are always surfaced by the effects controller, never by the
player-effects-resolver directly.** The resolver returns a `RunnerWork` value
describing what the suspension should be. The controller:

1. Sets `runner.pending = { suspension }`.
2. Returns a `DrainSignal { kind: 'prompt', suspension }`.
3. This propagates up through `drainPlayerRunner` → `step()` → host as a
   `StepResult { kind: 'prompt', prompt: suspension }`.

All state mutation and prompt delivery live in the effects controller. The
resolver is pure.

---

## Anti-cheat validation

All submitted player values are validated in `validatePlayerInput` before any
state is mutated:

- **Action-select responses** must be `{ kind: 'act', actionId }` or
  `{ kind: 'pass' }`. The `actionId` must appear in the suspension's `actions`
  list; `pass` is only accepted when `canPass: true`.
- **Generic input responses** are validated against `suspension.options` when
  that field is non-empty (finite-choice inputs like target selection).
- Free-form inputs (numeric ranges, text) have no options list and are accepted
  as-is at this layer; semantic validation is the effect executor's concern.

---

## Pending work / known gaps

- **Custom turn ordering** (`ordering.kind === 'custom'`): resolver lookup not implemented.
- **Role-based actor resolution**: role → player ID mapping not implemented.
- **Round-robin ordering extensions**: `startPath`, `reversedPath` (snake-draft), `sort` not implemented.
- **Suspending effects** (LLM, external-data): `executeEffectItem` throws for non-executor registrations. Requires widening `EffectExecutor` return type and handling the suspend-on-effect branch in `drainQueue`.
- **LLM/external-data resume**: `applyGameLevelResume` clears the pending but doesn't deliver `response.result` to the awaiting effect via `group.collected`.
- **Precondition filtering**: `nextRunnerWork` calls `resolveLegalActions` which returns the structural action set. Filtering by game-state preconditions is a TODO in `player-effects-resolver.ts`.
- **Reaction windows**: not yet implemented. See architecture decisions in Copilot memory for design options and rationale. Short summary: changes are additive; existing `QueueGroup.originatorId`, `triggerInputs`, `effect-originator`/`trigger-input` auto-inputs, and `PlayerInputSuspension.awaiting[]` already support the feature. Interception point is the `TODO` in `drainQueue`.
