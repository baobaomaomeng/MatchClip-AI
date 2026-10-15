"""Conservative temporal fusion; no scoreboard input, score inference or minimum-hit filter.

The activity strength is a heuristic over real pose features, NOT a calibrated
probability or a trained badminton action classifier. Every candidate needs review.
"""
from bisect import bisect_left, bisect_right


def segment(frames, hits, start, end, fps=5):
    candidates = []
    active_start = None
    last_evidence = start
    pending_start = None
    gap_start = None
    last_court = start
    evidence_count = 0

    def finish(stop, reason):
        nonlocal active_start, pending_start, evidence_count
        if active_start is not None:
            a = max(start, active_start - 1.2)
            b = min(end, stop)
            if b - a >= .6:
                reasons = ['自动候选：请核对发球及最后一拍', reason]
                if b - a > 45:
                    reasons.append('片段较长，可能包含多个回合或等待')
                if b - a < 4:
                    reasons.append('短回合或发球失误候选')
                if a <= start + .2 or b >= end - .2:
                    reasons.append('接近分析范围边界，可能不完整')
                candidates.append({
                    'id': len(candidates) + 1, 'start': round(a, 2), 'end': round(b, 2),
                    'hits': bisect_right(hits, b) - bisect_left(hits, a),
                    'hitSource': 'audio_estimate', 'serverSide': None, 'winner': None,
                    'source': 'pose_audio_v1', 'reviewStatus': 'pending',
                    'reviewReasons': reasons,
                    'evidenceStrength': round(min(1, evidence_count / max(1, (b-a)*fps)), 3),
                })
        active_start, pending_start, evidence_count = None, None, 0

    for frame in frames:
        t = frame['t']
        if not frame['court_visible']:
            if active_start is not None and t - last_court > .6:
                finish(last_court + .4, '主镜头中断：需检查是否切镜或回放')
            pending_start = None
            if active_start is None:
                evidence_count = 0
            continue
        last_court = t
        nearby_hit = bisect_right(hits, t + .15) > bisect_left(hits, t - .35)
        visual = frame['motion_score']
        # Audio alone cannot start or extend a rally. Pose dropout does not mean end.
        evidence = frame['players_visible'] == 2 and (visual >= .6 or (visual >= .28 and nearby_hit))
        frame['hit_audio'] = nearby_hit
        frame['activity'] = evidence
        if evidence:
            last_evidence = t
            gap_start = None
            evidence_count += 1
            if active_start is None:
                if pending_start is None:
                    pending_start = t
                elif t - pending_start >= .2 - 1e-6:
                    active_start = pending_start
        elif active_start is None:
            if pending_start is not None and t - pending_start > .6:
                pending_start = None
                evidence_count = 0
        else:
            if frame['players_visible'] < 2:
                gap_start = t if gap_start is None else gap_start
                # Preserve short occlusions; lengthy unobserved intervals need review.
                if t - gap_start >= 3:
                    finish(t, '球员持续遮挡或检测缺失，边界不确定')
            else:
                gap_start = None
                if t - last_evidence >= 2:
                    finish(last_evidence + 1.2, '动作转为静止或走位，需复核结束位置')
    if active_start is not None:
        finish(end, '分析范围结束')
    # Keep padding disjoint without merging independent rallies across a quiet gap.
    for previous, current in zip(candidates, candidates[1:]):
        if previous['end'] > current['start']:
            boundary = round((previous['end'] + current['start']) / 2, 2)
            previous['end'] = current['start'] = boundary
    for candidate in candidates:
        candidate['hits'] = bisect_right(hits, candidate['end']) - bisect_left(hits, candidate['start'])
    return candidates
