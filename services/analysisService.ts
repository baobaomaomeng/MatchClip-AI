import { AnalysisResult } from '../types';
export interface JobStatus { status: string; progress: number; message: string }
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch (error) { if ((error as Error).name === 'AbortError') throw error; throw new Error('本地分析服务未连接，请运行 npm run backend'); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(typeof data?.detail === 'string' ? data.detail : '本地分析服务不可用，请运行 npm run backend');
  return data as T;
}
export async function waitForJob(id: string, onProgress: (s: JobStatus) => void, signal: AbortSignal, exporting = false): Promise<void> {
  while (!signal.aborted) {
    const status = await api<JobStatus>(`/api/jobs/${id}`, { signal });
    onProgress(status);
    if (status.status === (exporting ? 'exported' : 'complete')) return;
    if (['failed', 'cancelled'].includes(status.status) || exporting && status.status === 'complete') throw new Error(status.message);
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('已取消', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  throw new DOMException('已取消', 'AbortError');
}
export async function createAnalysis(file: File, start: number, end: number | undefined, signal: AbortSignal) {
  await api('/api/health', { signal });
  const form = new FormData(); form.append('file', file);
  const query = new URLSearchParams({ start: String(start) });
  if (end !== undefined) query.set('end', String(end));
  return api<{ id: string }>(`/api/jobs?${query}`, { method: 'POST', body: form, signal });
}
export const getResult = (id: string, signal: AbortSignal) => api<AnalysisResult>(`/api/jobs/${id}/result`, { signal });
