import React, { useState } from 'react';
import { RallyClipWithState } from '../types';
export type SortOption='id'|'duration'|'hits';
export type FilterOption='all'|'pending'|'accepted';
interface Props {
  displayRallies:RallyClipWithState[]; selectedRallyIds:Set<number>; currentTime:number;
  isEditMode:boolean; sortOption:SortOption; filterOption:FilterOption;
  onSeek:(t:number)=>void; onToggleSelection:(id:number)=>void; onToggleSelectAll:()=>void;
  onToggleEditMode:()=>void; onSortChange:(s:SortOption)=>void; onFilterChange:(s:FilterOption)=>void;
  onToggleServer:(id:number)=>void; onToggleWinner:(id:number)=>void; onAdjustHits:(id:number,d:number)=>void;
  onSplitRally:(id:number)=>void; onMergeRally:(id:number)=>void; onDeleteRally:(id:number)=>void;
  onBoundary:(id:number,edge:'start'|'end',t:number)=>void; onReview:(id:number)=>void;
  onAdd:(start:number,end:number)=>string|null;
}
export default function RallyList(p:Props) {
  const [manualStart,setManualStart]=useState('');
  const [manualEnd,setManualEnd]=useState('');
  const [manualMessage,setManualMessage]=useState('');
  return <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
    <div className="p-3 flex flex-wrap gap-2 items-center border-b border-slate-800">
      <h3 className="font-semibold mr-auto">回合候选 {p.displayRallies.length}</h3>
      <button onClick={p.onToggleEditMode} className="text-xs px-2 py-1 bg-slate-800 rounded">{p.isEditMode?'结束编辑':'编辑边界'}</button>
      <button onClick={p.onToggleSelectAll} className="text-xs px-2 py-1 bg-slate-800 rounded">全选/取消</button>
      <select aria-label="筛选回合" value={p.filterOption} onChange={e=>p.onFilterChange(e.target.value as FilterOption)} className="bg-slate-950 text-xs p-1 rounded">
        <option value="all">全部候选</option><option value="pending">待复核</option><option value="accepted">已复核</option>
      </select>
      <select aria-label="排序回合" value={p.sortOption} onChange={e=>p.onSortChange(e.target.value as SortOption)} className="bg-slate-950 text-xs p-1 rounded">
        <option value="id">时间顺序</option><option value="duration">最长优先</option><option value="hits">声音候选数</option>
      </select>
    </div>
    {p.isEditMode && <div className="p-3 space-y-2 border-b border-slate-800 text-xs">
      <p className="text-slate-400">发现漏检时，可定位视频后补录片段。</p>
      <div className="flex flex-wrap gap-2 items-center">
        <input aria-label="补录起点" placeholder="起点秒数" type="number" min="0" step="0.1" value={manualStart} onChange={e=>setManualStart(e.target.value)} className="w-24 p-1 bg-slate-950 rounded"/>
        <button onClick={()=>setManualStart(p.currentTime.toFixed(1))}>取当前起点</button>
        <input aria-label="补录终点" placeholder="终点秒数" type="number" min="0" step="0.1" value={manualEnd} onChange={e=>setManualEnd(e.target.value)} className="w-24 p-1 bg-slate-950 rounded"/>
        <button onClick={()=>setManualEnd(p.currentTime.toFixed(1))}>取当前终点</button>
        <button className="text-emerald-300" onClick={()=>{
          const error=manualStart.trim() && manualEnd.trim()?p.onAdd(Number(manualStart),Number(manualEnd)):'请填写起止时间';
          setManualMessage(error??'片段已补录');
          if(!error){setManualStart('');setManualEnd('');}
        }}>补录片段</button>
      </div>
      {manualMessage&&<p role="status">{manualMessage}</p>}
    </div>}
    <div className="max-h-[650px] overflow-y-auto p-2 space-y-2">
      {!p.displayRallies.length && <p className="text-slate-500 text-sm p-6">当前没有符合条件的候选片段。</p>}
      {p.displayRallies.map(r=><article key={r.id} className={`p-3 rounded border ${p.currentTime>=r.start && p.currentTime<=r.end?'border-emerald-500':'border-slate-800'} bg-slate-950`}>
        <div className="flex gap-2 items-start">
          <input type="checkbox" aria-label={`选择候选 ${r.id}`} checked={p.selectedRallyIds.has(r.id)} onChange={()=>p.onToggleSelection(r.id)} />
          <button onClick={()=>p.onSeek(r.start)} className="text-left flex-1">
            <span className="font-semibold text-sm">#{r.id} · {(r.end-r.start).toFixed(1)} 秒</span>
            <div className="font-mono text-xs text-slate-400">{r.start.toFixed(1)} – {r.end.toFixed(1)}</div>
          </button>
          <button onClick={()=>p.onReview(r.id)} className={`text-xs px-2 py-1 rounded ${r.reviewStatus==='accepted'?'bg-emerald-900 text-emerald-300':'bg-amber-950 text-amber-300'}`}>
            {r.reviewStatus==='accepted'?'已复核':'标为已复核'}
          </button>
        </div>
        <div className="text-xs text-slate-500 mt-2">{r.hitSource==='unknown'?'拍数未确认':`${r.hits} ${r.hitSource==='manual'?'拍（人工）':'次声音候选，非准确拍数'}`} · 胜方 {r.winner ? `球员 ${r.winner}`:'未确认'}</div>
        {r.reviewStatus!=='accepted' && <p className="text-xs text-amber-500/80 mt-2">{r.reviewReasons?.join('；') || '请检查片段起止位置'}</p>}
        {p.isEditMode && <div className="mt-3 space-y-2 text-xs">
          <div className="flex gap-2">
            {(['start','end'] as const).map(edge=><label key={`${edge}-${r[edge]}`}>{edge==='start'?'起点':'终点'}
              <input aria-label={`候选 ${r.id} ${edge==='start'?'起点':'终点'}`} type="number" step="0.1" defaultValue={r[edge]} className="w-24 ml-1 p-1 bg-slate-800 rounded"
                onBlur={e=>{p.onBoundary(r.id,edge,Number(e.target.value));e.target.value=String(r[edge]);}} />
            </label>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="text-slate-300" onClick={()=>p.onSplitRally(r.id)}>在播放位置拆分</button>
            <button className="text-slate-300" onClick={()=>p.onMergeRally(r.id)}>合并下一段</button>
            <button className="text-red-400" onClick={()=>p.onDeleteRally(r.id)}>删除候选</button>
            <button className="text-slate-300" onClick={()=>p.onToggleWinner(r.id)}>胜方：{r.winner??'未知'} ↻</button>
          </div>
        </div>}
      </article>)}
    </div>
  </section>;
}
