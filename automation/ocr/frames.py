"""Bounded local video sampling; writes only to the supplied private audit directory."""
import argparse
import json
from pathlib import Path
import math
import cv2

def extract(video, output, limit=90):
    output = Path(output)
    frames_dir = output / 'frames'
    frames_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise ValueError('Video decoder unavailable')
    fps, count = cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT)
    if not math.isfinite(fps) or not math.isfinite(count) or fps <= 0 or count <= 0 or count / fps > 185:
        cap.release()
        raise ValueError('Invalid video or duration exceeds 180-second OCR limit')
    duration = count / fps
    step = max(1, duration / limit)
    rows = []
    try:
        for index in range(min(limit, math.ceil(duration / step))):
            seconds = index * step
            cap.set(cv2.CAP_PROP_POS_FRAMES, round(seconds * fps))
            actual = cap.get(cv2.CAP_PROP_POS_FRAMES) / fps
            ok, frame = cap.read()
            if not ok:
                continue
            height, width = frame.shape[:2]
            # Upscaling can improve OCR segmentation; it does not add source detail.
            ratio = min(2, 2000 / max(height, width))
            frame = cv2.resize(frame, (max(1, round(width * ratio)), max(1, round(height * ratio))))
            name = f'frame-{index:04d}.jpg'
            encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 92])[1]
            encoded.tofile(str(frames_dir / name))
            rows.append({'file': name, 'seconds': round(actual, 3), 'width': frame.shape[1], 'height': frame.shape[0]})
    finally:
        cap.release()
    if not rows:
        raise ValueError('No usable frames')
    (output / 'frames.json').write_text(json.dumps(rows), encoding='utf-8')
    return rows

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--video', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps({'frames':len(extract(args.video, args.output))}))
