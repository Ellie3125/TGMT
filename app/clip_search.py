from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any
from urllib.parse import quote

import numpy as np
from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATASET_DIR = (PROJECT_ROOT / "dataset").resolve()
EMBEDDINGS_DIR = (PROJECT_ROOT / "embeddings").resolve()
EMBEDDINGS_FILE = EMBEDDINGS_DIR / "clip_image_embeddings.npy"
META_FILE = EMBEDDINGS_DIR / "clip_image_metadata.json"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
CLIP_MODEL_NAME = "openai/clip-vit-base-patch32"
BATCH_SIZE = 32

# Các biến cache này giúp app không phải tải lại model và embedding sau mỗi lần tìm kiếm.
_lock = threading.Lock()
_model = None
_processor = None
_device = None
_image_paths: list[Path] | None = None
_image_embeddings: np.ndarray | None = None
_image_signature: list[dict[str, Any]] | None = None


def _list_image_paths(dataset_dir: Path = DATASET_DIR) -> list[Path]:
    """Quét toàn bộ file ảnh có phần mở rộng hợp lệ trong thư mục dataset."""
    dataset_dir = Path(dataset_dir).resolve()
    if not dataset_dir.exists():
        raise FileNotFoundError(f"Dataset folder not found: {dataset_dir}")

    return sorted(
        path
        for path in dataset_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def scan_image_paths(dataset_dir: Path = DATASET_DIR) -> list[Path]:
    """Quét toàn bộ ảnh hợp lệ trong thư mục dataset."""
    dataset_dir = Path(dataset_dir).resolve()
    image_paths = _list_image_paths(dataset_dir)

    if len(image_paths) == 0:
        raise FileNotFoundError(
            f"No image files found in {dataset_dir}. "
            "Expected .jpg, .jpeg, .png, or .webp files."
        )

    return image_paths


def _dataset_signature(image_paths: list[Path]) -> list[dict[str, Any]]:
    """Tạo dấu vết của dataset để biết cache embedding còn dùng được không."""
    signature = []
    for path in image_paths:
        stat = path.stat()
        signature.append(
            {
                "path": path.resolve().as_posix(),
                "mtime_ns": stat.st_mtime_ns,
                "size": stat.st_size,
            }
        )
    return signature


def _clamp_top_k(top_k: int) -> int:
    """Giới hạn số kết quả trả về để API không trả quá nhiều ảnh trong một request."""
    try:
        numeric_top_k = int(top_k)
    except (TypeError, ValueError):
        numeric_top_k = 10

    return max(1, min(numeric_top_k, 50))


def _load_model():
    """Tải CLIP một lần, sau đó dùng lại cho các request tiếp theo."""
    global _model, _processor, _device

    if _model is not None and _processor is not None:
        return _model, _processor, _device

    import torch
    from transformers import CLIPModel, CLIPProcessor

    _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    _model = CLIPModel.from_pretrained(CLIP_MODEL_NAME).to(_device)
    _processor = CLIPProcessor.from_pretrained(CLIP_MODEL_NAME)
    _model.eval()

    return _model, _processor, _device


def _encode_images(images: list[Image.Image]) -> np.ndarray:
    """Chuyển danh sách ảnh thành vector đặc trưng CLIP đã chuẩn hóa."""
    import torch

    model, processor, device = _load_model()
    inputs = processor(images=images, return_tensors="pt", padding=True)
    inputs = {key: value.to(device) for key, value in inputs.items()}

    with torch.no_grad():
        features = model.get_image_features(**inputs)
        if hasattr(features, "pooler_output"):
            features = features.pooler_output
        elif isinstance(features, (tuple, list)):
            features = features[0]
        features = features / features.norm(dim=-1, keepdim=True)

    return features.cpu().numpy().astype("float32")


def _encode_texts(texts: list[str]) -> np.ndarray:
    """Chuyển danh sách mô tả text thành vector CLIP đã chuẩn hóa."""
    import torch

    model, processor, device = _load_model()
    inputs = processor(text=texts, return_tensors="pt", padding=True, truncation=True)
    inputs = {key: value.to(device) for key, value in inputs.items()}

    with torch.no_grad():
        features = model.get_text_features(**inputs)
        if hasattr(features, "pooler_output"):
            features = features.pooler_output
        elif isinstance(features, (tuple, list)):
            features = features[0]
        features = features / features.norm(dim=-1, keepdim=True)

    return features.cpu().numpy().astype("float32")


def _metadata_paths(metadata: dict[str, Any], fallback_paths: list[Path]) -> list[Path]:
    """Lấy danh sách ảnh đã được encode trong cache metadata."""
    indexed_paths = metadata.get("indexed_paths")
    if not indexed_paths:
        return fallback_paths

    return [Path(path).resolve() for path in indexed_paths]


def _load_cached_index(
    image_paths: list[Path],
    signature: list[dict[str, Any]] | None = None,
) -> tuple[list[Path], np.ndarray] | None:
    """Đọc embedding đã lưu nếu dataset chưa thay đổi."""
    if not EMBEDDINGS_FILE.exists() or not META_FILE.exists():
        return None

    try:
        metadata = json.loads(META_FILE.read_text(encoding="utf-8"))
        embeddings = np.load(EMBEDDINGS_FILE)
    except Exception:
        return None

    signature = signature or _dataset_signature(image_paths)
    indexed_paths = _metadata_paths(metadata, image_paths)

    if metadata.get("model_name") != CLIP_MODEL_NAME:
        return None
    if metadata.get("dataset_signature") != signature:
        return None
    if embeddings.shape[0] != len(indexed_paths):
        return None

    return indexed_paths, embeddings.astype("float32")


def _build_index(
    image_paths: list[Path],
    signature: list[dict[str, Any]] | None = None,
) -> tuple[list[Path], np.ndarray]:
    """Mã hóa toàn bộ ảnh trong dataset và lưu embedding xuống thư mục embeddings."""
    EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)
    signature = signature or _dataset_signature(image_paths)

    valid_paths: list[Path] = []
    batches: list[np.ndarray] = []

    for start in range(0, len(image_paths), BATCH_SIZE):
        batch_paths = image_paths[start : start + BATCH_SIZE]
        batch_images: list[Image.Image] = []
        batch_valid_paths: list[Path] = []

        for path in batch_paths:
            try:
                with Image.open(path) as image:
                    batch_images.append(image.convert("RGB"))
                batch_valid_paths.append(path)
            except Exception as exc:
                print(f"Skipping unreadable image {path}: {exc}")

        if len(batch_images) == 0:
            continue

        batches.append(_encode_images(batch_images))
        valid_paths.extend(batch_valid_paths)

    if len(batches) == 0:
        raise RuntimeError("Could not encode any dataset images.")

    embeddings = np.vstack(batches).astype("float32")
    metadata = {
        "model_name": CLIP_MODEL_NAME,
        "dataset_dir": DATASET_DIR.as_posix(),
        "dataset_signature": signature,
        "indexed_paths": [path.resolve().as_posix() for path in valid_paths],
    }

    np.save(EMBEDDINGS_FILE, embeddings)
    META_FILE.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    return valid_paths, embeddings


def _get_index(force_rebuild: bool = False) -> tuple[list[Path], np.ndarray]:
    """Lấy index hiện tại, ưu tiên cache trong RAM rồi đến cache trên ổ đĩa."""
    global _image_paths, _image_embeddings, _image_signature

    with _lock:
        image_paths = scan_image_paths(DATASET_DIR)
        current_signature = _dataset_signature(image_paths)

        if (
            not force_rebuild
            and _image_paths is not None
            and _image_embeddings is not None
            and _image_signature == current_signature
        ):
            return _image_paths, _image_embeddings

        # Dataset đã thay đổi so với RAM cache, nên bỏ cache cũ trước khi đọc/build lại.
        _image_paths = None
        _image_embeddings = None
        _image_signature = None

        if not force_rebuild:
            cached = _load_cached_index(image_paths, current_signature)
            if cached is not None:
                _image_paths, _image_embeddings = cached
                _image_signature = current_signature
                return _image_paths, _image_embeddings

        _image_paths, _image_embeddings = _build_index(image_paths, current_signature)
        _image_signature = current_signature
        return _image_paths, _image_embeddings


def _image_url_for_path(image_path: Path) -> str:
    """Đổi đường dẫn file thật thành URL mà trình duyệt có thể mở được."""
    relative_path = image_path.resolve().relative_to(DATASET_DIR)
    return "/dataset/" + quote(relative_path.as_posix())


def _format_results(
    dataset_paths: list[Path],
    scores: np.ndarray,
    top_k: int,
) -> list[dict[str, Any]]:
    """Định dạng kết quả tìm kiếm theo contract API đang dùng."""
    top_k = min(_clamp_top_k(top_k), len(dataset_paths))
    top_indices = np.argsort(scores)[::-1][:top_k]

    results = []
    for rank, index in enumerate(top_indices, start=1):
        dataset_image_path = dataset_paths[int(index)].resolve()
        results.append(
            {
                "rank": rank,
                "image_path": dataset_image_path.as_posix(),
                "image_url": _image_url_for_path(dataset_image_path),
                "score": float(scores[int(index)]),
                "filename": dataset_image_path.name,
            }
        )

    return results


def search_by_image(image_path: str, top_k: int = 10):
    """
    Mã hóa ảnh người dùng upload bằng CLIP, so sánh với embedding của dataset,
    rồi trả về top_k ảnh giống nhất trong thư mục dataset.
    """
    dataset_paths, dataset_embeddings = _get_index()

    with Image.open(image_path) as image:
        query_embedding = _encode_images([image.convert("RGB")])[0]

    scores = dataset_embeddings @ query_embedding
    return _format_results(dataset_paths, scores, top_k)


def search_by_text(text: str, top_k: int = 10):
    """
    Mã hóa mô tả text bằng CLIP, so sánh với image embedding của dataset,
    rồi trả về top_k ảnh khớp nhất trong thư mục dataset.
    """
    query_text = (text or "").strip()
    if not query_text:
        raise ValueError("Text query không được rỗng.")

    dataset_paths, dataset_embeddings = _get_index()
    query_embedding = _encode_texts([query_text])[0]
    scores = dataset_embeddings @ query_embedding
    return _format_results(dataset_paths, scores, top_k)


def force_rebuild_index() -> dict[str, Any]:
    """Rebuild thủ công index CLIP và trả về trạng thái sau khi build."""
    dataset_paths, dataset_embeddings = _get_index(force_rebuild=True)
    return {
        "dataset_exists": DATASET_DIR.exists(),
        "image_count": len(dataset_paths),
        "cache_exists": EMBEDDINGS_FILE.exists() and META_FILE.exists(),
        "cache_valid": True,
        "model_name": CLIP_MODEL_NAME,
        "embedding_shape": list(dataset_embeddings.shape),
    }


def get_index_status() -> dict[str, Any]:
    """Trả trạng thái dataset/cache mà không tự rebuild index."""
    dataset_exists = DATASET_DIR.exists()
    image_paths: list[Path] = []
    current_signature: list[dict[str, Any]] | None = None
    scan_error: str | None = None

    if dataset_exists:
        try:
            image_paths = _list_image_paths(DATASET_DIR)
            current_signature = _dataset_signature(image_paths)
        except Exception as exc:
            scan_error = str(exc)

    cache_exists = EMBEDDINGS_FILE.exists() and META_FILE.exists()
    cache_valid = False
    embedding_shape: list[int] | None = None

    if cache_exists:
        try:
            metadata = json.loads(META_FILE.read_text(encoding="utf-8"))
            embeddings = np.load(EMBEDDINGS_FILE, mmap_mode="r")
            embedding_shape = list(embeddings.shape)
            indexed_paths = _metadata_paths(metadata, image_paths)
            cache_valid = (
                current_signature is not None
                and metadata.get("model_name") == CLIP_MODEL_NAME
                and metadata.get("dataset_signature") == current_signature
                and embeddings.shape[0] == len(indexed_paths)
            )
        except Exception as exc:
            scan_error = scan_error or f"Could not read cache: {exc}"

    return {
        "dataset_exists": dataset_exists,
        "image_count": len(image_paths),
        "cache_exists": cache_exists,
        "cache_valid": cache_valid,
        "model_name": CLIP_MODEL_NAME,
        "embedding_shape": embedding_shape,
        "ram_cache_valid": _image_signature == current_signature and _image_embeddings is not None,
        "error": scan_error,
    }
