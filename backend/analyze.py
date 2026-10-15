import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import urllib.request

import cv2
import imageio_ffmpeg
import numpy as np

from .audio import transients
from .temporal import segment
from .vision import PoseFeatures, court_quad

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get('MATCHCLIP_DATA', ROOT / '.matchclip'))
MODEL_URL = 'https://huggingface.co/Ultralytics/YOLO11/resolve/main/yolo11n-pose.pt'


def probe(path):
    cap = cv2.VideoCapture(str(path))
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if not cap.isOpened() or not np.isfinite([fps,count]).all() or fps <= 0 or count <= 0 or not width or not height:
            raise ValueError('无法读取视频，请使用包含视频轨道的 MP4 或 MOV')
        return {'duration': count / fps, 'width': width, 'height': height}
    finally:
        cap.release()


def load_model():
    # Load only the named official weight; no client-supplied model paths.
    (DATA / 'settings').mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('YOLO_CONFIG_DIR', str(DATA / 'settings'))
    from ultralytics import YOLO
    model_path = DATA / 'models' / 'yolo11n-pose.pt'
    model_path.parent.mkdir(parents=True, exist_ok=True)
    if not model_path.exists():
        temporary = model_path.with_suffix('.download')
        with urllib.request.urlopen(MODEL_URL, timeout=60) as response, temporary.open('wb') as target:
            import shutil
            shutil.copyfileobj(response, target)
        temporary.replace(model_path)
    return YOLO(str(model_path))


def analyze(path, start=0., end=None, progress=lambda *_: None, cancel=None):
    cancel = cancel or threading.Event()
    info = probe(path)
    end = min(info['duration'], end) if end is not None else info['duration']
    if not np.isfinite([start, end]).all() or not 0 <= start < end:
        raise ValueError('分析范围无效：开始时间必须小于结束时间')
    progress(2, '提取音频瞬态')
    warnings = ['候选片段须复核；活动强度不是准确率，音频事件不是准确拍数。',
                '当前支持绿色球场、底线主机位的单打；热身与同机位回放尚不能可靠自动排除。']
    try:
        hits = transients(path, start, end, cancel)
    except ValueError as error:
        hits = []
        warnings.append(str(error) + '；本次仅使用画面，未生成模拟音频。')
    if cancel.is_set():
        raise InterruptedError('分析已取消')
    progress(10, '加载本地球员姿态模型（首次运行下载权重）')
    model = load_model()
    import torch
    # CPU is deterministic and portable; optional MPS/CUDA is selected explicitly.
    device = os.environ.get('MATCHCLIP_DEVICE', 'cpu')
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    # Calibrate the dominant end-on court geometry from sparse frames. This
    # excludes zoomed replay views even when a green quadrilateral is visible.
    references = []
    calibration = cv2.VideoCapture(str(path))
    try:
        for t in np.linspace(start, max(start, end-.1), 48):
            if cancel.is_set():
                raise InterruptedError('分析已取消')
            calibration.set(cv2.CAP_PROP_POS_MSEC, float(t)*1000)
            ok, image = calibration.read()
            if ok:
                scaled = cv2.resize(image, (640, round(info['height']/info['width']*640/2)*2))
                quad = court_quad(scaled)
                if quad is not None:
                    references.append(quad)
    finally:
        calibration.release()
    if len(references) < 3:
        raise ValueError('没有足够的底线主镜头供校准，请扩大分析范围或使用完整比赛视频')
    arrays = np.array(references)
    distances = np.abs(arrays[:, None] - arrays[None, :]).mean(axis=(2,3))
    best = int((distances < 15).sum(axis=1).argmax())
    reference = np.median(arrays[distances[best] < 15], axis=0).astype(np.float32)
    extractor = PoseFeatures(model, device, reference)
    width, fps = 640, 5
    height = round(info['height'] / info['width'] * width / 2) * 2
    command = [imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-ss', str(start), '-i', str(path),
               '-t', str(end-start), '-an', '-vf', f'fps={fps},scale={width}:{height}',
               '-f', 'rawvideo', '-pix_fmt', 'bgr24', 'pipe:1']
    frames = []
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors)
        try:
            while not cancel.is_set():
                raw = process.stdout.read(width * height * 3)
                if not raw:
                    break
                if len(raw) != width * height * 3:
                    raise ValueError('视频解码返回了不完整的帧')
                t = start + len(frames) / fps
                frame = np.frombuffer(raw, np.uint8).reshape(height, width, 3)
                frames.append(extractor.extract(frame, t))
                if len(frames) % 100 == 0:
                    progress(min(94, 12 + 82*(t-start)/(end-start)), f'分析球员动作 {t-start:.0f} / {end-start:.0f} 秒')
            if cancel.is_set():
                raise InterruptedError('分析已取消')
            if process.wait() != 0:
                errors.seek(0)
                raise ValueError('视频解码失败：' + errors.read().decode(errors='replace')[-500:])
        finally:
            if process.poll() is None:
                process.terminate()
            process.wait()
            process.stdout.close()
    if not frames or not any(f['players_visible'] == 2 for f in frames):
        raise ValueError('未找到可分析的底线双人主镜头。当前版本支持绿色球场单打，无法用此机位生成可靠候选。')
    progress(96, '融合动作序列与音频，生成待复核片段')
    rallies = segment(frames, hits, start, end, fps)
    return {'metadata': {'version': '2.0', 'sourceFile': Path(path).name,
                         'sourceDuration': info['duration'], 'analysisStart': start, 'analysisEnd': end,
                         'method': 'yolo11n-pose + spectral-onset + temporal-rules-v1',
                         'scoreboardUsed': False, 'sampleFps': fps, 'warnings': warnings},
            'rallies': rallies, 'frames': frames}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='本地姿态与音频回合候选分析（不读取计分牌）')
    parser.add_argument('video', type=Path)
    parser.add_argument('--start', type=float, default=0.)
    parser.add_argument('--end', type=float)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = analyze(args.video, args.start, args.end,
                     progress=lambda p, m: print(f'{p:.0f}% {m}', flush=True))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"完成：{len(result['rallies'])} 个待复核候选；{args.output}")
