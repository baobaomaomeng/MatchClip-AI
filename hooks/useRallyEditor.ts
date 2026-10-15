import { RallyClip } from '../types';
export const reindexRallies = (list: RallyClip[]) => [...list].sort((a,b) => a.start-b.start).map((r,i) => ({ ...r, id: i+1 }));
interface Options {
  rallies: RallyClip[]; setRallies: React.Dispatch<React.SetStateAction<RallyClip[]>>;
  selectedRallyIds: Set<number>; setSelectedRallyIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  currentTime: number; duration?: number;
}
export function useRallyEditor({ rallies, setRallies, setSelectedRallyIds, currentTime, duration }: Options) {
  const toggleServer = (id: number) => setRallies(prev => prev.map(r => r.id === id ? { ...r, serverSide: r.serverSide === 'A' ? 'B' : r.serverSide === 'B' ? null : 'A' } : r));
  const toggleRallyWinner = (id: number) => setRallies(prev => prev.map(r => r.id === id ? { ...r, winner: r.winner === 'A' ? 'B' : r.winner === 'B' ? null : 'A' } : r));
  const adjustHits = (id: number, delta: number) => setRallies(prev => prev.map(r => r.id === id ? { ...r, hits: Math.max(0,r.hits+delta), hitSource: 'manual' } : r));
  const edit = (next: RallyClip[]) => { setRallies(reindexRallies(next)); setSelectedRallyIds(new Set()); };
  const deleteRally = (id: number) => edit(rallies.filter(r => r.id !== id));
  const addRally = (start: number, end: number): string | null => {
    if (![start,end].every(Number.isFinite) || start < 0 || end <= start || duration !== undefined && end > duration) return '请填写视频范围内的有效起止时间';
    if (rallies.some(r => start < r.end && end > r.start)) return '新片段与已有候选重叠，请先调整或删除重叠片段';
    edit([...rallies, { id:0, start, end, hits:0, hitSource:'unknown', serverSide:null, winner:null,
      source:'manual', reviewStatus:'pending', reviewReasons:['人工补录，请确认起止位置'] }]);
    return null;
  };
  const invalidate = (r: RallyClip): RallyClip => ({ ...r, reviewStatus:'pending', winner:null, scoreBefore:undefined, reviewReasons:['边界已修改，请重新复核'] });
  const handleSplitRally = (id: number) => {
    const r = rallies.find(r => r.id === id);
    if (!r || currentTime <= r.start + .2 || currentTime >= r.end - .2) return;
    edit([...rallies.filter(v => v.id !== id),
      { ...invalidate(r), end:currentTime, hits:0, hitSource:'unknown' },
      { ...invalidate(r), start:currentTime, hits:0, hitSource:'unknown' }]);
  };
  const handleMergeRally = (id: number) => {
    const index = rallies.findIndex(r => r.id === id), a = rallies[index], b = rallies[index+1];
    if (!a || !b) return;
    edit([...rallies.filter(r => r.id !== a.id && r.id !== b.id), { ...invalidate(a), end:b.end, hits:0, hitSource:'unknown' }]);
  };
  const setBoundary = (id: number, edge:'start'|'end', value:number): string | null => {
    value = Math.round(value*100)/100;
    const index = rallies.findIndex(r => r.id === id), r = rallies[index];
    if (!r || !Number.isFinite(value) || value < 0 || duration !== undefined && value > duration) return '边界超出视频范围';
    if (edge === 'start' && (value >= r.end || index > 0 && value < rallies[index-1].end) ||
        edge === 'end' && (value <= r.start || index < rallies.length-1 && value > rallies[index+1].start)) return '起止时间无效或与相邻片段重叠';
    if (value === r[edge]) return null;
    setRallies(prev => prev.map(v => v.id === id ? { ...invalidate(v), [edge]:value, hits:0, hitSource:'unknown' } : v));
    return null;
  };
  const toggleReview = (id:number) => setRallies(prev => prev.map(r => r.id === id ? { ...r, reviewStatus:r.reviewStatus === 'accepted' ? 'pending' : 'accepted' } : r));
  return { toggleServer, toggleRallyWinner, adjustHits, addRally, deleteRally, handleSplitRally, handleMergeRally, setBoundary, toggleReview };
}
