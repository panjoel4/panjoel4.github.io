(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = {
    imageLoaded: false,
    baseCanvas: document.createElement("canvas"),
    roi: { x: 0, y: 0, radius: 0 },
    stream: null,
    cvReady: false,
    latestResult: null,
    latestSource: ""
  };

  const ui = {
    status: $("appStatus"),
    fileInput: $("fileInput"),
    startCamera: $("startCameraButton"),
    capture: $("captureButton"),
    stopCamera: $("stopCameraButton"),
    cameraPanel: $("cameraPanel"),
    cameraVideo: $("cameraVideo"),
    captureStatus: $("captureStatus"),
    stage: $("canvasStage"),
    preview: $("previewCanvas"),
    imageInfo: $("imageInfo"),
    centerRoi: $("centerRoiButton"),
    roiX: $("roiX"),
    roiY: $("roiY"),
    roiRadius: $("roiRadius"),
    sampleId: $("sampleId"),
    uvWavelength: $("uvWavelength"),
    dishDiameter: $("dishDiameter"),
    threshold: $("threshold"),
    sprayVolume: $("sprayVolume"),
    dryingTime: $("dryingTime"),
    analyze: $("analyzeButton"),
    results: $("resultsSection"),
    qualityBanner: $("qualityBanner"),
    descriptorGrid: $("descriptorGrid"),
    metadataSummary: $("metadataSummary"),
    mask: $("maskCanvas"),
    hotspots: $("hotspotCanvas"),
    colorMap: $("colorMapCanvas"),
    downloadJson: $("downloadJsonButton"),
    downloadCsv: $("downloadCsvButton")
  };

  const formatNumber = (value, digits = 2) => {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const setAppStatus = (kind, message) => {
    ui.status.className = `status-pill status-${kind}`;
    ui.status.textContent = message;
  };

  function markOpenCVReady() {
    if (window.cv && window.cv.Mat && typeof window.cv.imread === "function" && Number.isInteger(window.cv.CV_8UC1)) {
      state.cvReady = true;
      setAppStatus("ready", "BiocharLens ready");
      return true;
    }
    return false;
  }

  window.addEventListener("app-engine-ready", markOpenCVReady);
  const openCVWaitStarted = Date.now();
  const waitForOpenCV = () => {
    if (markOpenCVReady()) return;
    if (Date.now() - openCVWaitStarted > 30000) {
      setAppStatus("error", "BiocharLens could not load");
      return;
    }
    window.setTimeout(waitForOpenCV, 150);
  };
  waitForOpenCV();

  function setCanvasSize(canvas, width, height) {
    canvas.width = width;
    canvas.height = height;
  }

  function getCanvasPoint(event) {
    const rect = ui.preview.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) * ui.preview.width / rect.width, 0, ui.preview.width),
      y: clamp((event.clientY - rect.top) * ui.preview.height / rect.height, 0, ui.preview.height)
    };
  }

  function roiFromControls() {
    if (!state.imageLoaded) return;
    const minDimension = Math.min(ui.preview.width, ui.preview.height);
    state.roi.x = Number(ui.roiX.value) / 100 * ui.preview.width;
    state.roi.y = Number(ui.roiY.value) / 100 * ui.preview.height;
    state.roi.radius = Number(ui.roiRadius.value) / 100 * minDimension;
    renderPreview();
  }

  function syncControlsToRoi() {
    const minDimension = Math.min(ui.preview.width, ui.preview.height);
    ui.roiX.value = Math.round(state.roi.x / ui.preview.width * 100);
    ui.roiY.value = Math.round(state.roi.y / ui.preview.height * 100);
    ui.roiRadius.value = Math.round(state.roi.radius / minDimension * 100);
  }

  function renderPreview() {
    if (!state.imageLoaded) return;
    const ctx = ui.preview.getContext("2d");
    setCanvasSize(ui.preview, state.baseCanvas.width, state.baseCanvas.height);
    ctx.drawImage(state.baseCanvas, 0, 0);

    ctx.save();
    ctx.beginPath();
    ctx.arc(state.roi.x, state.roi.y, state.roi.radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8, 166, 160, 0.07)";
    ctx.fill();
    ctx.lineWidth = Math.max(2, ui.preview.width / 420);
    ctx.strokeStyle = "#65e1d9";
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#65e1d9";
    ctx.beginPath();
    ctx.arc(state.roi.x, state.roi.y, Math.max(3, ui.preview.width / 160), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function setImageSource(source, sourceLabel) {
    const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
    if (!sourceWidth || !sourceHeight) return;

    const maxDimension = 1100;
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    setCanvasSize(state.baseCanvas, width, height);
    const ctx = state.baseCanvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);

    setCanvasSize(ui.preview, width, height);
    state.imageLoaded = true;
    state.latestSource = sourceLabel;
    state.roi = { x: width / 2, y: height / 2, radius: Math.min(width, height) * 0.40 };
    syncControlsToRoi();
    renderPreview();
    ui.stage.classList.remove("empty-stage");
    ui.imageInfo.textContent = `${width} × ${height} px · ${sourceLabel}`;
    [ui.centerRoi, ui.roiX, ui.roiY, ui.roiRadius, ui.analyze].forEach((element) => { element.disabled = false; });
    ui.captureStatus.textContent = "ROI centered automatically. Adjust it to exclude the dish rim, then analyze.";
    ui.results.hidden = true;
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setImageSource(image, file.name);
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      ui.captureStatus.textContent = "The image could not be loaded.";
    };
    image.src = url;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      ui.captureStatus.textContent = "Camera access is not available in this browser. Use image upload instead.";
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      ui.cameraVideo.srcObject = state.stream;
      ui.cameraPanel.hidden = false;
      ui.capture.disabled = false;
      ui.stopCamera.disabled = false;
      ui.startCamera.disabled = true;
      ui.captureStatus.textContent = "Camera active. Place the sample inside the frame and capture a still image.";
    } catch (error) {
      ui.captureStatus.textContent = `Camera permission or device error: ${error.message || "access denied"}.`;
    }
  }

  function stopCamera() {
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    ui.cameraVideo.srcObject = null;
    ui.cameraPanel.hidden = true;
    ui.capture.disabled = true;
    ui.stopCamera.disabled = true;
    ui.startCamera.disabled = false;
  }

  function captureCameraFrame() {
    if (!state.stream || !ui.cameraVideo.videoWidth) return;
    setImageSource(ui.cameraVideo, "camera capture");
    ui.captureStatus.textContent = "Frame captured. Adjust the ROI if needed, then analyze.";
  }

  function analyzeImage() {
    if (!state.imageLoaded || !state.cvReady) {
      ui.captureStatus.textContent = "Please load an image first and wait for the analyzer to finish loading.";
      return;
    }

    const cv = window.cv;
    const src = cv.imread(ui.preview);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    const mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
    cv.circle(mask, new cv.Point(Math.round(state.roi.x), Math.round(state.roi.y)), Math.round(state.roi.radius), new cv.Scalar(255, 255, 255, 255), -1);

    const thresholdValue = clamp(Number(ui.threshold.value) || 55, 1, 254);
    const bright = new cv.Mat();
    cv.threshold(gray, bright, thresholdValue, 255, cv.THRESH_BINARY);
    cv.bitwise_and(bright, mask, bright);

    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    const cleaned = new cv.Mat();
    cv.morphologyEx(bright, cleaned, cv.MORPH_OPEN, kernel);

    const roiPixels = [];
    const maskPixels = [];
    const ringCounts = new Array(6).fill(0);
    const ringSums = new Array(6).fill(0);
    const hist = new Array(256).fill(0);

    for (let y = 0; y < gray.rows; y++) {
      for (let x = 0; x < gray.cols; x++) {
        const d = Math.hypot(x - state.roi.x, y - state.roi.y);
        if (d <= state.roi.radius) {
          const v = gray.ucharPtr(y, x)[0];
          roiPixels.push(v);
          hist[v] += 1;
          const ringIndex = Math.min(5, Math.floor((d / state.roi.radius) * 6));
          ringCounts[ringIndex] += 1;
          ringSums[ringIndex] += v;
          if (bright.ucharPtr(y, x)[0] > 0) {
            maskPixels.push(v);
          }
        }
      }
    }

    const mean = roiPixels.reduce((sum, v) => sum + v, 0) / roiPixels.length;
    const sorted = [...roiPixels].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const sigma = Math.sqrt(roiPixels.reduce((sum, v) => sum + (v - mean) ** 2, 0) / roiPixels.length);
    const cvValue = sigma / mean;

    const brightArea = maskPixels.length / roiPixels.length;
    const brightCount = maskPixels.length;
    const hotspotCount = countHotspots(cleaned, state.roi);

    const entropy = computeEntropy(hist, roiPixels.length);
    const radialUniformity = computeRadialUniformity(ringSums, ringCounts, state.roi.radius);
    const relativeIntensity = mean / 255;

    const dishDiameterMm = Number(ui.dishDiameter.value) || 0;
    const dishAreaCm2 = dishDiameterMm > 0 ? (Math.PI * (dishDiameterMm / 2) ** 2) / 100 : 0;
    const hotspotDensity = dishAreaCm2 > 0 ? (hotspotCount / dishAreaCm2) : hotspotCount;

    const result = {
      sampleId: ui.sampleId.value || "Unnamed sample",
      source: state.latestSource,
      uvWavelength: Number(ui.uvWavelength.value) || 365,
      threshold: thresholdValue,
      meanIntensity: mean,
      medianIntensity: median,
      brightAreaFraction: brightArea,
      hotspotCount,
      hotspotDensity,
      heterogeneity: cvValue,
      entropy,
      radialUniformity,
      relativeIntensity,
      brightPixelCount: brightCount,
      roi: { x: state.roi.x, y: state.roi.y, radius: state.roi.radius },
      dishDiameterMm,
      sprayVolume: Number(ui.sprayVolume.value) || null,
      dryingTime: Number(ui.dryingTime.value) || null,
      timestamp: new Date().toISOString()
    };

    state.latestResult = result;
    renderResults(result);
    renderDiagnosticMaps(gray, bright, cleaned);

    const qualityMessage = getQualityHint(result);
    ui.qualityBanner.innerHTML = qualityMessage;
    ui.qualityBanner.classList.toggle("warning", qualityMessage.includes("check complete") || qualityMessage.includes("review"));
    ui.results.hidden = false;

    src.delete(); gray.delete(); mask.delete(); bright.delete(); kernel.delete(); cleaned.delete();
  }

  function getQualityHint(result) {
    const flags = [];
    if (result.brightAreaFraction > 0.25) flags.push("high bright coverage");
    if (result.heterogeneity > 0.30) flags.push("strong heterogeneity");
    if (result.hotspotCount <= 3) flags.push("few hotspots");
    if (result.radialUniformity < 0.7) flags.push("ring pattern drift");
    if (flags.length === 0) {
      return "<strong>Quality check:</strong> bright coverage and hotspot distribution appear internally consistent for a screening pass.";
    }
    return `<strong>Quality check:</strong> ${flags.join(", ")}. Review the ROI and lighting consistency before comparing batches.`;
  }

  function countHotspots(mask, roi) {
    const cv = window.cv;
    const connected = new cv.Mat();
    const stats = new cv.Mat();
    const centroids = new cv.Mat();
    const labels = new cv.Mat();
    cv.connectedComponentsWithStats(mask, labels, stats, centroids);

    let count = 0;
    for (let i = 1; i < stats.rows; i++) {
      const area = stats.intAt(i, cv.CC_STAT_AREA);
      const x = stats.intAt(i, cv.CC_STAT_LEFT);
      const y = stats.intAt(i, cv.CC_STAT_TOP);
      const w = stats.intAt(i, cv.CC_STAT_WIDTH);
      const h = stats.intAt(i, cv.CC_STAT_HEIGHT);
      const isLargeEnough = area >= 12;
      const withinRoi = x >= 0 && y >= 0 && x + w <= mask.cols && y + h <= mask.rows;
      if (isLargeEnough && withinRoi) count += 1;
    }
    labels.delete(); stats.delete(); centroids.delete(); connected.delete();
    return count;
  }

  function computeEntropy(hist, total) {
    let entropy = 0;
    for (const value of hist) {
      if (value <= 0) continue;
      const p = value / total;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  function computeRadialUniformity(ringSums, ringCounts, radius) {
    const validRingAverages = ringSums.map((sum, idx) => (ringCounts[idx] > 0 ? sum / ringCounts[idx] : 0)).filter((v) => v > 0);
    if (validRingAverages.length === 0) return 0;
    const mean = validRingAverages.reduce((s, v) => s + v, 0) / validRingAverages.length;
    const spread = validRingAverages.reduce((s, v) => s + Math.abs(v - mean), 0) / validRingAverages.length;
    return mean > 0 ? 1 - (spread / mean) : 0;
  }

  function renderResults(result) {
    ui.descriptorGrid.innerHTML = [
      { label: "Mean intensity", value: result.meanIntensity, unit: "gray" },
      { label: "Median intensity", value: result.medianIntensity, unit: "gray" },
      { label: "Bright-area fraction", value: result.brightAreaFraction * 100, unit: "%" },
      { label: "Hotspot count", value: result.hotspotCount, unit: "count" },
      { label: "Hotspot density", value: result.hotspotDensity, unit: result.dishDiameterMm > 0 ? "count/cm²" : "count/ROI" },
      { label: "Heterogeneity", value: result.heterogeneity, unit: "CV" },
      { label: "Entropy", value: result.entropy, unit: "bits" },
      { label: "Radial uniformity", value: result.radialUniformity, unit: "index" }
    ].map((item) => `
      <div class="descriptor">
        <div class="descriptor-label">${item.label}</div>
        <div class="descriptor-value">${formatNumber(item.value, item.unit.includes("%") ? 1 : 2)}</div>
        <div class="descriptor-unit">${item.unit}</div>
      </div>
    `).join("");

    ui.metadataSummary.innerHTML = `
      <span>Sample: ${result.sampleId}</span>
      <span>Wavelength: ${result.uvWavelength} nm</span>
      <span>ROI radius: ${formatNumber(result.roi.radius, 1)} px</span>
      <span>Bright threshold: ${result.threshold}</span>
      <span>Source: ${result.source}</span>
      <span>Spray ${result.sprayVolume ? `${formatNumber(result.sprayVolume, 1)} µL` : "n/a"}</span>
      <span>Drying ${result.dryingTime ? `${formatNumber(result.dryingTime, 1)} min` : "n/a"}</span>
    `;
  }

  function renderDiagnosticMaps(gray, bright, cleaned) {
    const cv = window.cv;
    const renderMap = (src, targetCanvas, gradient = false) => {
      const canvas = targetCanvas;
      const w = src.cols;
      const h = src.rows;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      const imageData = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const value = src.ucharPtr(y, x)[0];
          if (gradient) {
            const hue = Math.round((255 - value) * 0.9);
            imageData.data[idx] = hue;
            imageData.data[idx + 1] = Math.round(180 - value * 0.5);
            imageData.data[idx + 2] = Math.round(255 - value);
          } else {
            const intensity = value;
            imageData.data[idx] = intensity;
            imageData.data[idx + 1] = intensity;
            imageData.data[idx + 2] = intensity;
          }
          imageData.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
    };

    const brightClone = new cv.Mat();
    cv.cvtColor(bright, brightClone, cv.COLOR_GRAY2RGBA);
    renderMap(bright, ui.mask);

    const hotspotMask = new cv.Mat();
    cv.cvtColor(cleaned, hotspotMask, cv.COLOR_GRAY2RGBA);
    renderMap(cleaned, ui.hotspots);

    const colorMap = new cv.Mat();
    cv.applyColorMap(gray, colorMap, cv.COLORMAP_JET);
    const rgb = new cv.Mat();
    cv.cvtColor(colorMap, rgb, cv.COLOR_BGR2RGBA);
    renderMap(rgb, ui.colorMap, true);

    brightClone.delete(); hotspotMask.delete(); colorMap.delete(); rgb.delete();
  }

  function saveAsBlob(data, filename, type) {
    const blob = new Blob([data], { type });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadJson() {
    if (!state.latestResult) return;
    saveAsBlob(JSON.stringify(state.latestResult, null, 2), `${(ui.sampleId.value || "biochar-sample").replace(/\s+/g, "-")}.json`, "application/json");
  }

  function downloadCsv() {
    if (!state.latestResult) return;

    const toCsvValue = (value) => {
      if (value === null || value === undefined) return "";
      const stringValue = String(value);
      if (/[",\n]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    const headers = [
      "sampleId",
      "source",
      "uvWavelength",
      "threshold",
      "meanIntensity",
      "medianIntensity",
      "brightAreaFraction",
      "hotspotCount",
      "hotspotDensity",
      "heterogeneity",
      "entropy",
      "radialUniformity",
      "timestamp"
    ];

    const row = headers.map((key) => toCsvValue(state.latestResult[key])).join(",");
    const csv = [headers.join(","), row].join("\r\n");

    saveAsBlob(csv, `${(ui.sampleId.value || "biochar-sample").replace(/\s+/g, "-")}.csv`, "text/csv;charset=utf-8;");
  }

  ui.fileInput.addEventListener("change", (event) => loadFile(event.target.files?.[0]));
  ui.startCamera.addEventListener("click", startCamera);
  ui.capture.addEventListener("click", captureCameraFrame);
  ui.stopCamera.addEventListener("click", stopCamera);
  ui.centerRoi.addEventListener("click", () => {
    if (!state.imageLoaded) return;
    state.roi.x = ui.preview.width / 2;
    state.roi.y = ui.preview.height / 2;
    state.roi.radius = Math.min(ui.preview.width, ui.preview.height) * 0.4;
    syncControlsToRoi();
    renderPreview();
  });
  [ui.roiX, ui.roiY, ui.roiRadius].forEach((control) => control.addEventListener("input", roiFromControls));
  ui.analyze.addEventListener("click", analyzeImage);
  ui.downloadJson.addEventListener("click", downloadJson);
  ui.downloadCsv.addEventListener("click", downloadCsv);

  ui.preview.addEventListener("pointerdown", (event) => {
    if (!state.imageLoaded) return;
    const point = getCanvasPoint(event);
    state.roi.x = point.x;
    state.roi.y = point.y;
    syncControlsToRoi();
    renderPreview();
  });

  window.addEventListener("resize", () => {
    if (state.imageLoaded) {
      renderPreview();
    }
  });
})();
