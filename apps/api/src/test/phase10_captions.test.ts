import { describe, it, expect } from 'vitest';
import { buildGoalCaptions, GoalContext } from '../services/captions.service';
import { captionsForSegment } from '../services/clipping.pipeline';

const teams = [
  { kit: 'red', color: '#d7262e' },
  { kit: 'white', color: '#f4f4f4' },
];

const goal = (over: Partial<GoalContext> = {}): GoalContext => ({
  number: 2,
  total: 8,
  offsetSec: 14,
  team: 1,
  scoreBefore: [1, 0],
  scoreAfter: [1, 1],
  situation: 'equaliser',
  late: false,
  teams,
  ...over,
});

describe('Phase 10: animated goal captions', () => {
  it('builds hook -> score -> GOAL -> headline -> meme on the clip timeline', () => {
    const cues = buildGoalCaptions({ goal: goal(), clipDurSec: 20, teamNames: { red: 'AC Milan', white: 'Lecce' } });
    expect(cues.map((c) => c.id)).toEqual(['hook', 'score_before', 'score_after', 'goal', 'headline', 'meme']);
    const byId = Object.fromEntries(cues.map((c) => [c.id, c]));
    expect(byId.hook.endSec).toBeLessThanOrEqual(byId.goal.startSec);
    expect(byId.goal.startSec).toBeCloseTo(13.9, 1);
    expect(byId.headline.startSec).toBeGreaterThan(byId.goal.startSec);
    for (const c of cues) {
      expect(c.startSec).toBeGreaterThanOrEqual(0);
      expect(c.endSec).toBeLessThanOrEqual(20);
      expect(c.endSec).toBeGreaterThan(c.startSec);
    }
  });

  it('uses the real teams and running score', () => {
    const cues = buildGoalCaptions({ goal: goal(), clipDurSec: 20, teamNames: { red: 'AC Milan', white: 'Lecce' } });
    const byId = Object.fromEntries(cues.map((c) => [c.id, c]));
    expect(byId.score_before.text).toBe('1 - 0');
    expect(byId.score_after.text).toBe('1 - 1');
    expect(byId.score_after.left?.text).toBe('AC MILAN');
    expect(byId.score_after.right?.text).toBe('LECCE');
    const all = cues.map((c) => c.text).join(' ');
    expect(all).toMatch(/LECCE|1-1/);
  });

  it('falls back to kit-colour names without team names', () => {
    const cues = buildGoalCaptions({ goal: goal(), clipDurSec: 20 });
    const score = cues.find((c) => c.id === 'score_after')!;
    expect(score.left?.text).toBe('THE REDS');
    expect(score.right?.text).toBe('THE WHITES');
  });

  it('marks a late final equaliser as last-gasp drama', () => {
    const cues = buildGoalCaptions({
      goal: goal({ number: 8, total: 8, scoreBefore: [4, 3], scoreAfter: [4, 4], late: true }),
      clipDurSec: 20,
    });
    const headline = cues.find((c) => c.id === 'headline')!;
    expect(headline.text).toContain('LAST-GASP EQUALISER');
    expect(headline.text).toContain('4-4');
  });

  it('strips emoji when the emoji switch is off', () => {
    const cues = buildGoalCaptions({ goal: goal(), clipDurSec: 20, emoji: false });
    for (const c of cues) {
      expect(c.text).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  it('respects subtitle/headline switches and non-goal segments', () => {
    const seg = { startMs: 0, endMs: 20000, goal: goal() };
    expect(captionsForSegment(seg, { subtitleSwitch: 0, headlineSwitch: 0 })).toHaveLength(0);
    expect(captionsForSegment({ startMs: 0, endMs: 20000 }, {})).toHaveLength(0);
    expect(captionsForSegment(seg, {}).length).toBeGreaterThan(0);
  });
});
