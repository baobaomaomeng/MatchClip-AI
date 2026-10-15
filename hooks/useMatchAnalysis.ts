import { useState, useMemo, useRef, useEffect } from 'react';
import { scoreEngine } from '../services/scoreService';
import { api, createAnalysis, getResult, waitForJob } from '../services/analysisService';
import { parseProject } from '../services/projectService';
import { AnalysisMetadata, FrameFeature, RallyClip, MatchStats } from '../types';

export function useMatchAnalysis() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration,setVideoDuration]=useState<number|undefined>();
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState<FrameFeature[]>([]);
  const [rallies, setRallies] = useState<RallyClip[]>([]);
  const [metadata, setMetadata] = useState<AnalysisMetadata | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [rangeStart, setRangeStart] = useState('0');
  const [rangeEnd, setRangeEnd] = useState('');
  const controller = useRef<AbortController | null>(null);
  const activeJob = useRef<string | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => {
    controller.current?.abort();
    if (activeJob.current) void fetch(`/api/jobs/${activeJob.current}`, { method: 'DELETE' });
  }, []);
  const cancelAnalysis = () => {
    generation.current++;
    controller.current?.abort();
    if (activeJob.current) void api(`/api/jobs/${activeJob.current}`, { method: 'DELETE' }).catch(() => {});
    activeJob.current = null;
    setAnalyzing(false); setProgressText('已取消');
  };
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files?.[0];
    if (!next) return;
    cancelAnalysis();
    setFile(next); setVideoUrl(URL.createObjectURL(next));setVideoDuration(undefined);setImportStatus(null);
    setFrames([]); setRallies([]); setMetadata(null); setJobId(null); setError(null);
    setRangeStart('0'); setRangeEnd(''); setDataVersion(v => v + 1);
  };
  const startAnalysis = async () => {
    if (!file || analyzing) return;
    const start = Number(rangeStart), end = rangeEnd.trim() ? Number(rangeEnd) : undefined;
    if (!Number.isFinite(start) || start < 0 || end !== undefined && (!Number.isFinite(end) || end <= start)) {
      setError('请填写有效的分析起止秒数'); return;
    }
    const current = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    setAnalyzing(true); setError(null); setProgress(0); setProgressText('正在传入本地分析服务');
    try {
      const { id } = await createAnalysis(file, start, end, abort.signal);
      if (current !== generation.current) { void api(`/api/jobs/${id}`, { method: 'DELETE' }); return; }
      activeJob.current = id;
      await waitForJob(id, s => { setProgress(s.progress); setProgressText(s.message); }, abort.signal);
      const result = await getResult(id, abort.signal);
      const valid = parseProject(result,videoDuration);
      if (current !== generation.current) return;
      setMetadata(valid.metadata); setRallies(valid.rallies); setFrames(result.frames ?? []);
      setJobId(id); setDataVersion(v => v + 1);
    } catch (e) {
      if (current === generation.current && (e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      if (current === generation.current) { setAnalyzing(false); activeJob.current = null; }
    }
  };
  const { stats, processedRallies } = useMemo(() => {
    const processedRallies = scoreEngine.processRallies(rallies);
    const validDuration = rallies.reduce((n, r) => n + r.end - r.start, 0);
    const totalHits = rallies.reduce((n, r) => n + r.hits, 0);
    const final = processedRallies.at(-1)?.scoreStateAfter;
    const stats: MatchStats = {
      totalDuration: metadata ? (metadata.analysisEnd ?? metadata.sourceDuration ?? 0) - (metadata.analysisStart ?? 0) : 0,
      validDuration, rallyCount: rallies.length, averageRallyLen: rallies.length ? validDuration/rallies.length : 0,
      scoreA: final?.scoreA ?? null, scoreB: final?.scoreB ?? null,
      totalHits, avgHitsPerRally: rallies.length ? totalHits/rallies.length : 0,
      maxHits: Math.max(0, ...rallies.map(r => r.hits)), pendingCount: rallies.filter(r => r.reviewStatus !== 'accepted').length,
    };
    return { stats, processedRallies };
  }, [rallies, metadata]);
  const handleExportJSON = () => {
    const data = { metadata: { ...metadata, version: '2.0', sourceFile: file?.name, exportedAt: new Date().toISOString() }, rallies };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${file?.name ?? 'match'}_rallies.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]; e.target.value = '';
    if (!selected || analyzing) return;
    try {
      const project = parseProject(JSON.parse(await selected.text()),videoDuration);
      if (file && project.metadata.sourceFile !== file.name) throw new Error('项目对应的视频文件名不匹配，请先选择原视频');
      setRallies(project.rallies); setFrames([]); setMetadata(project.metadata); setDataVersion(v => v + 1);
      setImportStatus(`已导入 ${project.rallies.length} 个候选片段`); setError(null);
      // A previous server job must never export against a different imported source.
      setJobId(null);
    } catch (e) { setError((e as Error).message); }
  };
  const showStatus = (message: string) => setImportStatus(message);
  return { file, videoUrl, handleFileUpload, analyzing, progress, progressText, startAnalysis, cancelAnalysis,
    frames, rallies, setRallies, dataVersion, stats, processedRallies, metadata, jobId, setVideoDuration,
    rangeStart, setRangeStart, rangeEnd, setRangeEnd, error,
    handleExportJSON, handleImportJSON, importStatus, showStatus };
}
