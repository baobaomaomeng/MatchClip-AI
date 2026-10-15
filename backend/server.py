"""Loopback-only local jobs. Video stays on this computer. Start via npm run backend."""
from concurrent.futures import ThreadPoolExecutor
import json
import shutil
import threading
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .analyze import DATA, analyze, probe
from .export import render, validate_segments

app = FastAPI(title='MatchClip local analysis')
executor = ThreadPoolExecutor(max_workers=1)
jobs = {}
lock = threading.Lock()
MAX_BYTES = 4 * 1024**3


@app.middleware('http')
async def local_origin(request: Request, call_next):
    origin = request.headers.get('origin')
    if origin and origin not in {'http://127.0.0.1:3000', 'http://localhost:3000',
                                 'http://127.0.0.1:8000', 'http://localhost:8000'}:
        return JSONResponse({'detail': '仅允许本地项目访问'}, status_code=403)
    if urlparse('http://' + request.headers.get('host', '')).hostname not in {'127.0.0.1', 'localhost', 'testserver'}:
        return JSONResponse({'detail': '仅允许本地访问'}, status_code=403)
    return await call_next(request)


def get_job(job_id):
    with lock:
        if job_id not in jobs:
            raise HTTPException(404, '任务不存在，请重新分析或导入项目')
        return jobs[job_id]


def update(job_id, **values):
    with lock:
        jobs[job_id].update(values)


@app.get('/api/health')
def health():
    return {'ok': True, 'method': 'pose_audio_v1', 'scoreboardUsed': False}


@app.post('/api/jobs', status_code=202)
async def create_job(file: UploadFile = File(...), start: float = Query(0, ge=0, allow_inf_nan=False),
                     end: float | None = Query(None, gt=0, allow_inf_nan=False)):
    if end is not None and end <= start:
        raise HTTPException(422, '开始时间必须小于结束时间')
    job_id = uuid4().hex
    directory = DATA / 'jobs' / job_id
    # Reserve the queue slot before streaming the upload; only two resident jobs at a time.
    with lock:
        if sum(j['status'] in {'uploading', 'queued', 'running', 'exporting'} for j in jobs.values()) >= 2:
            raise HTTPException(429, '本地任务队列已满，请等待或取消任务')
        jobs[job_id] = {'status': 'uploading', 'progress': 0, 'message': '正在接收本地视频',
                        'cancel': threading.Event(), 'directory': directory}
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / 'source.mp4'
    try:
        total = 0
        with path.open('wb') as target:
            while chunk := await file.read(4 * 1024**2):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(413, '视频超过 4 GB，请先截取片段')
                target.write(chunk)
        info = probe(path)
        if start >= info['duration']:
            raise HTTPException(422, '开始时间超出视频时长')
    except Exception as error:
        update(job_id, status='failed', message=str(error))
        shutil.rmtree(directory, ignore_errors=True)
        if isinstance(error, HTTPException):
            raise
        raise HTTPException(422, str(error)) from error
    finally:
        await file.close()
    update(job_id, status='queued', path=path, duration=info['duration'], source_name=file.filename or 'video.mp4')

    def work():
        try:
            job = get_job(job_id)
            if job['cancel'].is_set():
                raise InterruptedError('分析已取消')
            update(job_id, status='running')
            result = analyze(path, start, end, lambda p, m: update(job_id, progress=p, message=m), job['cancel'])
            result['metadata']['sourceFile'] = job['source_name']
            (directory / 'analysis.json').write_text(json.dumps(result, ensure_ascii=False))
            update(job_id, status='complete', progress=100, message='分析完成，请复核候选片段', result=result)
        except InterruptedError:
            update(job_id, status='cancelled', message='分析已取消')
        except Exception as error:
            update(job_id, status='failed', message=str(error))
    executor.submit(work)
    return {'id': job_id}


@app.get('/api/jobs/{job_id}')
def job_status(job_id: str):
    job = get_job(job_id)
    return {key: job[key] for key in ('status', 'progress', 'message')}


@app.get('/api/jobs/{job_id}/result')
def result(job_id: str):
    job = get_job(job_id)
    if 'result' not in job:
        raise HTTPException(409, '分析尚未完成')
    return job['result']


@app.delete('/api/jobs/{job_id}')
def cancel(job_id: str):
    job = get_job(job_id)
    job['cancel'].set()
    if job['status'] == 'queued':
        update(job_id, status='cancelled', message='分析已取消')
    return {'ok': True}


class Clip(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class ExportRequest(BaseModel):
    clips: list[Clip] = Field(min_length=1, max_length=2000)


@app.post('/api/jobs/{job_id}/export', status_code=202)
def export(job_id: str, request: ExportRequest):
    job = get_job(job_id)
    with lock:
        if job['status'] not in {'complete', 'exported'}:
            raise HTTPException(409, '请先完成分析，并等待当前任务结束')
        try:
            clips = validate_segments([c.model_dump() for c in request.clips], job['duration'])
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        job.update(status='exporting', progress=0, message='等待剪辑')
        job['cancel'].clear()

    def work():
        try:
            render(job['path'], clips, job['directory'] / 'highlights.mp4',
                   lambda p, m: update(job_id, progress=p, message=m), job['cancel'])
            update(job_id, status='exported', progress=100, message='剪辑完成')
        except Exception as error:
            update(job_id, status='complete', progress=100, message=f'导出失败：{error}')
    executor.submit(work)
    return {'id': job_id}


@app.get('/api/jobs/{job_id}/video')
def video(job_id: str):
    job = get_job(job_id)
    if job['status'] != 'exported':
        raise HTTPException(409, '剪辑尚未完成')
    return FileResponse(job['directory'] / 'highlights.mp4', media_type='video/mp4', filename='matchclip-highlights.mp4')
