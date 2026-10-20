# Dental Condition Detection Using Machine Learning

Detects dental conditions on panoramic X-rays with a YOLOv5 model (`best.pt`) served by Flask.

Detected classes: **caries**, **deep caries**, **impacted tooth**, **peripheral lesion**.

## Features

- Fast, lightweight pages (the home page is about 110 KB, down from 20 MB+ of GIFs) with automatic light and dark mode
- Sign in with Google or email, create an account, reset a forgotten password (Firebase)
- Drag-and-drop, click, or paste an X-ray (JPG/PNG, up to 10 MB), or try the built-in sample
- Adjustable confidence threshold
- Interactive viewer: colour-coded boxes, show/hide each condition, toggle boxes and labels, hover a finding to highlight it
- Summary of findings, highest priority and analysis time
- Printable report page (`/report/<id>`) that you can save as a PDF; download the marked image
- Recent scans list (stored in your browser)
- Automatic CPU / CUDA / Apple MPS device selection
- Old results are deleted automatically (default 24 h, set with `RESULT_TTL_HOURS`)

## Pages

| URL | Page |
| --- | --- |
| `/` | Home |
| `/login` | Sign in / create account |
| `/scan` | Upload and analyse an X-ray (requires sign-in) |
| `/profile` | Your basic details, security and recent scans (requires sign-in) |
| `/conditions` | Information about each condition |
| `/report/<id>` | Printable report |

## How the model runs

The server runs `best.onnx` (the YOLOv5 model `best.pt` exported to ONNX) with `onnxruntime`,
so hosting needs no PyTorch and uses about 250 MB of RAM. After retraining, re-export with:

```bash
python export.py --weights best.pt --include onnx --imgsz 640 --simplify
```

## Run locally

```bash
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # then fill in your Firebase web config
python index.py            # open http://127.0.0.1:5000
```

## Deploy to Render (free)

1. Push this folder to a GitHub repository.
2. Sign in at https://render.com with GitHub → **New** → **Blueprint** → pick the repository.
   Render reads `render.yaml` and builds the `Dockerfile` on the free plan.
3. When the build finishes, the site is live at `https://dentes-xxxx.onrender.com`.
   Every `git push` redeploys automatically.

Free services sleep after 15 minutes without visitors; the first visit after that takes about a minute to wake up.

**Firebase setup (once):**
- Authentication → Settings → Authorized domains: add your `onrender.com` domain, or sign-in will fail.
- Firestore → Rules: paste the contents of `firestore.rules`, so each user can only read and edit their own profile.

The `Dockerfile` also runs on any other Docker host (Koyeb, Railway, Google Cloud Run); it reads the `PORT` environment variable.

## Disclaimer

This is a screening aid, not a medical diagnosis.
