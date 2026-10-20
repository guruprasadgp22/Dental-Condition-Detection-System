"""Run the dental YOLOv5 model (exported to ONNX) on in-memory images.

Uses onnxruntime + NumPy only, so the server needs no PyTorch and fits in ~200 MB of RAM.
Re-create best.onnx after retraining with:
    python export.py --weights best.pt --include onnx --imgsz 640 --simplify
"""

import ast
import os
import threading
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parent
WEIGHTS = Path(os.environ.get("MODEL_WEIGHTS", ROOT / "best.onnx"))
IMG_SIZE = 640

# BGR colours per class, so each condition is easy to tell apart on the X-ray
CLASS_COLORS = {
    "caries": (0, 200, 255),
    "deep caries": (0, 0, 255),
    "impacted": (255, 140, 0),
    "peripheral lesion": (200, 0, 200),
}

_session = None
_names = None
_lock = threading.Lock()


def get_model():
    global _session, _names
    if _session is None:
        with _lock:
            if _session is None:
                opts = ort.SessionOptions()
                opts.intra_op_num_threads = int(os.environ.get("ORT_THREADS", "2"))
                session = ort.InferenceSession(str(WEIGHTS), opts, providers=["CPUExecutionProvider"])
                meta = session.get_modelmeta().custom_metadata_map
                names = ast.literal_eval(meta["names"]) if "names" in meta else {}
                _names = {int(k): v for k, v in names.items()}
                _session = session
    return _session


def letterbox(image, size=IMG_SIZE, color=(114, 114, 114)):
    """Resize keeping aspect ratio and pad to a size x size square."""
    h, w = image.shape[:2]
    r = min(size / h, size / w)
    new_w, new_h = round(w * r), round(h * r)
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    pad_x, pad_y = (size - new_w) / 2, (size - new_h) / 2
    top, bottom = round(pad_y - 0.1), round(pad_y + 0.1)
    left, right = round(pad_x - 0.1), round(pad_x + 0.1)
    padded = cv2.copyMakeBorder(resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)
    return padded, r, (left, top)


def nms(boxes, scores, iou_thres):
    """Plain NumPy non-maximum suppression; returns kept indices."""
    x1, y1, x2, y2 = boxes.T
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-9)
        order = order[1:][iou <= iou_thres]
    return np.array(keep, dtype=int)


def postprocess(pred, conf_thres, iou_thres, max_det=300):
    """YOLOv5 output (N, 5 + classes) -> array of [x1, y1, x2, y2, conf, cls] in letterbox space."""
    pred = pred[pred[:, 4] > conf_thres]
    if not len(pred):
        return np.zeros((0, 6))
    scores_all = pred[:, 5:] * pred[:, 4:5]  # conf = obj_conf * cls_conf
    cls = scores_all.argmax(1)
    conf = scores_all[np.arange(len(pred)), cls]
    mask = conf > conf_thres
    pred, cls, conf = pred[mask], cls[mask], conf[mask]
    if not len(pred):
        return np.zeros((0, 6))
    xy, wh = pred[:, :2], pred[:, 2:4]
    boxes = np.concatenate([xy - wh / 2, xy + wh / 2], axis=1)
    keep = nms(boxes + cls[:, None] * 7680, conf, iou_thres)[:max_det]  # offset boxes so NMS is per class
    return np.concatenate([boxes[keep], conf[keep, None], cls[keep, None]], axis=1)


def detect(image_bgr, conf_thres=0.25, iou_thres=0.45):
    """Return (annotated image, list of detections) for a BGR numpy image."""
    session = get_model()

    padded, ratio, (pad_x, pad_y) = letterbox(image_bgr)
    blob = padded[:, :, ::-1].transpose(2, 0, 1)  # BGR to RGB, HWC to CHW
    blob = np.ascontiguousarray(blob, dtype=np.float32)[None] / 255.0

    with _lock:
        pred = session.run(None, {session.get_inputs()[0].name: blob})[0][0]
    det = postprocess(pred, conf_thres, iou_thres)

    h, w = image_bgr.shape[:2]
    annotated = image_bgr.copy()
    detections = []
    if len(det):
        det[:, [0, 2]] = ((det[:, [0, 2]] - pad_x) / ratio).clip(0, w)
        det[:, [1, 3]] = ((det[:, [1, 3]] - pad_y) / ratio).clip(0, h)
        short_side = min(h, w)
        line = max(1, round(short_side * 0.004))
        scale = max(0.3, short_side / 900)
        thickness = max(1, round(scale * 1.5))
        for x1, y1, x2, y2, conf, cls in det.round(3).tolist():
            name = _names.get(int(cls), str(int(cls)))
            x1, y1, x2, y2 = map(int, map(round, (x1, y1, x2, y2)))
            detections.append({
                "label": name,
                "confidence": round(float(conf), 3),
                "box": [x1, y1, x2, y2],
            })
            color = CLASS_COLORS.get(name, (0, 255, 0))
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, line)
            text = f"{name} {conf:.2f}"
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)
            pad = max(2, th // 4)
            top = y1 - th - 2 * pad if y1 - th - 2 * pad > 0 else y2
            cv2.rectangle(annotated, (x1, top), (x1 + tw + 2 * pad, top + th + 2 * pad), color, -1)
            cv2.putText(annotated, text, (x1 + pad, top + th + pad), cv2.FONT_HERSHEY_SIMPLEX,
                        scale, (255, 255, 255), thickness, cv2.LINE_AA)

    detections.sort(key=lambda d: d["confidence"], reverse=True)
    return annotated, detections
