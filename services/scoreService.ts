import { Player, RallyClip, RallyClipWithState, ScoreState } from '../types';

/** Scores require an explicit anchor and known winners. No inference from near/far or service. */
export class BadmintonScoreEngine {
  public processRallies(rallies: RallyClip[]): RallyClipWithState[] {
    let a: number | null = null;
    let b: number | null = null;
    const state = (server: Player | null): ScoreState => {
      const score = server === 'A' ? a : server === 'B' ? b : null;
      return {
        scoreA: a, scoreB: b, server,
        serviceSide: score === null ? null : score % 2 === 0 ? 'Right' : 'Left',
        visualServiceCourt: server ? `球员 ${server}` : '发球方未确认',
        isGamePoint: a !== null && b !== null && ((Math.max(a,b) >= 20 && a !== b) || a === 29 && b === 29),
        isInterval: false,
      };
    };
    return rallies.map(r => {
      if (r.scoreBefore) { a = r.scoreBefore.a; b = r.scoreBefore.b; }
      const before = state(r.serverSide ?? null);
      if (a !== null && b !== null && r.winner) {
        if (r.winner === 'A') a++; else b++;
      } else { a = b = null; }
      return { ...r, scoreStateBefore: before, scoreStateAfter: state(r.winner ?? null) };
    });
  }
}
export const scoreEngine = new BadmintonScoreEngine();
