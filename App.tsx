import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Upload } from 'lucide-react';
import { generateFFmpegScript } from './services/ffmpegService';
import { api, waitForJob } from './services/analysisService';
import { useMatchAnalysis } from './hooks/useMatchAnalysis';
import { useRallyEditor } from './hooks/useRallyEditor';
import SignalChart from './components/SignalChart';
import SmartPlayer from './components/SmartPlayer';
import StatsPanel from './components/StatsPanel';
import RallyList, { FilterOption, SortOption } from './components/RallyList';

export default function App() {
  const analysis=useMatchAnalysis();
  const {file,videoUrl,rallies,setRallies,processedRallies,stats,metadata,analyzing,frames}=analysis;
  const [sort,setSort]=useState<SortOption>('id');
  const [filter,setFilter]=useState<FilterOption>('all');
  const [selected,setSelected]=useState<Set<number>>(new Set());
  const [editing,setEditing]=useState(false);
  const [time,setTime]=useState(0);
  const [smart,setSmart]=useState(false);
  const [exporting,setExporting]=useState(false);
  const [exportMessage,setExportMessage]=useState('');
  const [downloadUrl,setDownloadUrl]=useState<string|null>(null);
  const exportController=useRef<AbortController|null>(null);
  const exportJob=useRef<string|null>(null);
  useEffect(()=>{setDownloadUrl(null);setExportMessage('');},[rallies,selected]);
  useEffect(()=>()=>{
    exportController.current?.abort();
    if(exportJob.current) void api(`/api/jobs/${exportJob.current}`,{method:'DELETE'}).catch(()=>{});
  },[]);
  const editor=useRallyEditor({rallies,setRallies,selectedRallyIds:selected,setSelectedRallyIds:setSelected,currentTime:time,duration:metadata?.sourceDuration});
  const displayed=useMemo(()=>processedRallies.filter(r=>filter==='all'||r.reviewStatus===filter).sort((a,b)=>sort==='duration'?(b.end-b.start)-(a.end-a.start):sort==='hits'?b.hits-a.hits:a.id-b.id),[processedRallies,filter,sort]);
  const selectedCount=rallies.filter(r=>selected.has(r.id)).length;
  const exportList=()=>selectedCount?processedRallies.filter(r=>selected.has(r.id)):processedRallies;
  const exportScript=()=>{
    try {
      const text=generateFFmpegScript(file?.name??'input.mp4',exportList());
      const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));
      const a=document.createElement('a');a.href=url;a.download='process_highlights.sh';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e) {setExportMessage((e as Error).message);}
  };
  const exportVideo=async()=>{
    if(!analysis.jobId||exporting)return;
    const id=analysis.jobId;
    const controller=new AbortController();exportController.current=controller;exportJob.current=id;
    setExporting(true);setDownloadUrl(null);setExportMessage('正在提交剪辑任务');
    try {
      await api(`/api/jobs/${id}/export`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({clips:exportList().map(r=>({start:r.start,end:r.end}))})});
      await waitForJob(id,s=>setExportMessage(`${s.message} ${s.progress.toFixed(0)}%`),controller.signal,true);
      setDownloadUrl(`/api/jobs/${id}/video`);setExportMessage('剪辑完成');
    } catch(e){setExportMessage((e as Error).name==='AbortError'?'已取消导出':(e as Error).message);}
    finally{setExporting(false);exportJob.current=null;}
  };
  const upload=(e:React.ChangeEvent<HTMLInputElement>)=>{
    analysis.handleFileUpload(e);setSelected(new Set());setTime(0);setDownloadUrl(null);setExportMessage('');
  };
  return <div className="min-h-screen bg-slate-950 text-slate-200">
    <header className="border-b border-slate-800 px-6 py-4 flex items-center gap-2"><Activity className="text-emerald-400"/><h1 className="text-xl font-bold">MatchClip AI</h1><span className="ml-auto text-xs text-slate-400">本地视觉分析 · 候选片段复核</span></header>
    <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">
      {analysis.error&&<p role="alert" className="p-3 border border-red-900 bg-red-950/40 rounded text-red-300">{analysis.error}</p>}
      {analysis.importStatus&&<p role="status" className="text-sm text-emerald-300">{analysis.importStatus}</p>}
      <section className="rounded-xl bg-slate-900 border border-slate-800 p-5 flex flex-wrap gap-4 items-end">
        <div className="mr-auto"><h2 className="font-semibold">{file?.name??'选择比赛视频'}</h2><p className="text-xs text-slate-400 mt-1">绿色球场单打、底线主机位。视频在本机处理，剪辑不依赖计分牌。</p></div>
        <label className={`bg-slate-800 rounded px-4 py-2 text-sm ${analyzing||exporting?'opacity-40':'cursor-pointer'}`}><Upload size={14} className="inline mr-2"/>{file?'更换视频':'选择视频文件'}<input type="file" accept="video/*" className="hidden" disabled={analyzing||exporting} onChange={upload}/></label>
        {videoUrl&&<>
          <label className="text-xs text-slate-400">开始秒数<input aria-label="分析开始秒数" type="number" min="0" step="0.1" value={analysis.rangeStart} disabled={analyzing||exporting} onChange={e=>analysis.setRangeStart(e.target.value)} className="block mt-1 w-24 bg-slate-950 p-2 rounded"/></label>
          <label className="text-xs text-slate-400">结束秒数（留空到结尾）<input aria-label="分析结束秒数" type="number" min="0" step="0.1" value={analysis.rangeEnd} disabled={analyzing||exporting} onChange={e=>analysis.setRangeEnd(e.target.value)} className="block mt-1 w-28 bg-slate-950 p-2 rounded"/></label>
          <button onClick={()=>{setSelected(new Set());setDownloadUrl(null);void analysis.startAnalysis();}} disabled={analyzing||exporting} className="px-4 py-2 bg-emerald-700 rounded disabled:opacity-40">{rallies.length?'重新分析':'开始视觉分析'}</button>
        </>}
      </section>
      {analyzing&&<div className="p-3 rounded bg-slate-900 text-sm" role="status"><div className="flex justify-between"><span>{analysis.progressText} · {analysis.progress.toFixed(0)}%</span><button onClick={analysis.cancelAnalysis} className="text-amber-300">取消分析</button></div><progress className="w-full mt-2" max="100" value={analysis.progress}/></div>}
      {videoUrl&&<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <SmartPlayer videoUrl={videoUrl} rallies={rallies} processedRallies={processedRallies} currentTime={time} setCurrentTime={setTime} isSmartMode={smart} toggleSmartMode={()=>setSmart(!smart)} onDuration={analysis.setVideoDuration}/>
          {frames.length>0&&<SignalChart data={frames} rallies={rallies} currentTime={time} onSeek={setTime}/>}
          {metadata&&<div className="text-xs text-slate-400 space-y-2 bg-slate-900 rounded p-4"><p>分析范围：{metadata.analysisStart??0}–{metadata.analysisEnd??metadata.sourceDuration} 秒 · 不读取计分牌</p>{metadata.warnings?.map((w,i)=><p key={i}>{w}</p>)}</div>}
        </div>
        <div className="space-y-5">
          <StatsPanel stats={stats} selectedCount={selectedCount} exportingVideo={exporting} canExportVideo={Boolean(analysis.jobId)&&!analyzing} onExportVideo={exportVideo} onExportFFmpegScript={exportScript} onExportJSON={analysis.handleExportJSON} onImportJSON={e=>{if(!exporting){setSelected(new Set());analysis.handleImportJSON(e);}}}/>
          {exportMessage&&<p role="status" className="text-sm text-emerald-300">{exportMessage}</p>}
          {exporting&&<button className="text-sm text-amber-300" onClick={()=>{
            exportController.current?.abort();
            if(exportJob.current) void api(`/api/jobs/${exportJob.current}`,{method:'DELETE'}).catch(()=>{});
          }}>取消导出</button>}
          {downloadUrl&&<a href={downloadUrl} download className="block bg-emerald-700 rounded p-3 text-center">下载剪辑成品</a>}
          <fieldset disabled={analyzing||exporting}>
          <RallyList displayRallies={displayed} selectedRallyIds={selected} currentTime={time} isEditMode={editing} sortOption={sort} filterOption={filter}
            onSeek={setTime} onToggleSelection={id=>setSelected(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next;})}
            onToggleSelectAll={()=>setSelected(displayed.every(r=>selected.has(r.id))?new Set():new Set(displayed.map(r=>r.id)))}
            onToggleEditMode={()=>setEditing(!editing)} onSortChange={setSort} onFilterChange={setFilter}
            onToggleServer={editor.toggleServer} onToggleWinner={editor.toggleRallyWinner} onAdjustHits={editor.adjustHits}
            onSplitRally={editor.handleSplitRally} onMergeRally={editor.handleMergeRally} onDeleteRally={editor.deleteRally}
            onBoundary={(id,edge,t)=>{const error=editor.setBoundary(id,edge,t);if(error)analysis.showStatus(error);}}
            onReview={editor.toggleReview} onAdd={editor.addRally}/>
          </fieldset>
        </div>
      </div>}
    </main>
  </div>;
}
