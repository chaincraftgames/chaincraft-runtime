import type { GameSession, GameConfig, GameState, Gamepiece, InventoryConfig } from '#chaincraft/types.js';
import { projectStateForPlayer } from '#chaincraft/state/projection.js';
import type { ProjectedState, ProjectedInventory } from '#chaincraft/state/projection.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<GameConfig>): GameConfig {
  return {
    inventories: {
      deck: { structure: 'stack', scope: 'game', visibility: 'never', accepts: ['card'] },
      hand: { structure: 'none', scope: 'player', visibility: 'owner', accepts: ['card'] },
      discard: { structure: 'stack', scope: 'game', visibility: 'always', accepts: ['card'] },
      field: { structure: 'none', scope: 'player', visibility: 'always', accepts: ['token'] },
      secret: { structure: 'none', scope: 'game', visibility: 'count-only', accepts: ['card'] },
    },
    gamepieceTypes: {
      card: {
        category: 'card',
        hasFaceState: true,
        properties: {
          suit: { mutable: false, visibility: 'revealed' },
          rank: { mutable: false, visibility: 'revealed' },
          backColor: { mutable: false, visibility: 'always' },
          internalFlag: { mutable: true, visibility: 'never' },
        },
      },
      token: {
        category: 'token',
        properties: {
          value: { mutable: true, visibility: 'always' },
          secretAbility: { mutable: false, visibility: 'owner' },
        },
      },
    },
    gameProperties: {
      currentRound: { mutable: true },
      pot: { mutable: true },
    },
    playerProperties: {
      score: { mutable: true, visibility: 'public' },
      secretBid: { mutable: true, visibility: 'private' },
      role: { mutable: true, refType: 'player-role-id', visibility: 'public' },
    },
    playerCount: { min: 2, max: 4 },
    roles: ['dealer', 'mafia', 'villager'],
    roleVisibility: { dealer: 'public', mafia: 'hidden', villager: 'public' },
    ...overrides,
  };
}

function makeCard(id: string, suit: string, rank: string, overrides?: Partial<Gamepiece>): Gamepiece {
  return {
    typeId: 'card',
    ownerId: 'game',
    properties: { suit, rank, backColor: 'blue', internalFlag: false },
    faceUp: false,
    exhausted: false,
    visibleTo: null,
    ...overrides,
  };
}

function makeToken(owner: string, value: number, ability: string, overrides?: Partial<Gamepiece>): Gamepiece {
  return {
    typeId: 'token',
    ownerId: owner,
    properties: { value, secretAbility: ability },
    faceUp: true,
    exhausted: false,
    visibleTo: null,
    ...overrides,
  };
}

function makeState(overrides?: Partial<GameState>): GameState {
  return {
    gameProperties: { currentRound: 1, pot: 100 },
    gameInventories: {
      deck: { structure: 'stack', pieceIds: ['c1', 'c2', 'c3'] },
      discard: { structure: 'stack', pieceIds: ['c4'] },
      secret: { structure: 'none', pieceIds: ['c5', 'c6'] },
    },
    players: {
      alice: {
        roles: ['dealer'],
        properties: { score: 10, secretBid: 5, role: 'dealer' },
        inventories: {
          hand: { structure: 'none', pieceIds: ['c7', 'c8'] },
          field: { structure: 'none', pieceIds: ['t1'] },
        },
      },
      bob: {
        roles: ['mafia'],
        properties: { score: 8, secretBid: 3, role: 'mafia' },
        inventories: {
          hand: { structure: 'none', pieceIds: ['c9', 'c10'] },
          field: { structure: 'none', pieceIds: ['t2'] },
        },
      },
    },
    gamepieces: {
      c1: makeCard('c1', 'hearts', 'A'),
      c2: makeCard('c2', 'spades', 'K'),
      c3: makeCard('c3', 'diamonds', '10'),
      c4: makeCard('c4', 'clubs', 'J', { faceUp: true }),
      c5: makeCard('c5', 'hearts', '2'),
      c6: makeCard('c6', 'spades', '3'),
      c7: makeCard('c7', 'hearts', 'Q', { ownerId: 'alice' }),
      c8: makeCard('c8', 'diamonds', 'K', { ownerId: 'alice' }),
      c9: makeCard('c9', 'clubs', 'A', { ownerId: 'bob' }),
      c10: makeCard('c10', 'spades', '5', { ownerId: 'bob' }),
      t1: makeToken('alice', 3, 'shield'),
      t2: makeToken('bob', 5, 'attack'),
    },
    ...overrides,
  };
}

function makeSession(overrides?: {
  config?: Partial<GameConfig>;
  state?: Partial<GameState>;
}): GameSession {
  return {
    gameId: 'test-game',
    specId: 'test-spec',
    config: makeConfig(overrides?.config),
    state: makeState(overrides?.state),
    players: ['alice', 'bob'],
    outbox: [],
    rng: { nextFloat: () => 0.5 },
    _inventoryCache: new Map(),
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('projectStateForPlayer', () => {
  // -------------------------------------------------------------------------
  // Game properties
  // -------------------------------------------------------------------------

  describe('game properties', () => {
    it('includes all game properties (always public)', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gameProperties).toEqual({ currentRound: 1, pot: 100 });
    });
  });

  // -------------------------------------------------------------------------
  // Inventory visibility
  // -------------------------------------------------------------------------

  describe('inventory visibility', () => {
    it('hides "never" inventories completely', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gameInventories['deck']).toEqual({ redacted: 'hidden' });
    });

    it('shows "always" inventories fully', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gameInventories['discard']).toEqual({ structure: 'stack', pieceIds: ['c4'] });
    });

    it('shows count-only for "count-only" inventories', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gameInventories['secret']).toEqual({ redacted: 'count-only', count: 2 });
    });

    it('shows "owner" inventory fully to the owner', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.players['alice'].inventories['hand']).toEqual({
        structure: 'none',
        pieceIds: ['c7', 'c8'],
      });
    });

    it('shows "owner" inventory as count-only to non-owners', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.players['bob'].inventories['hand']).toEqual({ redacted: 'count-only', count: 2 });
    });

    it('shows "always" player inventories to all', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'bob');
      expect(view.players['alice'].inventories['field']).toEqual({
        structure: 'none',
        pieceIds: ['t1'],
      });
    });
  });

  // -------------------------------------------------------------------------
  // Piece visibility (based on inventory)
  // -------------------------------------------------------------------------

  describe('piece visibility — inventory-based', () => {
    it('omits pieces in "never" inventories', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gamepieces['c1']).toBeUndefined();
      expect(view.gamepieces['c2']).toBeUndefined();
      expect(view.gamepieces['c3']).toBeUndefined();
    });

    it('omits pieces in "count-only" inventories', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gamepieces['c5']).toBeUndefined();
      expect(view.gamepieces['c6']).toBeUndefined();
    });

    it('includes pieces in "always" inventories', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gamepieces['c4']).toBeDefined();
      expect(view.gamepieces['c4'].typeId).toBe('card');
    });

    it('includes pieces in "owner" inventories for the owner', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gamepieces['c7']).toBeDefined();
      expect(view.gamepieces['c8']).toBeDefined();
    });

    it('omits pieces in "owner" inventories for non-owners', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gamepieces['c9']).toBeUndefined();
      expect(view.gamepieces['c10']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Piece visibility — explicit visibleTo override
  // -------------------------------------------------------------------------

  describe('piece visibility — visibleTo override', () => {
    it('shows piece to viewer when visibleTo includes them', () => {
      const session = makeSession();
      // c1 is in the deck (visibility: never) but has an explicit override
      session.state.gamepieces['c1'].visibleTo = ['alice'];
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gamepieces['c1']).toBeDefined();
    });

    it('hides piece from viewer when visibleTo excludes them', () => {
      const session = makeSession();
      session.state.gamepieces['c1'].visibleTo = ['bob'];
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gamepieces['c1']).toBeUndefined();
    });

    it('shows piece to all when visibleTo is "all"', () => {
      const session = makeSession();
      session.state.gamepieces['c1'].visibleTo = 'all';
      const alice = projectStateForPlayer(session, 'alice');
      const bob = projectStateForPlayer(session, 'bob');
      expect(alice.gamepieces['c1']).toBeDefined();
      expect(bob.gamepieces['c1']).toBeDefined();
    });

    it('visibleTo override takes priority over inventory visibility', () => {
      const session = makeSession();
      // c9 is in bob's hand (visibility: owner) but explicitly revealed to alice
      session.state.gamepieces['c9'].visibleTo = ['alice', 'bob'];
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gamepieces['c9']).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Piece property visibility
  // -------------------------------------------------------------------------

  describe('piece property visibility', () => {
    it('always-visible properties shown regardless of face state', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      // c4 is in discard (always visible)
      expect(view.gamepieces['c4'].properties['backColor']).toBe('blue');
    });

    it('revealed properties shown when piece is face-up', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      // c4 is face-up
      expect(view.gamepieces['c4'].properties['suit']).toBe('clubs');
      expect(view.gamepieces['c4'].properties['rank']).toBe('J');
    });

    it('revealed properties hidden when piece is face-down', () => {
      const session = makeSession();
      // c7 is in alice's hand (visible to alice) but face-down
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gamepieces['c7'].properties['suit']).toBeUndefined();
      expect(view.gamepieces['c7'].properties['rank']).toBeUndefined();
      expect(view.gamepieces['c7'].properties['backColor']).toBe('blue');
    });

    it('owner-only properties shown to piece owner', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      // t1 is alice's token on the always-visible field
      expect(view.gamepieces['t1'].properties['secretAbility']).toBe('shield');
    });

    it('owner-only properties hidden from non-owners', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      // t2 is bob's token on the always-visible field
      expect(view.gamepieces['t2'].properties['secretAbility']).toBeUndefined();
      expect(view.gamepieces['t2'].properties['value']).toBe(5);
    });

    it('never-visible properties hidden from everyone', () => {
      const session = makeSession();
      const aliceView = projectStateForPlayer(session, 'alice');
      const bobView = projectStateForPlayer(session, 'bob');
      // c4 is visible in discard, but internalFlag is visibility: never
      expect(aliceView.gamepieces['c4'].properties['internalFlag']).toBeUndefined();
      expect(bobView.gamepieces['c4'].properties['internalFlag']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Player property visibility
  // -------------------------------------------------------------------------

  describe('player property visibility', () => {
    it('public player properties shown to everyone', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.players['bob'].properties['score']).toBe(8);
    });

    it('private player properties shown to owner', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.players['alice'].properties['secretBid']).toBe(5);
    });

    it('private player properties hidden from others', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      expect(view.players['bob'].properties['secretBid']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Role visibility
  // -------------------------------------------------------------------------

  describe('role visibility', () => {
    it('public roles visible to everyone', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'bob');
      // alice's role is 'dealer' which is public
      expect(view.players['alice'].properties['role']).toBe('dealer');
    });

    it('hidden roles visible to the holder', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'bob');
      // bob's role is 'mafia' which is hidden — bob can see it
      expect(view.players['bob'].properties['role']).toBe('mafia');
    });

    it('hidden roles hidden from other players', () => {
      const session = makeSession();
      const view = projectStateForPlayer(session, 'alice');
      // bob's role is 'mafia' which is hidden — alice cannot see it
      expect(view.players['bob'].properties['role']).toBeUndefined();
    });

    it('roles default to public when roleVisibility is not configured', () => {
      const session = makeSession({
        config: { roleVisibility: undefined },
      });
      const view = projectStateForPlayer(session, 'alice');
      expect(view.players['bob'].properties['role']).toBe('mafia');
    });

    it('roles default to public for unlisted role IDs', () => {
      const session = makeSession({
        config: { roleVisibility: { dealer: 'public' } }, // mafia not listed
      });
      const view = projectStateForPlayer(session, 'alice');
      expect(view.players['bob'].properties['role']).toBe('mafia');
    });
  });

  // -------------------------------------------------------------------------
  // Grid / Line / Graph inventories
  // -------------------------------------------------------------------------

  describe('structured inventories', () => {
    it('handles line inventories with count-only', () => {
      const session = makeSession({
        config: {
          inventories: {
            ...makeConfig().inventories,
            board: { structure: 'line', scope: 'game', visibility: 'count-only', accepts: ['token'] },
          },
        },
        state: {
          ...makeState(),
          gameInventories: {
            ...makeState().gameInventories,
            board: { structure: 'line', slots: ['t-a', null, 't-b', null] },
          },
        },
      });
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gameInventories['board']).toEqual({ redacted: 'count-only', count: 2 });
    });

    it('handles grid inventories with owner visibility', () => {
      const session = makeSession({
        config: {
          inventories: {
            ...makeConfig().inventories,
            privateboard: { structure: 'grid', scope: 'player', visibility: 'owner', accepts: ['token'] },
          },
        },
        state: {
          ...makeState(),
          players: {
            ...makeState().players,
            alice: {
              ...makeState().players.alice,
              inventories: {
                ...makeState().players.alice.inventories,
                privateboard: { structure: 'grid', cells: { '0:0': 't1', '0:1': null, '1:0': null } },
              },
            },
          },
        },
      });
      const aliceView = projectStateForPlayer(session, 'alice');
      const bobView = projectStateForPlayer(session, 'bob');
      expect(aliceView.players['alice'].inventories['privateboard']).toEqual({
        structure: 'grid',
        cells: { '0:0': 't1', '0:1': null, '1:0': null },
      });
      expect(bobView.players['alice'].inventories['privateboard']).toEqual({
        redacted: 'count-only', count: 1,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles pieces not found in any inventory gracefully (assumes visible)', () => {
      const session = makeSession();
      // Add a piece that's not in any inventory
      session.state.gamepieces['orphan'] = {
        typeId: 'token',
        ownerId: 'alice',
        properties: { value: 1, secretAbility: 'none' },
        faceUp: true,
        exhausted: false,
        visibleTo: null,
      };
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gamepieces['orphan']).toBeDefined();
    });

    it('handles empty inventories', () => {
      const session = makeSession({
        state: {
          ...makeState(),
          gameInventories: {
            deck: { structure: 'stack', pieceIds: [] },
            discard: { structure: 'stack', pieceIds: [] },
            secret: { structure: 'none', pieceIds: [] },
          },
        },
      });
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gameInventories['deck']).toEqual({ redacted: 'hidden' });
      expect(view.gameInventories['discard']).toEqual({ structure: 'stack', pieceIds: [] });
      expect(view.gameInventories['secret']).toEqual({ redacted: 'count-only', count: 0 });
    });

    it('handles session with no roles configured', () => {
      const session = makeSession({
        config: { roles: undefined, roleVisibility: undefined },
      });
      const view = projectStateForPlayer(session, 'alice');
      expect(view.players['alice'].properties).toBeDefined();
    });

    it('is deterministic — same inputs produce same output', () => {
      const session = makeSession();
      const view1 = projectStateForPlayer(session, 'alice');
      const view2 = projectStateForPlayer(session, 'alice');
      expect(view1).toEqual(view2);
    });

    it('different viewers see different projections', () => {
      const session = makeSession();
      const aliceView = projectStateForPlayer(session, 'alice');
      const bobView = projectStateForPlayer(session, 'bob');
      // Alice can see her own hand pieces, Bob cannot
      expect(aliceView.gamepieces['c7']).toBeDefined();
      expect(bobView.gamepieces['c7']).toBeUndefined();
      // Bob can see his own hand pieces, Alice cannot
      expect(bobView.gamepieces['c9']).toBeDefined();
      expect(aliceView.gamepieces['c9']).toBeUndefined();
    });

    it('does not mutate the original session state', () => {
      const session = makeSession();
      const original = JSON.parse(JSON.stringify(session.state));
      projectStateForPlayer(session, 'alice');
      expect(session.state).toEqual(original);
    });
  });

  // -------------------------------------------------------------------------
  // Social deduction scenario
  // -------------------------------------------------------------------------

  describe('social deduction scenario', () => {
    function makeSocialDeductionSession(): GameSession {
      const config = makeConfig({
        playerProperties: {
          score: { mutable: true, visibility: 'public' },
          secretBid: { mutable: true, visibility: 'private' },
          role: { mutable: true, refType: 'player-role-id', visibility: 'public' },
          allegiance: { mutable: false, refType: 'player-role-id', visibility: 'private' },
        },
        roles: ['mafia', 'villager', 'detective'],
        roleVisibility: { mafia: 'hidden', villager: 'hidden', detective: 'hidden' },
      });

      const state = makeState({
        players: {
          alice: {
            roles: ['villager'],
            properties: { score: 0, secretBid: 0, role: 'villager', allegiance: 'villager' },
            inventories: { hand: { structure: 'none', pieceIds: [] }, field: { structure: 'none', pieceIds: [] } },
          },
          bob: {
            roles: ['mafia'],
            properties: { score: 0, secretBid: 0, role: 'mafia', allegiance: 'mafia' },
            inventories: { hand: { structure: 'none', pieceIds: [] }, field: { structure: 'none', pieceIds: [] } },
          },
          carol: {
            roles: ['detective'],
            properties: { score: 0, secretBid: 0, role: 'detective', allegiance: 'villager' },
            inventories: { hand: { structure: 'none', pieceIds: [] }, field: { structure: 'none', pieceIds: [] } },
          },
        },
      });

      return {
        gameId: 'test-game',
        specId: 'test-spec',
        config,
        state,
        players: ['alice', 'bob', 'carol'],
        outbox: [],
        rng: { nextFloat: () => 0.5 },
        _inventoryCache: new Map(),
      };
    }

    it('no one sees other players hidden roles', () => {
      const session = makeSocialDeductionSession();
      const aliceView = projectStateForPlayer(session, 'alice');
      expect(aliceView.players['bob'].properties['role']).toBeUndefined();
      expect(aliceView.players['carol'].properties['role']).toBeUndefined();
    });

    it('each player sees their own hidden role', () => {
      const session = makeSocialDeductionSession();
      const aliceView = projectStateForPlayer(session, 'alice');
      const bobView = projectStateForPlayer(session, 'bob');
      expect(aliceView.players['alice'].properties['role']).toBe('villager');
      expect(bobView.players['bob'].properties['role']).toBe('mafia');
    });

    it('private properties with role refs are doubly protected', () => {
      const session = makeSocialDeductionSession();
      const aliceView = projectStateForPlayer(session, 'alice');
      // alice can see her own allegiance (private + she is the owner)
      expect(aliceView.players['alice'].properties['allegiance']).toBe('villager');
      // alice cannot see bob's allegiance (private blocks it)
      expect(aliceView.players['bob'].properties['allegiance']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Same-role visibility
  // -------------------------------------------------------------------------

  describe('same-role visibility', () => {
    function makeSameRoleSession(): GameSession {
      const config = makeConfig({
        playerProperties: {
          score: { mutable: true, visibility: 'public' },
          role: { mutable: true, refType: 'player-role-id', visibility: 'public' },
          mafiaTarget: { mutable: true, visibility: 'same-role' },
        },
        roles: ['mafia', 'villager'],
        roleVisibility: { mafia: 'hidden', villager: 'public' },
      });

      const state = makeState({
        players: {
          alice: {
            roles: ['mafia'],
            properties: { score: 0, role: 'mafia', mafiaTarget: 'carol' },
            inventories: { hand: { structure: 'none', pieceIds: [] }, field: { structure: 'none', pieceIds: [] } },
          },
          bob: {
            roles: ['mafia'],
            properties: { score: 0, role: 'mafia', mafiaTarget: 'carol' },
            inventories: { hand: { structure: 'none', pieceIds: [] }, field: { structure: 'none', pieceIds: [] } },
          },
          carol: {
            roles: ['villager'],
            properties: { score: 0, role: 'villager', mafiaTarget: '' },
            inventories: { hand: { structure: 'none', pieceIds: [] }, field: { structure: 'none', pieceIds: [] } },
          },
        },
      });

      return {
        gameId: 'test-game',
        specId: 'test-spec',
        config,
        state,
        players: ['alice', 'bob', 'carol'],
        outbox: [],
        rng: { nextFloat: () => 0.5 },
        _inventoryCache: new Map(),
      };
    }

    it('same-role players can see each other\'s same-role properties', () => {
      const session = makeSameRoleSession();
      const aliceView = projectStateForPlayer(session, 'alice');
      // alice (mafia) can see bob's (mafia) mafiaTarget
      expect(aliceView.players['bob'].properties['mafiaTarget']).toBe('carol');
    });

    it('different-role players cannot see same-role properties', () => {
      const session = makeSameRoleSession();
      const carolView = projectStateForPlayer(session, 'carol');
      // carol (villager) cannot see alice's (mafia) mafiaTarget
      expect(carolView.players['alice'].properties['mafiaTarget']).toBeUndefined();
      expect(carolView.players['bob'].properties['mafiaTarget']).toBeUndefined();
    });

    it('player always sees their own same-role properties', () => {
      const session = makeSameRoleSession();
      const carolView = projectStateForPlayer(session, 'carol');
      // carol can see her own mafiaTarget even though no one shares her role for this prop
      expect(carolView.players['carol'].properties['mafiaTarget']).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Face-up cards in hand (revealed-property behavior)
  // -------------------------------------------------------------------------

  describe('revealed property with face-up piece in owner inventory', () => {
    it('owner sees revealed properties of their face-up cards', () => {
      const session = makeSession();
      session.state.gamepieces['c7'].faceUp = true;
      const view = projectStateForPlayer(session, 'alice');
      expect(view.gamepieces['c7'].properties['suit']).toBe('hearts');
      expect(view.gamepieces['c7'].properties['rank']).toBe('Q');
    });

    it('non-owner cannot see pieces in owner-only inventory even if face-up', () => {
      const session = makeSession();
      session.state.gamepieces['c7'].faceUp = true;
      const view = projectStateForPlayer(session, 'bob');
      // bob can't see c7 at all (it's in alice's owner-only hand)
      expect(view.gamepieces['c7']).toBeUndefined();
    });
  });
});
