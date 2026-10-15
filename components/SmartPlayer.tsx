import React, { useEffect, useRef, useState } from 'react';
import { RallyClip, RallyClipWithState } from '../types';
interface Props {
  videoUrl: string; rallies:RallyClip[]; processedRallies:RallyClipWithState[];
  currentTime:number; setCurrentTime:(t:number)=>void;
  isSmartMode:boolean; toggleSmartMode:()=>void;
  onDuration:(duration:number)=>void;
}
export default function SmartPlayer({videoUrl,rallies,processedRallies,currentTime,setCurrentTime,isSmartMode,toggleSmartMode,onDuration}:Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [playError,setPlayError] = useState('');
  useEffect(()=>setPlayError(''),[videoUrl]);
  useEffect(() => {
    if (video.current && Math.abs(video.current.currentTime-currentTime) > .45) video.current.currentTime=currentTime;
  },[currentTime]);
  const active = processedRallies.find(r => currentTime >= r.start && currentTime <= r.end);
  const update = () => {
    const player = video.current; if (!player) return;
    let t=player.currentTime;
    if (isSmartMode && !player.paused && rallies.length) {
      const next = rallies.find(r => r.end > t);
      if (!next) player.pause();
      else if (t < next.start) { t=next.start; player.currentTime=t; }
    }
    setCurrentTime(t);
  };
  return <div className="rounded-xl overflow-hidden border border-slate-700 bg-black">
    <div className="relative">
      <video ref={video} src={videoUrl} controls className="w-full aspect-video" onTimeUpdate={update}
        onLoadedMetadata={e=>onDuration(e.currentTarget.duration)}
        onError={()=>setPlayError('视频播放失败，请检查视频编码或重新选择文件')} />
      {active && <div className="absolute top-3 right-3 pointer-events-none bg-slate-950/90 p-2 rounded text-xs">
        <div>候选 #{active.id} · {active.reviewStatus==='accepted'?'已复核':'待复核'}</div>
        <div className="text-slate-400 mt-1">{active.scoreStateBefore.scoreA === null ? '比分未确认' : `球员 A ${active.scoreStateBefore.scoreA} : ${active.scoreStateBefore.scoreB} 球员 B`}</div>
      </div>}
    </div>
    <div className="flex flex-wrap gap-3 items-center p-3 text-sm">
      <button onClick={toggleSmartMode} className="bg-slate-800 rounded px-3 py-1">{isSmartMode?'回合连播':'原视频'} · 点击切换</button>
      <label>定位秒数 <input aria-label="定位秒数" type="number" min="0" step="0.1" value={currentTime.toFixed(1)}
        onChange={e=>{ const t=Number(e.target.value); if(Number.isFinite(t) && t>=0 && video.current && t<=video.current.duration) setCurrentTime(t); }}
        className="w-24 bg-slate-900 rounded p-1 ml-1" /></label>
      <span className="text-xs text-slate-500">复核边界时建议使用原视频模式</span>
      {playError && <span role="alert" className="text-red-400">{playError}</span>}
    </div>
  </div>;
}
