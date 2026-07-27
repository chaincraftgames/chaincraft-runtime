// ---------------------------------------------------------------------------
// Grammar unit tests
//
// Covers all grammar kinds for both public exports:
//   - resolveLegalActions  — what can the player do at this cursor position?
//   - advanceGrammarCursor — move the cursor after an action or pass.
// ---------------------------------------------------------------------------

import type { Grammar } from '#chaincraft/types.js';
import type { PlayerTurnCursor } from '../types.js';
import { resolveLegalActions, advanceGrammarCursor } from '../grammar.js';

function cursor(sequenceIndex = 0, repeatCount = 0): PlayerTurnCursor {
  return { sequenceIndex, repeatCount, done: false };
}

// ---------------------------------------------------------------------------
// resolveLegalActions
// ---------------------------------------------------------------------------

describe('resolveLegalActions', () => {
  describe('action', () => {
    it('returns the single ref with canPass=false', () => {
      const g: Grammar = { kind: 'action', ref: 'play-card' };
      expect(resolveLegalActions(g, cursor())).toEqual({
        actions: ['play-card'],
        canPass: false,
      });
    });
  });

  describe('choice', () => {
    it('returns all actions with canPass=false when not passable', () => {
      const g: Grammar = { kind: 'choice', actions: ['rock', 'paper', 'scissors'] };
      expect(resolveLegalActions(g, cursor())).toEqual({
        actions: ['rock', 'paper', 'scissors'],
        canPass: false,
      });
    });

    it('returns canPass=true when passable:true', () => {
      const g: Grammar = { kind: 'choice', actions: ['play-card'], passable: true };
      expect(resolveLegalActions(g, cursor())).toEqual({
        actions: ['play-card'],
        canPass: true,
      });
    });
  });

  describe('sequence', () => {
    it('returns the current step only', () => {
      const g: Grammar = { kind: 'sequence', actions: ['pick-target', 'confirm'] };
      expect(resolveLegalActions(g, cursor(0))).toEqual({
        actions: ['pick-target'],
        canPass: false,
      });
      expect(resolveLegalActions(g, cursor(1))).toEqual({
        actions: ['confirm'],
        canPass: false,
      });
    });
  });

  describe('repeat — fixed count', () => {
    it('returns body actions with canPass=false regardless of repeatCount', () => {
      const g: Grammar = { kind: 'repeat', body: { kind: 'choice', actions: ['draw'] }, count: 3 };
      expect(resolveLegalActions(g, cursor(0, 0))).toEqual({ actions: ['draw'], canPass: false });
      expect(resolveLegalActions(g, cursor(0, 2))).toEqual({ actions: ['draw'], canPass: false });
    });
  });

  describe('repeat — until-pass', () => {
    it('always returns canPass=true regardless of body passable', () => {
      // body is NOT passable — pass is owned by the count, not the body
      const g: Grammar = {
        kind: 'repeat',
        body: { kind: 'choice', actions: ['play-card'] },
        count: 'until-pass',
      };
      expect(resolveLegalActions(g, cursor(0, 0))).toEqual({ actions: ['play-card'], canPass: true });
      expect(resolveLegalActions(g, cursor(0, 5))).toEqual({ actions: ['play-card'], canPass: true });
    });
  });

  describe('repeat — range', () => {
    it('canPass=false below min', () => {
      const g: Grammar = {
        kind: 'repeat',
        body: { kind: 'action', ref: 'draw' },
        count: { min: 2, max: 4 },
      };
      expect(resolveLegalActions(g, cursor(0, 0))).toEqual({ actions: ['draw'], canPass: false });
      expect(resolveLegalActions(g, cursor(0, 1))).toEqual({ actions: ['draw'], canPass: false });
    });

    it('canPass=true at and above min', () => {
      const g: Grammar = {
        kind: 'repeat',
        body: { kind: 'action', ref: 'draw' },
        count: { min: 2, max: 4 },
      };
      expect(resolveLegalActions(g, cursor(0, 2))).toEqual({ actions: ['draw'], canPass: true });
      expect(resolveLegalActions(g, cursor(0, 3))).toEqual({ actions: ['draw'], canPass: true });
    });

    it('canPass=true from the start when no min specified (default 0)', () => {
      const g: Grammar = {
        kind: 'repeat',
        body: { kind: 'action', ref: 'draw' },
        count: { max: 3 },
      };
      expect(resolveLegalActions(g, cursor(0, 0))).toEqual({ actions: ['draw'], canPass: true });
    });
  });
});

// ---------------------------------------------------------------------------
// advanceGrammarCursor
// ---------------------------------------------------------------------------

describe('advanceGrammarCursor', () => {
  describe('action', () => {
    it('marks done immediately', () => {
      const g: Grammar = { kind: 'action', ref: 'play-card' };
      const c = cursor();
      advanceGrammarCursor(c, g, false, 'play-card');
      expect(c.done).toBe(true);
    });
  });

  describe('choice', () => {
    it('marks done on act', () => {
      const g: Grammar = { kind: 'choice', actions: ['rock', 'paper'] };
      const c = cursor();
      advanceGrammarCursor(c, g, false, 'rock');
      expect(c.done).toBe(true);
    });

    it('marks done on pass', () => {
      const g: Grammar = { kind: 'choice', actions: ['rock'], passable: true };
      const c = cursor();
      advanceGrammarCursor(c, g, true);
      expect(c.done).toBe(true);
    });
  });

  describe('sequence', () => {
    it('increments sequenceIndex and is not done until the last step', () => {
      const g: Grammar = { kind: 'sequence', actions: ['a', 'b', 'c'] };
      const c = cursor();

      advanceGrammarCursor(c, g, false, 'a');
      expect(c.sequenceIndex).toBe(1);
      expect(c.done).toBe(false);

      advanceGrammarCursor(c, g, false, 'b');
      expect(c.sequenceIndex).toBe(2);
      expect(c.done).toBe(false);

      advanceGrammarCursor(c, g, false, 'c');
      expect(c.sequenceIndex).toBe(3);
      expect(c.done).toBe(true);
    });
  });

  describe('repeat — fixed count', () => {
    it('increments repeatCount and marks done at exactly count', () => {
      const g: Grammar = { kind: 'repeat', body: { kind: 'action', ref: 'draw' }, count: 3 };
      const c = cursor();

      advanceGrammarCursor(c, g, false, 'draw');
      expect(c.repeatCount).toBe(1);
      expect(c.done).toBe(false);

      advanceGrammarCursor(c, g, false, 'draw');
      expect(c.repeatCount).toBe(2);
      expect(c.done).toBe(false);

      advanceGrammarCursor(c, g, false, 'draw');
      expect(c.repeatCount).toBe(3);
      expect(c.done).toBe(true);
    });
  });

  describe('repeat — until-pass', () => {
    it('increments repeatCount while acting, marks done on pass', () => {
      const g: Grammar = {
        kind: 'repeat',
        body: { kind: 'choice', actions: ['play'] },
        count: 'until-pass',
      };
      const c = cursor();

      advanceGrammarCursor(c, g, false, 'play');
      expect(c.repeatCount).toBe(1);
      expect(c.done).toBe(false);

      advanceGrammarCursor(c, g, false, 'play');
      expect(c.repeatCount).toBe(2);
      expect(c.done).toBe(false);

      advanceGrammarCursor(c, g, true); // pass
      expect(c.done).toBe(true);
      expect(c.repeatCount).toBe(2); // not incremented on pass
    });
  });

  describe('repeat — range', () => {
    it('increments repeatCount while acting, marks done at max', () => {
      const g: Grammar = {
        kind: 'repeat',
        body: { kind: 'action', ref: 'draw' },
        count: { min: 1, max: 3 },
      };
      const c = cursor();

      advanceGrammarCursor(c, g, false, 'draw');
      expect(c.repeatCount).toBe(1);
      expect(c.done).toBe(false);

      advanceGrammarCursor(c, g, false, 'draw');
      expect(c.repeatCount).toBe(2);
      expect(c.done).toBe(false);

      advanceGrammarCursor(c, g, false, 'draw');
      expect(c.repeatCount).toBe(3);
      expect(c.done).toBe(true);
    });

    it('marks done immediately on pass', () => {
      const g: Grammar = {
        kind: 'repeat',
        body: { kind: 'action', ref: 'draw' },
        count: { min: 1, max: 3 },
      };
      const c = cursor(0, 2); // past min, below max

      advanceGrammarCursor(c, g, true); // pass
      expect(c.done).toBe(true);
      expect(c.repeatCount).toBe(2); // not incremented on pass
    });
  });
});
