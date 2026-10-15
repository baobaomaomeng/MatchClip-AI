import tempfile
from pathlib import Path
import subprocess
import threading
import unittest
import imageio_ffmpeg
from backend.temporal import segment
from backend.export import validate_segments, render
from backend.analyze import probe


def frames(active=(3, 7), missing=None, end=12):
    result = []
    for i in range(end * 5):
        t = i / 5
        result.append({'t': t, 'court_visible': True, 'players_visible': 1 if missing and missing[0] <= t < missing[1] else 2,
                       'motion_score': .8 if active[0] <= t < active[1] else .05})
    return result


class TemporalTests(unittest.TestCase):
    def test_audio_alone_cannot_create_a_rally(self):
        self.assertEqual(segment(frames(active=(0, 0)), [i/5 for i in range(60)], 0, 12), [])

    def test_video_alone_works_without_scoreboard_or_audio(self):
        clips = segment(frames(), [], 0, 12)
        self.assertEqual(len(clips), 1)
        self.assertLess(clips[0]['start'], 3)
        self.assertGreater(clips[0]['end'], 7)
        self.assertIsNone(clips[0]['winner'])
        self.assertIsNone(clips[0]['serverSide'])

    def test_short_rallies_are_not_discarded_for_fewer_than_four_hits(self):
        clips = segment(frames(active=(3, 3.8)), [3.1], 0, 12)
        self.assertEqual(len(clips), 1)
        self.assertLess(clips[0]['hits'], 4)

    def test_brief_pose_dropout_does_not_split_rally(self):
        self.assertEqual(len(segment(frames(missing=(4, 4.6)), [], 0, 12)), 1)

    def test_range_end_is_clamped_and_flagged(self):
        clips = segment(frames(active=(3, 12)), [], 0, 12)
        self.assertEqual(clips[0]['end'], 12)
        self.assertIn('分析范围结束', clips[0]['reviewReasons'])

    def test_separated_rallies_remain_separate_and_disjoint(self):
        fs = frames()
        for f in fs:
            if 10 <= f['t'] < 12:
                f['motion_score'] = .8
        clips = segment(fs, [], 0, 12)
        self.assertEqual(len(clips), 2)
        self.assertLessEqual(clips[0]['end'], clips[1]['start'])

    def test_scene_cut_ends_with_review_reason(self):
        fs = frames()
        for f in fs:
            if f['t'] >= 5: f['court_visible'] = False
        clips = segment(fs, [], 0, 12)
        self.assertLess(clips[0]['end'], 6)
        self.assertTrue(any('主镜头' in r for r in clips[0]['reviewReasons']))


class ExportTests(unittest.TestCase):
    def test_invalid_ranges(self):
        for segments in [[], [{'start': float('nan'), 'end': 4}], [{'start': 3, 'end': 2}],
                         [{'start': 0, 'end': 11}], [{'start': 0, 'end': 3}, {'start': 2, 'end': 4}]]:
            with self.assertRaises(ValueError): validate_segments(segments, 10)

    def test_real_ffmpeg_export_shortens_video(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory)/'source.mp4', Path(directory)/'out.mp4'
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=3',
                            '-f', 'lavfi', '-i', 'sine=frequency=500:duration=3', '-c:v', 'libx264', '-c:a', 'aac', str(source)], check=True)
            render(source, [{'start': .4, 'end': 1.1}, {'start': 2, 'end': 2.6}], target)
            self.assertTrue(target.exists())
            self.assertAlmostEqual(probe(target)['duration'], 1.3, delta=.15)

    def test_cancel_does_not_report_success(self):
        event = threading.Event(); event.set()
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(InterruptedError):
                render('unused.mp4', [{'start': 0, 'end': 1}], Path(directory)/'out.mp4', cancel=event)


if __name__ == '__main__': unittest.main()
