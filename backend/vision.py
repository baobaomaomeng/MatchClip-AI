"""Pose features from actual video frames, restricted to a green, end-on singles court.

No OCR or scoreboard pixels are used. This first version deliberately rejects
unsupported camera views rather than inventing visual/shuttle detections.
"""
from collections import deque

import cv2
import numpy as np


def court_quad(frame):
    h, w = frame.shape[:2]
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (32, 65, 45), (90, 255, 255))
    mask[:int(h * .22)] = 0  # exclude the scoreboard and stands
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    hull = cv2.convexHull(max(contours, key=cv2.contourArea))
    if cv2.contourArea(hull) < w * h * .20:
        return None
    points = hull.reshape(-1, 2).astype(np.float32)
    sums, diffs = points.sum(axis=1), points[:, 0] - points[:, 1]
    tl, tr = points[np.argmin(sums)], points[np.argmax(diffs)]
    br, bl = points[np.argmax(sums)], points[np.argmin(diffs)]
    top, bottom = np.array([tl, tr]), np.array([bl, br])
    top_width, bottom_width = tr[0] - tl[0], br[0] - bl[0]
    if not (.28*h < top[:, 1].mean() < .58*h and bottom[:, 1].mean() > .82*h):
        return None
    if not (.32 < top_width / max(1, bottom_width) < .85):
        return None
    if abs(top[:, 0].mean() - bottom[:, 0].mean()) > .13*w:
        return None
    if abs(tl[1] - tr[1]) > .09*h or abs(bl[1] - br[1]) > .12*h:
        return None
    return np.array([tl, tr, br, bl], dtype=np.float32)


class PoseFeatures:
    def __init__(self, model, device='cpu', reference=None):
        self.model, self.device = model, device
        self.previous = {}
        self.history = {0: deque(maxlen=3), 1: deque(maxlen=3)}
        self.reference = reference
        self.expected = reference

    def extract(self, frame, t):
        quad = court_quad(frame)
        if quad is not None and self.expected is not None and np.abs(quad-self.expected).mean() > frame.shape[1]*.04:
            quad = None
        output = {'t': round(t, 3), 'motion_score': 0., 'court_visible': quad is not None,
                  'players_visible': 0, 'hit_audio': False, 'hit_visual': False,
                  'shuttle_held': False, 'shuttle_ground': False}
        if quad is None:
            self.previous.clear()
            self.reference = self.expected
            for values in self.history.values():
                values.clear()
            return output
        if self.reference is None or np.abs(self.reference - quad).mean() > frame.shape[1] * .05:
            self.reference = quad
            self.previous.clear()
        transform = cv2.getPerspectiveTransform(self.reference, np.array([[0, 0], [1, 0], [1, 1], [0, 1]], np.float32))
        # Mask overlay/stands before model inference; this is not scoreboard-dependent.
        masked = frame.copy()
        masked[:int(frame.shape[0] * .22)] = 0
        h, w = frame.shape[:2]
        x0, x1, y0, y1 = int(w*.27), int(w*.75), int(h*.22), int(h*.62)
        # Far players occupy only tens of pixels in a broadcast frame. A second,
        # cropped inference preserves enough detail to find their pose.
        results = self.model.predict([masked, masked[y0:y1, x0:x1]], imgsz=640,
                                     conf=.25, device=self.device, verbose=False)
        detections = []
        for index, result in enumerate(results):
            if result.keypoints is None:
                continue
            poses = result.keypoints.data.cpu().numpy().copy()
            boxes = result.boxes.xyxy.cpu().numpy().copy()
            if index:
                poses[:, :, :2] += np.array([x0, y0])
                boxes += np.array([x0, y0, x0, y0])
            detections.extend((pose, box, bool(index)) for pose, box in zip(poses, boxes))
        players = {}
        for pose, box, far_crop in detections:
            ankles = pose[15:17]
            valid = ankles[:, 2] > .3
            foot = ankles[valid, :2].mean(axis=0) if valid.any() else np.array([(box[0]+box[2])/2, box[3]])
            ground = cv2.perspectiveTransform(foot.reshape(1, 1, 2).astype(np.float32), transform)[0, 0]
            if not (-.12 <= ground[0] <= 1.12 and -.10 <= ground[1] <= 1.12):
                continue
            side = int(ground[1] >= .5)
            if far_crop and side != 0:
                continue
            # Choose the strongest player in each half, excluding the umpire/line judges.
            strength = float(pose[5:17, 2].mean())
            if side not in players or strength > players[side][0]:
                players[side] = (strength, ground, pose, box)
        output['players_visible'] = len(players)
        scores = []
        for side, (_, ground, pose, box) in players.items():
            body_height = max(12., float(box[3] - box[1]))
            hip = (pose[11, :2] + pose[12, :2]) / 2
            relative_wrists = (pose[9:11, :2] - hip) / body_height
            valid_wrists = pose[9:11, 2] > .35
            previous = self.previous.get(side)
            score = 0.
            if previous and .05 < t - previous['t'] < .8:
                dt = t - previous['t']
                speed = float(np.linalg.norm(ground - previous['ground'])) / dt
                valid = valid_wrists & previous['valid']
                arm_speed = float(np.linalg.norm(relative_wrists[valid] - previous['wrists'][valid], axis=1).max()) / dt if valid.any() else 0.
                # Translation plus relative arm motion. Neither is a shuttle/hit detector.
                score = .45 * min(1., speed / .35) + .55 * min(1., arm_speed / 2.)
            self.history[side].append(score)
            scores.append(float(np.mean(self.history[side])))
            self.previous[side] = {'t': t, 'ground': ground, 'wrists': relative_wrists, 'valid': valid_wrists}
        if len(scores) == 2:
            output['motion_score'] = round((max(scores) * .65 + min(scores) * .35), 4)
        return output
