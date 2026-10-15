import { AnalysisResult, RallyClip } from '../types';

/** Reject invalid intervals rather than silently coercing them into plausible results. */
export function parseProject(value: unknown, videoDuration?: number): AnalysisResult {
  const data = value as any;
  if (!data || !Array.isArray(data.rallies) || data.rallies.length > 2000) throw new Error('无效的回合项目');
  const modern = data.metadata?.version === '2.0';
  const duration = videoDuration ?? data.metadata?.sourceDuration;
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) throw new Error('视频时长无效');
  const analysisStart = data.metadata?.analysisStart ?? 0;
  const analysisEnd = data.metadata?.analysisEnd ?? duration;
  if (!Number.isFinite(analysisStart) || analysisStart < 0 || analysisEnd !== undefined &&
      (!Number.isFinite(analysisEnd) || analysisEnd <= analysisStart || duration !== undefined && analysisEnd > duration + .1)) throw new Error('项目分析范围无效');
  const rallies: RallyClip[] = data.rallies.map((r: any) => {
    if (!r || ![r.start, r.end, r.hits].every(Number.isFinite) || r.start < 0 || r.end <= r.start || r.hits < 0 ||
        (duration !== undefined && (!Number.isFinite(duration) || r.end > duration + .1))) throw new Error('回合时间或拍数无效');
    const player = (p: unknown) => p === 'A' || p === 'B' ? p : null;
    const anchor = modern && r.scoreBefore && [r.scoreBefore.a, r.scoreBefore.b].every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 30)
      ? { a: r.scoreBefore.a, b: r.scoreBefore.b } : undefined;
    return {
      id: 0, start: r.start, end: r.end, hits: Math.round(r.hits),
      hitSource: modern && r.hitSource === 'manual' ? 'manual' : modern && r.hitSource === 'unknown' ? 'unknown' : 'audio_estimate',
      serverSide: modern ? player(r.serverSide) : null, winner: modern ? player(r.winner) : null,
      scoreBefore: anchor, source: typeof r.source === 'string' ? r.source : 'import',
      reviewStatus: modern && r.reviewStatus === 'accepted' ? 'accepted' : 'pending',
      reviewReasons: modern && Array.isArray(r.reviewReasons) ? r.reviewReasons.filter((s: unknown) => typeof s === 'string') : ['旧版近远方与默认比分已清除，请复核'],
      evidenceStrength: Number.isFinite(r.evidenceStrength) ? Math.max(0, Math.min(1, r.evidenceStrength)) : undefined,
    };
  }).sort((a: RallyClip, b: RallyClip) => a.start - b.start);
  rallies.forEach((r, i) => {
    r.id = i + 1;
    if (i && rallies[i - 1].end > r.start + .001) throw new Error('回合时间重叠，请检查项目文件');
  });
  return { metadata: { version: '2.0', sourceFile: String(data.metadata?.sourceFile ?? 'unknown'),
    sourceDuration: Number.isFinite(duration) ? duration : undefined,
    analysisStart, analysisEnd,
    method: data.metadata?.method, scoreboardUsed: data.metadata?.scoreboardUsed,
    warnings: Array.isArray(data.metadata?.warnings) ? data.metadata.warnings.filter((v: unknown) => typeof v === 'string') : [],
  }, rallies };
}
