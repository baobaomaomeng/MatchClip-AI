import React, {useMemo} from 'react';
import {AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea} from 'recharts';
import {FrameFeature,RallyClip} from '../types';
interface Props{data:FrameFeature[];rallies:RallyClip[];currentTime:number;onSeek:(t:number)=>void}
export default function SignalChart({data,rallies,currentTime,onSeek}:Props){
  const chart=useMemo(()=>{
    const stride=Math.max(1,Math.ceil(data.length/1600)),out=[];
    for(let i=0;i<data.length;i+=stride){const block=data.slice(i,i+stride);out.push({t:data[i].t,motion:Math.max(...block.map(f=>f.motion_score)),audio:block.some(f=>f.hit_audio)?.15:0});}
    return out;
  },[data]);
  return <div className="h-56 bg-slate-900 border border-slate-800 rounded-xl p-4">
    <h3 className="text-xs text-slate-400 mb-3">蓝色：球员动作强度 · 红色：声音候选 · 绿色：待复核片段</h3>
    <ResponsiveContainer width="100%" height="85%"><AreaChart data={chart} onClick={e=>{if(e?.activeLabel!=null)onSeek(Number(e.activeLabel));}}>
      <XAxis dataKey="t" type="number" domain={['dataMin','dataMax']} tick={{fontSize:10}}/><YAxis domain={[0,1]} hide/>
      <Tooltip labelFormatter={t=>`${Number(t).toFixed(1)} 秒`} contentStyle={{background:'#0f172a'}}/>
      {rallies.map(r=><ReferenceArea key={r.id} x1={r.start} x2={r.end} fill="#10b981" fillOpacity={.15}/>)}
      <Area dataKey="motion" name="动作强度（非概率）" stroke="#60a5fa" fill="#60a5fa" fillOpacity={.2} isAnimationActive={false}/>
      <Area dataKey="audio" name="音频瞬态" stroke="#f43f5e" fill="#f43f5e" isAnimationActive={false}/>
      <ReferenceArea x1={currentTime} x2={currentTime+.3} fill="white"/>
    </AreaChart></ResponsiveContainer>
  </div>;
}
