let queryPreviewUrl = null;
let queryFile = null;
let activeMode = "image";
let activeModalItem = null;

const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const supportedExtensionPattern = /\.(jpe?g|png|webp)$/i;

document.addEventListener("DOMContentLoaded", () => {
    const imageInput = document.getElementById("imageInput");
    const searchBtn = document.getElementById("searchBtn");
    const clearImageBtn = document.getElementById("clearImageBtn");
    const dropZone = document.getElementById("dropZone");
    const textQuery = document.getElementById("textQuery");
    const rebuildIndexBtn = document.getElementById("rebuildIndexBtn");
    const modalCloseBtn = document.getElementById("modalCloseBtn");
    const modalBackdrop = document.querySelector(".modal-backdrop");

    document.querySelectorAll(".mode-button").forEach((button) => {
        button.addEventListener("click", () => setSearchMode(button.dataset.mode));
    });

    imageInput.addEventListener("change", handleFileInputChange);
    searchBtn.addEventListener("click", search);
    clearImageBtn.addEventListener("click", clearSelectedImage);
    textQuery.addEventListener("input", handleTextInputChange);
    rebuildIndexBtn.addEventListener("click", rebuildIndex);

    dropZone.addEventListener("dragenter", handleDragEnter);
    dropZone.addEventListener("dragover", handleDragEnter);
    dropZone.addEventListener("dragleave", handleDragLeave);
    dropZone.addEventListener("drop", handleDrop);
    dropZone.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            imageInput.click();
        }
    });

    modalCloseBtn.addEventListener("click", closeImageModal);
    modalBackdrop.addEventListener("click", closeImageModal);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !document.getElementById("imageModal").hidden) {
            closeImageModal();
        }
    });

    renderIdleState();
    updateQueryPreviewForMode();
    updateSearchButton();
    fetchIndexStatus();
});

function setSearchMode(mode) {
    if (!["image", "text"].includes(mode) || mode === activeMode) {
        return;
    }

    activeMode = mode;

    document.querySelectorAll(".mode-button").forEach((button) => {
        const isActive = button.dataset.mode === activeMode;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", String(isActive));
    });

    document.getElementById("imageModePanel").hidden = activeMode !== "image";
    document.getElementById("textModePanel").hidden = activeMode !== "text";

    if (activeMode === "image") {
        document.getElementById("statusText").textContent = getSelectedFile()
            ? "Ảnh truy vấn đã sẵn sàng. Bấm tìm để xem kết quả tương tự."
            : "Chọn ảnh truy vấn để bắt đầu tìm kiếm.";
    } else {
        document.getElementById("statusText").textContent = getTextQuery()
            ? "Text query đã sẵn sàng. Bấm tìm để tìm ảnh phù hợp."
            : "Nhập mô tả ảnh cần tìm để bắt đầu.";
        document.getElementById("textQuery").focus();
    }

    updateQueryPreviewForMode();
    updateSearchButton();
    renderIdleState();
}

function handleFileInputChange() {
    const imageInput = document.getElementById("imageInput");
    const file = imageInput.files && imageInput.files[0] ? imageInput.files[0] : null;
    setSelectedImage(file);
}

function handleTextInputChange() {
    updateQueryPreviewForMode();
    updateSearchButton();

    if (activeMode === "text") {
        const text = getTextQuery();
        document.getElementById("statusText").textContent = text
            ? "Text query đã sẵn sàng. Bấm tìm để tìm ảnh phù hợp."
            : "Nhập mô tả ảnh cần tìm để bắt đầu.";
    }
}

function handleDragEnter(event) {
    event.preventDefault();
    document.getElementById("dropZone").classList.add("is-dragover");
}

function handleDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
        document.getElementById("dropZone").classList.remove("is-dragover");
    }
}

function handleDrop(event) {
    event.preventDefault();
    const dropZone = document.getElementById("dropZone");
    dropZone.classList.remove("is-dragover");

    const file = event.dataTransfer.files && event.dataTransfer.files[0] ? event.dataTransfer.files[0] : null;
    if (!file) {
        return;
    }

    if (setSelectedImage(file)) {
        syncFileInput(file);
    }
}

function syncFileInput(file) {
    const imageInput = document.getElementById("imageInput");

    if (typeof DataTransfer === "undefined") {
        return;
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    imageInput.files = transfer.files;
}

function setSelectedImage(file) {
    clearPreviewUrl();

    if (!file) {
        queryFile = null;
        updateQueryPreviewForMode();
        updateSearchButton();
        renderIdleState();
        return false;
    }

    if (!isSupportedImage(file)) {
        queryFile = null;
        document.getElementById("imageInput").value = "";
        updateQueryPreviewForMode();
        updateSearchButton();
        renderErrorState("Định dạng ảnh chưa được hỗ trợ. Vui lòng chọn JPG, PNG hoặc WEBP.");
        document.getElementById("statusText").textContent = "Không thể dùng file vừa chọn.";
        return false;
    }

    queryFile = file;
    queryPreviewUrl = URL.createObjectURL(file);

    const dropZone = document.getElementById("dropZone");
    dropZone.classList.add("has-file");

    if (activeMode === "image") {
        document.getElementById("statusText").textContent = "Ảnh truy vấn đã sẵn sàng. Bấm tìm để xem kết quả tương tự.";
        renderIdleState("Sẵn sàng tìm kiếm", "Bấm nút tìm bằng ảnh để gửi ảnh truy vấn lên backend CLIP.");
    }

    updateQueryPreviewForMode();
    updateSearchButton();
    return true;
}

function clearSelectedImage() {
    const imageInput = document.getElementById("imageInput");
    imageInput.value = "";
    queryFile = null;
    clearPreviewUrl();
    document.getElementById("dropZone").classList.remove("has-file");
    updateQueryPreviewForMode();
    updateSearchButton();
    renderIdleState();
    document.getElementById("statusText").textContent = "Chọn ảnh truy vấn để bắt đầu tìm kiếm.";
}

function clearPreviewUrl() {
    if (queryPreviewUrl) {
        URL.revokeObjectURL(queryPreviewUrl);
        queryPreviewUrl = null;
    }
}

function updateQueryPreviewForMode() {
    if (activeMode === "text") {
        renderTextQueryPreview();
        return;
    }

    renderImageQueryPreview();
}

function renderImageQueryPreview() {
    const file = getSelectedFile();
    const queryImage = document.getElementById("queryImage");
    const clearImageBtn = document.getElementById("clearImageBtn");
    const queryFilename = document.getElementById("queryFilename");
    const queryDetails = document.getElementById("queryDetails");
    const queryPlaceholder = document.getElementById("queryPlaceholder");

    setPlaceholder("IMG", "Ảnh đã chọn sẽ hiển thị ở đây trước khi tìm kiếm.");

    if (!file || !queryPreviewUrl) {
        queryImage.removeAttribute("src");
        queryImage.hidden = true;
        queryPlaceholder.hidden = false;
        queryFilename.textContent = "Chưa chọn ảnh";
        queryFilename.removeAttribute("title");
        queryDetails.textContent = "";
        clearImageBtn.hidden = true;
        return;
    }

    queryImage.src = queryPreviewUrl;
    queryImage.hidden = false;
    queryPlaceholder.hidden = true;
    queryFilename.textContent = file.name;
    queryFilename.title = file.name;
    queryDetails.textContent = `${formatFileSize(file.size)} - ${file.type || "image"}`;
    clearImageBtn.hidden = false;
}

function renderTextQueryPreview() {
    const queryImage = document.getElementById("queryImage");
    const clearImageBtn = document.getElementById("clearImageBtn");
    const queryFilename = document.getElementById("queryFilename");
    const queryDetails = document.getElementById("queryDetails");
    const queryPlaceholder = document.getElementById("queryPlaceholder");
    const text = getTextQuery();

    queryImage.removeAttribute("src");
    queryImage.hidden = true;
    queryPlaceholder.hidden = false;
    clearImageBtn.hidden = true;

    setPlaceholder("TXT", text || "Nhập mô tả ảnh cần tìm, ví dụ: a dog on grass.");
    queryFilename.textContent = text ? "Text query" : "Chưa nhập mô tả";
    queryFilename.removeAttribute("title");
    queryDetails.textContent = text ? text : "";
    queryDetails.title = text;
}

function setPlaceholder(mark, message) {
    const queryPlaceholder = document.getElementById("queryPlaceholder");
    const markElement = queryPlaceholder.querySelector("span");
    const copyElement = queryPlaceholder.querySelector("p");

    markElement.textContent = mark;
    copyElement.textContent = message;
}

async function search() {
    if (activeMode === "text") {
        await searchByText();
        return;
    }

    await searchByImage();
}

async function searchByImage() {
    const topKInput = document.getElementById("topK");
    const statusText = document.getElementById("statusText");
    const file = getSelectedFile();

    if (!file) {
        renderErrorState("Vui lòng chọn ảnh truy vấn trước khi tìm kiếm.");
        statusText.textContent = "Chưa có ảnh truy vấn.";
        updateSearchButton();
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("top_k", normalizeTopK(topKInput.value));

    updateSearchButton(true);
    renderLoadingState();
    statusText.textContent = "Đang mã hóa ảnh truy vấn và so sánh với dataset.";

    try {
        const response = await fetch("/api/search/image", {
            method: "POST",
            body: formData
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.detail || "Tìm kiếm ảnh thất bại.");
        }

        const results = normalizeResults(data);
        renderResults(results);
        updateResultStatus(results, "ảnh giống nhất");
        fetchIndexStatus();
    } catch (error) {
        renderErrorState(error.message || "Tìm kiếm ảnh thất bại.");
        statusText.textContent = "Có lỗi xảy ra khi upload hoặc tìm kiếm ảnh.";
    } finally {
        updateSearchButton(false);
    }
}

async function searchByText() {
    const topKInput = document.getElementById("topK");
    const statusText = document.getElementById("statusText");
    const text = getTextQuery();

    if (!text) {
        renderErrorState("Vui lòng nhập mô tả ảnh cần tìm.");
        statusText.textContent = "Text query đang rỗng.";
        updateSearchButton();
        return;
    }

    updateSearchButton(true);
    renderLoadingState();
    statusText.textContent = "Đang mã hóa text query và so sánh với embedding ảnh trong dataset.";

    try {
        const response = await fetch("/api/search/text", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text,
                top_k: Number(normalizeTopK(topKInput.value))
            })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.detail || "Tìm kiếm bằng text thất bại.");
        }

        const results = normalizeResults(data);
        renderResults(results);
        updateResultStatus(results, "ảnh phù hợp nhất");
        fetchIndexStatus();
    } catch (error) {
        renderErrorState(error.message || "Tìm kiếm bằng text thất bại.");
        statusText.textContent = "Có lỗi xảy ra khi tìm kiếm bằng text.";
    } finally {
        updateSearchButton(false);
    }
}

function normalizeResults(data) {
    return Array.isArray(data.results) ? data.results : Array.isArray(data) ? data : [];
}

function updateResultStatus(results, label) {
    const statusText = document.getElementById("statusText");

    if (results.length > 0) {
        statusText.textContent = `Đang hiển thị ${results.length} ${label} trong dataset.`;
    } else {
        statusText.textContent = "Không có ảnh nào được trả về từ dataset.";
    }
}

function getSelectedFile() {
    const imageInput = document.getElementById("imageInput");
    return queryFile || (imageInput.files && imageInput.files[0] ? imageInput.files[0] : null);
}

function getTextQuery() {
    return document.getElementById("textQuery").value.trim();
}

function isSupportedImage(file) {
    return supportedTypes.has(file.type) || supportedExtensionPattern.test(file.name);
}

function normalizeTopK(value) {
    const numericValue = Number.parseInt(value, 10);

    if (Number.isNaN(numericValue)) {
        return "10";
    }

    return String(Math.min(Math.max(numericValue, 1), 50));
}

function updateSearchButton(isSearching = false) {
    const searchBtn = document.getElementById("searchBtn");
    const canSearch = activeMode === "text" ? Boolean(getTextQuery()) : Boolean(getSelectedFile());

    searchBtn.disabled = isSearching || !canSearch;
    searchBtn.classList.toggle("is-loading", isSearching);

    if (isSearching) {
        searchBtn.textContent = "Đang tìm...";
    } else {
        searchBtn.textContent = activeMode === "text" ? "Tìm bằng text" : "Tìm bằng ảnh";
    }
}

function renderIdleState(
    title = "Chưa có kết quả",
    message = "Chọn ảnh hoặc nhập mô tả text, sau đó bấm tìm để xem các ảnh phù hợp trong dataset."
) {
    const resultsDiv = document.getElementById("results");
    resultsDiv.className = "results-grid";
    resultsDiv.innerHTML = "";
    resultsDiv.appendChild(createStateCard(title, message));
}

function renderLoadingState() {
    const resultsDiv = document.getElementById("results");
    resultsDiv.className = "results-grid";
    resultsDiv.innerHTML = "";

    for (let index = 0; index < 8; index += 1) {
        const skeleton = document.createElement("div");
        skeleton.className = "skeleton-card";
        skeleton.setAttribute("aria-hidden", "true");
        skeleton.innerHTML = `
            <div class="skeleton-thumb"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
        `;
        resultsDiv.appendChild(skeleton);
    }
}

function renderErrorState(message) {
    const resultsDiv = document.getElementById("results");
    resultsDiv.className = "results-grid";
    resultsDiv.innerHTML = "";
    resultsDiv.appendChild(createStateCard("Không thể tìm kiếm", message, "error"));
}

function renderResults(results) {
    const resultsDiv = document.getElementById("results");
    resultsDiv.className = "results-grid";
    resultsDiv.innerHTML = "";

    if (!results || results.length === 0) {
        resultsDiv.appendChild(createStateCard("Chưa tìm thấy ảnh phù hợp", "Dataset không trả về kết quả phù hợp cho truy vấn này."));
        return;
    }

    results.forEach((item, index) => {
        resultsDiv.appendChild(createResultCard(item, index));
    });
}

function createStateCard(title, message, type = "") {
    const card = document.createElement("div");
    card.className = type ? `state-card ${type}` : "state-card";

    const content = document.createElement("div");
    const heading = document.createElement("strong");
    const copy = document.createElement("p");

    heading.textContent = title;
    copy.textContent = message;
    content.append(heading, copy);
    card.appendChild(content);

    return card;
}

function createResultCard(item, index) {
    const filename = getFilename(item);
    const rank = item.rank || index + 1;
    const score = formatScore(item.score ?? item.distance);
    const path = item.image_path || item.image_url || filename;

    const card = document.createElement("button");
    card.className = "result-card";
    card.type = "button";
    card.setAttribute("aria-label", `Mở ảnh ${filename}`);
    card.addEventListener("click", () => openImageModal(item, index));

    const thumb = document.createElement("div");
    thumb.className = "result-thumb";

    const img = document.createElement("img");
    img.src = item.image_url || "";
    img.alt = filename;
    img.loading = "lazy";

    const badge = document.createElement("span");
    badge.className = "rank-badge";
    badge.textContent = `Top ${rank}`;

    const fallback = document.createElement("div");
    fallback.className = "image-fallback";
    fallback.textContent = "Không thể tải ảnh";
    fallback.hidden = true;

    img.addEventListener("error", () => {
        img.hidden = true;
        fallback.hidden = false;
    });

    thumb.append(img, fallback, badge);

    const info = document.createElement("div");
    info.className = "result-info";

    const scoreRow = document.createElement("div");
    scoreRow.className = "score-row";

    const scoreLabel = document.createElement("span");
    scoreLabel.className = "score-label";
    scoreLabel.textContent = item.distance !== undefined && item.score === undefined ? "Distance" : "Similarity";

    const scoreValue = document.createElement("span");
    scoreValue.className = "score-value";
    scoreValue.textContent = score;

    scoreRow.append(scoreLabel, scoreValue);

    const fileName = document.createElement("p");
    fileName.className = "filename";
    fileName.textContent = filename;
    fileName.title = filename;

    const pathLine = document.createElement("p");
    pathLine.className = "path";
    pathLine.textContent = path;
    pathLine.title = path;

    info.append(scoreRow, fileName, pathLine);
    card.append(thumb, info);

    return card;
}

function openImageModal(item, index) {
    activeModalItem = item;

    const modal = document.getElementById("imageModal");
    const modalImage = document.getElementById("modalImage");
    const modalImageFallback = document.getElementById("modalImageFallback");
    const modalTitle = document.getElementById("modalTitle");
    const modalRank = document.getElementById("modalRank");
    const modalMeta = document.getElementById("modalMeta");
    const filename = getFilename(item);
    const rank = item.rank || index + 1;
    const score = formatScore(item.score ?? item.distance);
    const path = item.image_path || item.image_url || filename;

    modalTitle.textContent = filename;
    modalRank.textContent = `Top ${rank}`;
    modalMeta.textContent = `${item.distance !== undefined && item.score === undefined ? "Distance" : "Similarity"}: ${score} - ${path}`;
    modalMeta.title = path;
    modalImageFallback.hidden = true;
    modalImage.hidden = false;
    modalImage.src = item.image_url || "";
    modalImage.alt = filename;
    modalImage.onerror = () => {
        modalImage.hidden = true;
        modalImageFallback.hidden = false;
    };

    modal.hidden = false;
    document.body.classList.add("modal-open");
    document.getElementById("modalCloseBtn").focus();
}

function closeImageModal() {
    const modal = document.getElementById("imageModal");
    const modalImage = document.getElementById("modalImage");

    modal.hidden = true;
    modalImage.removeAttribute("src");
    document.body.classList.remove("modal-open");
    activeModalItem = null;
}

async function fetchIndexStatus() {
    const statusElement = document.getElementById("indexStatusText");

    try {
        const response = await fetch("/api/index/status");
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || "Không thể đọc trạng thái index.");
        }

        renderIndexStatus(data);
    } catch (error) {
        statusElement.textContent = error.message || "Không thể đọc trạng thái index.";
    }
}

async function rebuildIndex() {
    const rebuildIndexBtn = document.getElementById("rebuildIndexBtn");
    const statusElement = document.getElementById("indexStatusText");

    rebuildIndexBtn.disabled = true;
    rebuildIndexBtn.textContent = "Đang rebuild...";
    statusElement.textContent = "Đang rebuild CLIP index.";

    try {
        const response = await fetch("/api/index/rebuild", {
            method: "POST"
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || "Rebuild index thất bại.");
        }

        renderIndexStatus(data);
        document.getElementById("statusText").textContent = "Index đã được rebuild thủ công.";
    } catch (error) {
        statusElement.textContent = error.message || "Rebuild index thất bại.";
    } finally {
        rebuildIndexBtn.disabled = false;
        rebuildIndexBtn.textContent = "Rebuild index";
    }
}

function renderIndexStatus(data) {
    const statusElement = document.getElementById("indexStatusText");

    if (!data.dataset_exists) {
        statusElement.textContent = "Dataset chưa tồn tại.";
        return;
    }

    const shape = Array.isArray(data.embedding_shape) ? `, embedding ${data.embedding_shape.join(" x ")}` : "";
    const cacheText = data.cache_valid ? "cache hợp lệ" : "cache sẽ tự rebuild khi search";
    statusElement.textContent = `${data.image_count} ảnh, ${cacheText}${shape}`;
}

function getFilename(item) {
    if (item.filename) {
        return item.filename;
    }

    const source = item.image_path || item.image_url || "Ảnh dataset";
    const normalizedSource = String(source).split(/[\\/]/).filter(Boolean);
    return normalizedSource[normalizedSource.length - 1] || "Ảnh dataset";
}

function formatScore(value) {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        return "N/A";
    }

    return numberValue.toFixed(4);
}

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "Không rõ dung lượng";
    }

    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
