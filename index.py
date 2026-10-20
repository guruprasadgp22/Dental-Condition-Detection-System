import json
import os
import shutil
import time
import uuid
from collections import Counter
from datetime import datetime, timezone

import cv2
import numpy as np
from flask import Flask, abort, jsonify, redirect, render_template, request

from inference import detect, get_model


def load_env_file(path):
    """Read KEY=VALUE lines from a local .env file (kept out of git) into os.environ."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


load_env_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

# Firebase web config comes from environment variables / .env, never from source code
FIREBASE_CONFIG = {
    "apiKey": os.environ.get("FIREBASE_API_KEY", ""),
    "authDomain": os.environ.get("FIREBASE_AUTH_DOMAIN", ""),
    "projectId": os.environ.get("FIREBASE_PROJECT_ID", ""),
    "storageBucket": os.environ.get("FIREBASE_STORAGE_BUCKET", ""),
    "messagingSenderId": os.environ.get("FIREBASE_MESSAGING_SENDER_ID", ""),
    "appId": os.environ.get("FIREBASE_APP_ID", ""),
}
if not FIREBASE_CONFIG["apiKey"]:
    print("WARNING: FIREBASE_API_KEY is not set. Copy .env.example to .env and fill it in; sign-in will not work.")

app = Flask(__name__)


@app.context_processor
def inject_firebase_config():
    return {"firebase_config": FIREBASE_CONFIG}
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB upload limit
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 7 * 24 * 3600  # let browsers cache static files

RESULTS_DIR = os.path.join(app.root_path, "static", "results")
RESULT_TTL_SECONDS = int(os.environ.get("RESULT_TTL_HOURS", "24")) * 3600
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png"}

CONDITION_INFO = {
    "caries": {
        "title": "Caries",
        "slug": "caries",
        "image": "caries.jpg",
        "severity": "moderate",
        "short": "Early tooth decay of the enamel and dentin.",
        "description": "Dental caries, or tooth decay, happens when plaque turns sugars into acid that damages the hard surface of the tooth. Left untreated it grows into a cavity. Common signs are sensitivity, toothache and visible pits or dark spots.",
        "advice": "Early tooth decay. Usually treated with a filling; book a routine dental visit.",
    },
    "deep caries": {
        "title": "Deep Caries",
        "slug": "deep-caries",
        "image": "deep caries.jpg",
        "severity": "high",
        "short": "Advanced decay reaching close to the pulp.",
        "description": "Deep caries is advanced decay that reaches the deeper layers of the tooth, close to or into the pulp. It can cause severe pain and infection, and may lead to an abscess or tooth loss without prompt treatment.",
        "advice": "Decay close to the pulp. May need a deep filling or root canal; see a dentist soon.",
    },
    "impacted": {
        "title": "Impacted Tooth",
        "slug": "impacted",
        "image": "impacted.jpg",
        "severity": "moderate",
        "short": "A tooth that has not erupted properly.",
        "description": "An impacted tooth is blocked from fully coming through the gum, most often a wisdom tooth. It can cause pain, swelling and infection, and may damage or crowd the neighbouring teeth.",
        "advice": "Tooth that has not erupted properly (often a wisdom tooth). A dentist may recommend monitoring or extraction.",
    },
    "peripheral lesion": {
        "title": "Peripheral Lesion",
        "slug": "peripheral-lesion",
        "image": "peripheral.jpg",
        "severity": "high",
        "short": "Abnormal growth or injury in surrounding tissue.",
        "description": "A peripheral lesion is an abnormal growth or injury in the tissues around the teeth, such as the gums or jaw bone. Many are harmless, but they always need a clinical check to rule out anything serious.",
        "advice": "Abnormal growth or lesion in the surrounding tissue. Needs clinical evaluation.",
    },
}

os.makedirs(RESULTS_DIR, exist_ok=True)


def cleanup_old_results():
    """Delete result folders created by /process older than RESULT_TTL_SECONDS."""
    cutoff = time.time() - RESULT_TTL_SECONDS
    for entry in os.scandir(RESULTS_DIR):
        if not entry.is_dir() or entry.stat().st_mtime >= cutoff:
            continue
        try:
            uuid.UUID(entry.name)
        except ValueError:
            continue  # only touch folders this app created
        shutil.rmtree(entry.path, ignore_errors=True)


def load_result(result_id):
    try:
        uuid.UUID(result_id)
    except ValueError:
        abort(404)
    path = os.path.join(RESULTS_DIR, result_id, "result.json")
    if not os.path.exists(path):
        abort(404)
    with open(path) as f:
        return json.load(f)


@app.route("/")
def home():
    return render_template("home.html", conditions=CONDITION_INFO)


@app.route("/login")
def login():
    return render_template("login.html")


@app.route("/scan")
def scan():
    return render_template("scan.html")


@app.route("/profile")
def profile():
    return render_template("profile.html")


@app.route("/conditions")
def conditions():
    return render_template("conditions.html", conditions=CONDITION_INFO)


# Old URLs from the previous version of the site
@app.route("/index")
def old_login():
    return redirect("/login", 301)


@app.route("/upload")
def old_upload():
    return redirect("/scan", 301)


@app.route("/detail")
def old_detail():
    return redirect("/conditions", 301)


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/report/<result_id>")
def report(result_id):
    return render_template("report.html", result=load_result(result_id))


@app.route("/process", methods=["POST"])
def process():
    uploaded_file = request.files.get("defected_image")
    if uploaded_file is None or uploaded_file.filename == "":
        return jsonify({"Error": "No file selected"}), 400

    ext = os.path.splitext(uploaded_file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"Error": "Please upload a JPG, JPEG or PNG image."}), 400

    image = cv2.imdecode(np.frombuffer(uploaded_file.read(), np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return jsonify({"Error": "The file is not a readable image."}), 400

    try:
        conf = min(max(float(request.form.get("confidence", 0.25)), 0.05), 0.95)
    except ValueError:
        conf = 0.25

    try:
        annotated, detections = detect(image, conf_thres=conf)
    except Exception as e:
        app.logger.exception("Detection failed")
        return jsonify({"Error": f"Detection failed: {e}"}), 500

    cleanup_old_results()
    result_id = str(uuid.uuid4())
    out_dir = os.path.join(RESULTS_DIR, result_id)
    os.makedirs(out_dir)
    cv2.imwrite(os.path.join(out_dir, "original.jpg"), image)
    cv2.imwrite(os.path.join(out_dir, "detected.jpg"), annotated)

    counts = Counter(d["label"] for d in detections)
    summary = []
    for label, n in counts.most_common():
        info = CONDITION_INFO.get(label, {})
        summary.append({
            "label": label,
            "count": n,
            "title": info.get("title", label),
            "severity": info.get("severity", "unknown"),
            "advice": info.get("advice", ""),
        })
    base_url = f"/static/results/{result_id}"
    result = {
        "id": result_id,
        "created": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "filename": os.path.basename(uploaded_file.filename),
        "confidence_threshold": conf,
        "original": f"{base_url}/original.jpg",
        "detected": f"{base_url}/detected.jpg",
        "detections": detections,
        "summary": summary,
    }
    with open(os.path.join(out_dir, "result.json"), "w") as f:
        json.dump(result, f)

    return jsonify({
        **result,
        "DetectedTooth": result["detected"],
        "report": f"/report/{result_id}",
        "Message": "Image detection successful" if detections else "No conditions detected",
    })


@app.errorhandler(404)
def not_found(_):
    if request.path.startswith("/process"):
        return jsonify({"Error": "Not found"}), 404
    return render_template("404.html"), 404


@app.errorhandler(413)
def too_large(_):
    return jsonify({"Error": "Image is too large (max 10 MB)."}), 413


if os.environ.get("PRELOAD_MODEL", "1") == "1":
    get_model()

if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
