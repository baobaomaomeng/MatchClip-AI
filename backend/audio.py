"""Local spectral transients. These are evidence, never ground-truth hit counts."""
import subprocess
import threading

import imageio_ffmpeg
import numpy as np
from scipy.ndimage import median_filter
from scipy.signal import find_peaks, stft


def transients(path, start, end, cancel: threading.Event):
    command = [imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-ss', str(start),
               '-i', str(path), '-t', str(end - start), '-vn', '-ac', '1',
               '-ar', '16000', '-f', 'f32le', 'pipe:1']
    hits = []
    # Temporary stderr avoids pipe deadlocks; missing/broken audio is not mocked.
    import tempfile
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors)
        offset, tail = start, np.empty(0, dtype=np.float32)
        try:
            while not cancel.is_set():
                chunk = process.stdout.read(16000 * 4 * 30)
                if not chunk:
                    break
                raw = np.frombuffer(chunk, dtype='<f4')
                data = np.concatenate([tail, raw])
                if len(data) < 512:
                    break
                freq, times, spectrum = stft(data, fs=16000, nperseg=512,
                                             noverlap=352, boundary=None)
                magnitude = np.abs(spectrum)
                high = magnitude[(freq >= 2000) & (freq <= 7500)]
                # Positive spectral change detects an onset, not sustained loudness.
                flux = np.maximum(np.diff(high, axis=1, prepend=high[:, :1]), 0).sum(axis=0)
                baseline = median_filter(flux, size=151)
                deviation = median_filter(np.abs(flux - baseline), size=151)
                novelty = (flux - baseline) / np.maximum(deviation * 1.4826, 1e-5)
                peaks, _ = find_peaks(novelty, height=5, distance=12, prominence=3)
                for i in peaks:
                    t = offset - len(tail) / 16000 + times[i]
                    if t >= start and t < end and (not hits or t - hits[-1] > .12):
                        hits.append(round(float(t), 3))
                offset += len(raw) / 16000
                tail = data[-16000:]
            if cancel.is_set():
                raise InterruptedError('分析已取消')
            if process.wait() != 0:
                errors.seek(0)
                raise ValueError('音轨解码失败：' + errors.read().decode(errors='replace')[-500:])
        finally:
            if process.poll() is None:
                process.terminate()
            process.wait()
            process.stdout.close()
    return hits
