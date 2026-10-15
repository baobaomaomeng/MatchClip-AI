import React from 'react';
import { MatchStats } from '../types';
interface Props {
  stats:MatchStats; selectedCount:number; exportingVideo:boolean; canExportVideo:boolean;
  onExportVideo:()=>void; onExportFFmpegScript:()=>void; onExportJSON:()=>void;
  onImportJSON:(e:React.ChangeEvent<HTMLInputElement>)=>void;
}
export default function StatsPanel(p:Props) {
  const button='px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm disabled:opacity-40';
  return <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
    <h3 className="font-semibold">分析结果</h3>
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div>候选片段 <strong className="block text-xl">{p.stats.rallyCount}</strong></div>
      <div>待复核 <strong className="block text-xl text-amber-400">{p.stats.pendingCount}</strong></div>
      <div>片段保留占比 <strong className="block text-xl">{p.stats.totalDuration?Math.round(p.stats.validDuration/p.stats.totalDuration*100):0}%</strong></div>
      <div>平均片段时长 <strong className="block text-xl">{p.stats.averageRallyLen.toFixed(1)}s</strong></div>
    </div>
    <p className="text-sm text-slate-400">{p.stats.scoreA===null?'比分未确认 · 不根据发球方或回合数猜比分':`球员 A ${p.stats.scoreA} : ${p.stats.scoreB} 球员 B`}</p>
    <p className="text-xs text-slate-500">保留占比是分析范围内的片段时长比例，不是识别准确率。</p>
    <div className="border-t border-slate-800 pt-3 space-y-2">
      <p className="text-xs text-slate-400">{p.selectedCount?`导出选中 ${p.selectedCount} 个片段`:'导出全部候选（包含待复核片段）'}</p>
      <button className="w-full px-3 py-3 bg-emerald-700 hover:bg-emerald-600 rounded font-semibold disabled:opacity-40" onClick={p.onExportVideo}
        disabled={!p.canExportVideo || !p.stats.rallyCount || p.exportingVideo}>{p.exportingVideo?'正在剪辑…':'导出剪辑视频'}</button>
      {!p.canExportVideo && <p className="text-xs text-slate-500">导入的项目可下载剪辑脚本；完成本地分析后可直接导出视频。</p>}
      <div className="flex gap-2 flex-wrap">
        <button className={button} onClick={p.onExportFFmpegScript} disabled={!p.stats.rallyCount}>剪辑脚本</button>
        <button className={button} onClick={p.onExportJSON} disabled={!p.stats.rallyCount}>保存项目</button>
        <label className={`${button} cursor-pointer`}>导入项目<input type="file" accept=".json" className="hidden" onChange={p.onImportJSON}/></label>
      </div>
    </div>
  </section>;
}
