from pathlib import Path
import subprocess
import tempfile
import threading

import imageio_ffmpeg
import math


def validate_segments(segments, duration):
    if not 1 <= len(segments) <= 2000:
        raise ValueError('请选择 1–2000 个片段')
    ordered = sorted(segments, key=lambda s: s['start'])
    previous = 0.
    for item in ordered:
        a, b = item['start'], item['end']
        if not math.isfinite(a) or not math.isfinite(b) or not 0 <= a < b <= duration + .05:
            raise ValueError('片段起止时间超出原视频或无效')
        if a < previous - .001:
            raise ValueError('片段存在重叠，请先调整边界')
        previous = b
    return ordered


def render(source, segments, destination, progress=lambda *_: None, cancel=None):
    cancel = cancel or threading.Event()
    executable = imageio_ffmpeg.get_ffmpeg_exe()

    def run(arguments):
        with tempfile.TemporaryFile() as errors:
            process = subprocess.Popen([executable, '-hide_banner', '-loglevel', 'error', '-y', *arguments],
                                       stdout=subprocess.DEVNULL, stderr=errors)
            try:
                while process.poll() is None:
                    if cancel.wait(.2):
                        raise InterruptedError('导出已取消')
                if process.returncode:
                    errors.seek(0)
                    raise ValueError('FFmpeg 剪辑失败：' + errors.read().decode(errors='replace')[-800:])
            finally:
                if process.poll() is None:
                    process.terminate()
                process.wait()

    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as directory:
        directory = Path(directory)
        for i, clip in enumerate(segments):
            if cancel.is_set():
                raise InterruptedError('导出已取消')
            # Re-encode each segment: stream copy alone cannot give precise start boundaries.
            run(['-ss', str(clip['start']), '-i', str(source), '-t', str(clip['end']-clip['start']),
                 '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast',
                 '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
                 '-reset_timestamps', '1', str(directory / f'{i:05}.mp4')])
            progress(95*(i+1)/len(segments), f'已剪辑 {i+1} / {len(segments)} 个片段')
        manifest = directory / 'clips.txt'
        manifest.write_text(''.join(f"file '{i:05}.mp4'\n" for i in range(len(segments))))
        run(['-f', 'concat', '-safe', '1', '-i', str(manifest), '-c', 'copy', '-movflags', '+faststart', str(destination)])
    progress(100, '剪辑完成')
