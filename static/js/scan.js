(function () {
    const MAX_BYTES = 10 * 1024 * 1024;
    const HISTORY_KEY = "dentes.history";
    const PRIORITY = { high: 2, moderate: 1, unknown: 0 };
    const SVG_NS = "http://www.w3.org/2000/svg";

    const $ = (id) => document.getElementById(id);
    const fileInput = $("file-input");
    const dropzone = $("dropzone");
    const previewWrap = $("preview-wrap");
    const preview = $("preview");
    const fileMeta = $("file-meta");
    const confInput = $("confidence");
    const confValue = $("conf-value");
    const inputError = $("input-error");
    const analyzeBtn = $("analyze-btn");
    const viewer = $("viewer");
    const resultImg = $("result-img");
    const overlay = $("overlay");
    const chips = $("chips");
    const findingsEl = $("findings");

    let selectedFile = null;
    let previewUrl = null;
    let current = null;
    const hiddenLabels = new Set();

    const slug = (label) => label.toLowerCase().replace(/\s+/g, "-");

    // ---------- State ----------

    function showState(name) {
        $("state-empty").hidden = name !== "empty";
        $("state-loading").hidden = name !== "loading";
        $("state-result").hidden = name !== "result";
    }

    function showInputError(text) {
        inputError.textContent = text;
        inputError.hidden = !text;
    }

    // ---------- File selection ----------

    function selectFile(file) {
        showInputError("");
        if (!file) return;
        if (!["image/jpeg", "image/png"].includes(file.type)) {
            return showInputError("Please choose a JPG or PNG image.");
        }
        if (file.size > MAX_BYTES) {
            return showInputError("This image is larger than 10 MB.");
        }
        selectedFile = file;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        preview.src = previewUrl;
        fileMeta.textContent = file.name + " · " + (file.size / 1024 / 1024).toFixed(2) + " MB";
        dropzone.hidden = true;
        previewWrap.hidden = false;
        analyzeBtn.disabled = false;
    }

    function clearFile() {
        selectedFile = null;
        fileInput.value = "";
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        preview.removeAttribute("src");
        previewWrap.hidden = true;
        dropzone.hidden = false;
        analyzeBtn.disabled = true;
    }

    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInput.click();
        }
    });
    fileInput.addEventListener("change", () => selectFile(fileInput.files[0]));
    $("remove-btn").addEventListener("click", clearFile);

    ["dragenter", "dragover"].forEach((type) =>
        dropzone.addEventListener(type, (e) => {
            e.preventDefault();
            dropzone.classList.add("drag");
        })
    );
    ["dragleave", "drop"].forEach((type) =>
        dropzone.addEventListener(type, (e) => {
            e.preventDefault();
            dropzone.classList.remove("drag");
        })
    );
    dropzone.addEventListener("drop", (e) => selectFile(e.dataTransfer.files[0]));

    document.addEventListener("paste", (e) => {
        const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
        if (item) selectFile(item.getAsFile());
    });

    confInput.addEventListener("input", () => {
        confValue.textContent = Math.round(confInput.value * 100) + "%";
    });

    $("sample-btn").addEventListener("click", async () => {
        try {
            const res = await fetch(window.SAMPLE_URL);
            const blob = await res.blob();
            selectFile(new File([blob], "sample-xray.jpg", { type: "image/jpeg" }));
        } catch {
            showInputError("Could not load the sample image.");
        }
    });

    // ---------- Analyse ----------

    analyzeBtn.addEventListener("click", async () => {
        if (!selectedFile) return;
        showInputError("");
        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<span class="spinner"></span> Analysing…';
        showState("loading");

        const form = new FormData();
        form.append("defected_image", selectedFile);
        form.append("confidence", confInput.value);
        const started = performance.now();

        try {
            const res = await fetch("/process", { method: "POST", body: form });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.Error || data.Message || "Analysis failed.");
            data.elapsed = (performance.now() - started) / 1000;
            renderResult(data);
            addHistory(data);
        } catch (err) {
            showState(current ? "result" : "empty");
            showInputError(err.message === "Failed to fetch" ? "Cannot reach the server. Is it running?" : err.message);
        } finally {
            analyzeBtn.disabled = !selectedFile;
            analyzeBtn.textContent = "Analyse X-ray";
        }
    });

    // ---------- Result rendering ----------

    function renderResult(data) {
        current = data;
        hiddenLabels.clear();

        const total = data.detections.length;
        $("stat-total").textContent = total;
        $("stat-time").textContent = data.elapsed.toFixed(1) + " s";

        const top = data.summary.reduce((best, s) => (PRIORITY[s.severity] > PRIORITY[best] ? s.severity : best), "unknown");
        const box = $("stat-priority-box");
        box.className = "stat " + (total ? top : "none");
        $("stat-priority").textContent = total ? top.charAt(0).toUpperCase() + top.slice(1) : "None";

        $("report-link").href = data.report;
        $("download-link").href = data.detected;

        renderChips(data);
        renderFindings(data);

        resultImg.onload = () => drawBoxes(data);
        resultImg.src = data.original;
        showState("result");
        $("output").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function renderChips(data) {
        chips.replaceChildren();
        data.summary.forEach((s) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "chip";
            chip.innerHTML = '<span class="dot ' + slug(s.label) + '"></span>';
            chip.append(s.title + " (" + s.count + ")");
            chip.title = "Show or hide " + s.title;
            chip.addEventListener("click", () => {
                if (hiddenLabels.has(s.label)) hiddenLabels.delete(s.label);
                else hiddenLabels.add(s.label);
                chip.classList.toggle("off", hiddenLabels.has(s.label));
                applyVisibility();
            });
            chips.appendChild(chip);
        });
    }

    function renderFindings(data) {
        findingsEl.replaceChildren();
        if (!data.summary.length) {
            const ok = document.createElement("div");
            ok.className = "alert alert-ok";
            ok.textContent = "No conditions detected at " + Math.round(data.confidence_threshold * 100) +
                "% confidence. Try lowering the threshold to see weaker findings.";
            findingsEl.appendChild(ok);
            return;
        }

        const sorted = [...data.summary].sort((a, b) => PRIORITY[b.severity] - PRIORITY[a.severity] || b.count - a.count);
        sorted.forEach((s) => {
            const best = Math.max(...data.detections.filter((d) => d.label === s.label).map((d) => d.confidence));
            const row = document.createElement("div");
            row.className = "finding";
            row.innerHTML =
                '<span class="dot ' + slug(s.label) + '"></span>' +
                '<div><div class="head"><strong></strong><span class="badge ' + s.severity + '"></span><span class="conf"></span></div><p></p></div>';
            row.querySelector("strong").textContent = s.title + " × " + s.count;
            row.querySelector(".badge").textContent = s.severity;
            row.querySelector(".conf").textContent = "up to " + Math.round(best * 100) + "% confidence";
            row.querySelector("p").textContent = s.advice;
            row.addEventListener("mouseenter", () => highlight(s.label));
            row.addEventListener("mouseleave", () => highlight(null));
            findingsEl.appendChild(row);
        });
    }

    function drawBoxes(data) {
        const w = resultImg.naturalWidth;
        const h = resultImg.naturalHeight;
        overlay.setAttribute("viewBox", "0 0 " + w + " " + h);
        overlay.replaceChildren();

        const stroke = Math.max(2, Math.round(Math.min(w, h) * 0.004));
        const font = Math.max(11, Math.round(Math.min(w, h) * 0.022));
        viewer.style.setProperty("--sw", stroke);

        data.detections.forEach((d) => {
            const [x1, y1, x2, y2] = d.box;
            const g = document.createElementNS(SVG_NS, "g");
            g.setAttribute("class", "det " + slug(d.label));
            g.dataset.label = d.label;

            const rect = document.createElementNS(SVG_NS, "rect");
            rect.setAttribute("class", "box");
            rect.setAttribute("x", x1);
            rect.setAttribute("y", y1);
            rect.setAttribute("width", x2 - x1);
            rect.setAttribute("height", y2 - y1);
            rect.setAttribute("rx", stroke);

            const text = d.label + " " + Math.round(d.confidence * 100) + "%";
            const tagW = text.length * font * 0.58 + font * 0.6;
            const tagH = font * 1.4;
            const tagY = y1 - tagH >= 0 ? y1 - tagH : y2;

            const tag = document.createElementNS(SVG_NS, "rect");
            tag.setAttribute("class", "tag");
            tag.setAttribute("x", x1);
            tag.setAttribute("y", tagY);
            tag.setAttribute("width", tagW);
            tag.setAttribute("height", tagH);
            tag.setAttribute("rx", stroke);

            const label = document.createElementNS(SVG_NS, "text");
            label.setAttribute("x", x1 + font * 0.3);
            label.setAttribute("y", tagY + tagH * 0.72);
            label.setAttribute("font-size", font);
            label.textContent = text;

            g.append(rect, tag, label);
            overlay.appendChild(g);
        });
        applyVisibility();
    }

    function applyVisibility() {
        overlay.querySelectorAll("g.det").forEach((g) => g.classList.toggle("hidden", hiddenLabels.has(g.dataset.label)));
    }

    function highlight(label) {
        viewer.classList.toggle("focus", !!label);
        overlay.querySelectorAll("g.det").forEach((g) => g.classList.toggle("hl", g.dataset.label === label));
    }

    $("toggle-boxes").addEventListener("change", (e) => viewer.classList.toggle("no-boxes", !e.target.checked));
    $("toggle-labels").addEventListener("change", (e) => viewer.classList.toggle("no-labels", !e.target.checked));

    $("new-scan-btn").addEventListener("click", () => {
        clearFile();
        current = null;
        showState("empty");
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // ---------- History (kept in this browser only) ----------

    function loadHistory() {
        try {
            return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
        } catch {
            return [];
        }
    }

    function saveHistory(items) {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
        } catch {
            /* storage unavailable: history is a convenience only */
        }
    }

    function addHistory(data) {
        const items = loadHistory().filter((i) => i.id !== data.id);
        items.unshift({ id: data.id, name: data.filename, total: data.detections.length, at: Date.now() });
        saveHistory(items.slice(0, 8));
        renderHistory();
    }

    function timeAgo(ms) {
        const mins = Math.round((Date.now() - ms) / 60000);
        if (mins < 1) return "just now";
        if (mins < 60) return mins + " min ago";
        const hours = Math.round(mins / 60);
        return hours < 24 ? hours + " h ago" : Math.round(hours / 24) + " d ago";
    }

    function renderHistory() {
        // Results are deleted on the server after 24 h, so drop older entries.
        const items = loadHistory().filter((i) => Date.now() - i.at < 24 * 3600 * 1000);
        saveHistory(items);
        const list = $("history");
        list.replaceChildren();
        items.forEach((i) => {
            const li = document.createElement("li");
            const a = document.createElement("a");
            a.href = "/report/" + i.id;
            a.target = "_blank";
            a.rel = "noopener";
            const name = document.createElement("span");
            name.className = "name";
            name.textContent = i.name + " · " + i.total + " finding" + (i.total === 1 ? "" : "s");
            const when = document.createElement("span");
            when.className = "when";
            when.textContent = timeAgo(i.at);
            a.append(name, when);
            li.appendChild(a);
            list.appendChild(li);
        });
        $("history-empty").hidden = items.length > 0;
        $("clear-history").hidden = items.length === 0;
    }

    $("clear-history").addEventListener("click", () => {
        saveHistory([]);
        renderHistory();
    });

    renderHistory();
})();
