from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.clip_search import (
    DATASET_DIR,
    force_rebuild_index,
    get_index_status,
    search_by_image,
    search_by_text,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = Path(__file__).resolve().parent / "static"
UPLOAD_DIR = PROJECT_ROOT / "uploads"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="CLIP Image Retrieval")

# Mount dataset để frontend có thể hiển thị ảnh kết quả bằng URL /dataset/...
app.mount("/dataset", StaticFiles(directory=str(DATASET_DIR)), name="dataset")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class TextSearchRequest(BaseModel):
    text: str
    top_k: int = 10


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "dataset_dir": DATASET_DIR.as_posix(),
        "dataset_exists": DATASET_DIR.exists(),
    }


@app.post("/api/search/image")
async def search_image(file: UploadFile = File(...), top_k: int = Form(10)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Vui lòng upload một file ảnh.")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        suffix = ".jpg"

    temp_image_path = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"

    try:
        # Ảnh upload chỉ là ảnh truy vấn tạm thời, không được đưa vào dataset kết quả.
        with temp_image_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        results = search_by_image(str(temp_image_path), top_k=top_k)
        return {"results": results}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        await file.close()
        try:
            temp_image_path.unlink(missing_ok=True)
        except Exception:
            pass


@app.post("/api/search/text")
def search_text(payload: TextSearchRequest):
    try:
        results = search_by_text(payload.text, top_k=payload.top_k)
        return {"results": results}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/index/status")
def index_status():
    return get_index_status()


@app.post("/api/index/rebuild")
def rebuild_index():
    try:
        return force_rebuild_index()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
