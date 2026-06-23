# CLIP Image Retrieval Web App

Project này là web app tìm kiếm ảnh trong `D:/TGMT/dataset` bằng CLIP. App hỗ trợ hai luồng chính:

- Image-to-image retrieval bằng CLIP: upload một ảnh truy vấn để tìm ảnh tương tự trong dataset.
- Text-to-image retrieval bằng CLIP: nhập mô tả như `a red car`, `a dog`, `a person riding a bike` để tìm ảnh phù hợp trong dataset.

Ảnh upload chỉ được dùng làm query tạm thời. Ảnh upload không tự thêm vào dataset và không được lưu như dữ liệu tìm kiếm.

## Cấu trúc thư mục

```text
D:/TGMT
├── app/
│   ├── main.py
│   ├── clip_search.py
│   └── static/
│       ├── index.html
│       ├── style.css
│       └── script.js
├── dataset/
├── embeddings/
├── uploads/
├── README.md
└── requirements.txt
```

- `dataset/`: chứa ảnh gốc để tìm kiếm. Kết quả trả về luôn lấy từ thư mục này.
- `embeddings/`: lưu cache embedding CLIP của dataset.
- `uploads/`: lưu tạm ảnh query khi người dùng tìm bằng ảnh, sau đó backend sẽ cố gắng xóa.
- `app/`: chứa FastAPI backend và frontend tĩnh.

## Cài đặt

Mở PowerShell tại thư mục project:

```powershell
cd D:\TGMT
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Nên dùng Python 3.10, 3.11 hoặc 3.12 để PyTorch/Transformers ổn định.

## Chạy app

```powershell
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Mở trình duyệt:

```text
http://127.0.0.1:8000
```

## Cách dùng

1. Chọn mode `Tìm bằng ảnh` hoặc `Tìm bằng text`.
2. Nếu tìm bằng ảnh, chọn hoặc kéo thả file JPG, PNG, WEBP.
3. Nếu tìm bằng text, nhập mô tả ảnh cần tìm.
4. Chọn `Số kết quả` trong khoảng 1 đến 50.
5. Bấm tìm kiếm để xem kết quả trong dataset.

## Dataset và cache

Muốn thêm ảnh vào dữ liệu tìm kiếm, hãy đặt ảnh vào thư mục `dataset/`. Backend sẽ tự kiểm tra chữ ký dataset ở lần search tiếp theo. Chữ ký dataset dựa trên danh sách đường dẫn ảnh, `mtime_ns` và kích thước file.

Nếu dataset có ảnh mới, ảnh bị xóa, đổi tên hoặc bị sửa, cache/index sẽ bị xem là không hợp lệ. Backend sẽ tự rebuild CLIP image index khi cần, bao gồm cả việc invalidate RAM cache và disk cache cũ. Người dùng không cần bấm nút cập nhật dataset trong flow tìm kiếm chính.

## API

### `GET /api/health`

Kiểm tra backend và thư mục dataset.

### `POST /api/search/image`

Tìm ảnh bằng ảnh upload.

Request dạng `multipart/form-data`:

- `file`: file ảnh query.
- `top_k`: số kết quả, backend clamp trong khoảng 1 đến 50.

### `POST /api/search/text`

Tìm ảnh bằng text query.

Request JSON:

```json
{
  "text": "a red car",
  "top_k": 10
}
```

`text` không được rỗng. Nếu rỗng, API trả lỗi `400`.

### `GET /api/index/status`

Trả trạng thái dataset/cache:

```json
{
  "dataset_exists": true,
  "image_count": 4738,
  "cache_exists": true,
  "cache_valid": true,
  "model_name": "openai/clip-vit-base-patch32",
  "embedding_shape": [4738, 512]
}
```

### `POST /api/index/rebuild`

Force rebuild index thủ công, phù hợp cho demo/admin.

## Format kết quả tìm kiếm

Hai API tìm kiếm trả cùng format:

```json
{
  "results": [
    {
      "rank": 1,
      "image_path": "D:/TGMT/dataset/0.jpg",
      "image_url": "/dataset/0.jpg",
      "score": 0.9123,
      "filename": "0.jpg"
    }
  ]
}
```

Frontend dùng `image_url` để hiển thị ảnh và mở modal xem ảnh lớn.

## Ghi chú lỗi thường gặp

- Lần search đầu tiên có thể chậm nếu cache chưa có hoặc dataset vừa thay đổi, vì backend cần encode lại ảnh bằng CLIP.
- Nếu web không hiện ảnh kết quả, thử mở trực tiếp `http://127.0.0.1:8000/dataset/0.jpg`.
- Nếu cài `torch` lỗi, kiểm tra lại phiên bản Python và môi trường ảo.
