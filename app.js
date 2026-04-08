const STORAGE_KEY = "dogaria_logs_v1";
const MARKER_CM = 15;
const POINT_LABELS = ["地面", "最高点", "定規下端", "定規上端"];
const COLORS = ["#e53935", "#1e88e5", "#43a047", "#8e24aa", "#fb8c00", "#212121"];
const DEFAULT_CENTER = [35.681236, 139.767125];

const dogNameInput = document.getElementById("dogName");
const imageInput = document.getElementById("imageInput");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const autoDetectBtn = document.getElementById("autoDetectBtn");
const resetPointsBtn = document.getElementById("resetPointsBtn");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");
const redrawBtn = document.getElementById("redrawBtn");
const clearBtn = document.getElementById("clearBtn");
const logList = document.getElementById("logList");

const state = {
  image: null,
  points: [],
  imageLatLng: null,
  fallbackLatLng: null,
  territoryLayer: null,
  markerLayer: null,
  circleLayer: null,
};

const map = L.map("map").setView(DEFAULT_CENTER, 13);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
}).addTo(map);
state.markerLayer = L.layerGroup().addTo(map);
state.circleLayer = L.layerGroup().addTo(map);
state.territoryLayer = L.layerGroup().addTo(map);

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#d32f2f" : "#1b5e20";
}

function getLogs() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
}

function saveLogs(logs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
}

function colorForDog(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash << 5) - hash + name.charCodeAt(i);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function resetPoints() {
  state.points = [];
  redrawCanvas();
}

function redrawCanvas() {
  if (!state.image) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.image, 0, 0, canvas.width, canvas.height);

  state.points.forEach((p, index) => {
    ctx.beginPath();
    ctx.fillStyle = index < 2 ? "#e53935" : "#1e88e5";
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#111";
    ctx.fillText(POINT_LABELS[index], p.x + 8, p.y - 8);
  });
}

function canvasPointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  return { x, y };
}

function calculateHeightCm() {
  if (state.points.length < 4) return null;
  const ground = state.points[0];
  const top = state.points[1];
  const markerBottom = state.points[2];
  const markerTop = state.points[3];

  const peePixelHeight = Math.abs(ground.y - top.y);
  const markerPixelHeight = Math.abs(markerBottom.y - markerTop.y);
  if (markerPixelHeight === 0) return null;

  return (peePixelHeight / markerPixelHeight) * MARKER_CM;
}

function exifToDegree(value, ref) {
  if (!value || value.length !== 3) return null;
  const d = value[0].numerator / value[0].denominator;
  const m = value[1].numerator / value[1].denominator;
  const s = value[2].numerator / value[2].denominator;
  let out = d + m / 60 + s / 3600;
  if (ref === "S" || ref === "W") out *= -1;
  return out;
}

function readExifLatLng(file) {
  return new Promise((resolve) => {
    EXIF.getData(file, function () {
      const lat = EXIF.getTag(this, "GPSLatitude");
      const lng = EXIF.getTag(this, "GPSLongitude");
      const latRef = EXIF.getTag(this, "GPSLatitudeRef");
      const lngRef = EXIF.getTag(this, "GPSLongitudeRef");
      const parsedLat = exifToDegree(lat, latRef);
      const parsedLng = exifToDegree(lng, lngRef);
      if (parsedLat != null && parsedLng != null) {
        resolve({ lat: parsedLat, lng: parsedLng, source: "EXIF" });
      } else {
        resolve(null);
      }
    });
  });
}

function getCurrentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: "GPS" }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

function toRadians(v) {
  return (v * Math.PI) / 180;
}

function distanceMeters(a, b) {
  const R = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function dogScoresAtPoint(point, logs) {
  const byDog = {};
  logs.forEach((log) => {
    const d = Math.max(distanceMeters(point, log), 1);
    const score = log.heightCm / d;
    byDog[log.dogName] = (byDog[log.dogName] || 0) + score;
  });
  return byDog;
}

function ownerAtPoint(point, logs) {
  const scores = dogScoresAtPoint(point, logs);
  let bestDog = null;
  let bestScore = -Infinity;
  Object.entries(scores).forEach(([dog, score]) => {
    if (score > bestScore) {
      bestScore = score;
      bestDog = dog;
    }
  });
  return bestDog;
}

function drawTerritoryGrid(logs) {
  state.territoryLayer.clearLayers();
  if (!logs.length) return;

  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  const latStep = (ne.lat - sw.lat) / 18;
  const lngStep = (ne.lng - sw.lng) / 18;
  if (latStep <= 0 || lngStep <= 0) return;

  for (let lat = sw.lat; lat < ne.lat; lat += latStep) {
    for (let lng = sw.lng; lng < ne.lng; lng += lngStep) {
      const center = { lat: lat + latStep / 2, lng: lng + lngStep / 2 };
      const owner = ownerAtPoint(center, logs);
      if (!owner) continue;
      const color = colorForDog(owner);
      L.rectangle(
        [
          [lat, lng],
          [lat + latStep, lng + lngStep],
        ],
        {
          stroke: false,
          fillColor: color,
          fillOpacity: 0.18,
          interactive: false,
        }
      ).addTo(state.territoryLayer);
    }
  }
}

function renderLogList(logs) {
  logList.innerHTML = "";
  if (!logs.length) {
    logList.innerHTML = "<li>まだ記録がありません。</li>";
    return;
  }

  const sorted = [...logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  sorted.forEach((log) => {
    const li = document.createElement("li");
    const dt = new Date(log.createdAt).toLocaleString("ja-JP");
    li.innerHTML = `<strong style="color:${colorForDog(log.dogName)}">${log.dogName}</strong><br>
      推定高さ: ${log.heightCm.toFixed(1)} cm<br>
      位置: ${log.lat.toFixed(6)}, ${log.lng.toFixed(6)}<br>
      記録日時: ${dt}`;
    logList.appendChild(li);
  });
}

function redrawMap() {
  const logs = getLogs();
  state.markerLayer.clearLayers();
  state.circleLayer.clearLayers();

  logs.forEach((log) => {
    const color = colorForDog(log.dogName);
    L.circleMarker([log.lat, log.lng], {
      radius: 7,
      color,
      weight: 2,
      fillOpacity: 0.9,
    })
      .bindPopup(
        `犬名: ${log.dogName}<br>推定高さ: ${log.heightCm.toFixed(1)}cm<br>${new Date(log.createdAt).toLocaleString("ja-JP")}`
      )
      .addTo(state.markerLayer);

    L.circle([log.lat, log.lng], {
      radius: Math.max(15, log.heightCm * 2.8),
      color,
      weight: 1,
      fillOpacity: 0.1,
    }).addTo(state.circleLayer);
  });

  if (logs.length) {
    const group = L.featureGroup([...state.markerLayer.getLayers()]);
    map.fitBounds(group.getBounds().pad(0.25));
  }

  drawTerritoryGrid(logs);
  renderLogList(logs);
}

async function handleImageSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const maxWidth = 900;
    const scale = Math.min(1, maxWidth / image.width);
    canvas.width = Math.floor(image.width * scale);
    canvas.height = Math.floor(image.height * scale);
    state.image = image;
    resetPoints();
    redrawCanvas();
  };
  image.src = objectUrl;

  const exifLatLng = await readExifLatLng(file);
  const gpsLatLng = await getCurrentPosition();

  state.imageLatLng = exifLatLng;
  state.fallbackLatLng = gpsLatLng;

  if (exifLatLng) {
    setStatus("位置情報をEXIFから取得しました。計測点を4つ指定してください。");
  } else if (gpsLatLng) {
    setStatus("EXIF位置情報なし。端末GPSを使用します。計測点を4つ指定してください。");
  } else {
    setStatus("位置情報が取得できませんでした。保存はできません。", true);
  }
}

function handleCanvasTap(event) {
  if (!state.image) {
    setStatus("先に画像を選択してください。", true);
    return;
  }
  if (state.points.length >= 4) return;

  state.points.push(canvasPointFromEvent(event));
  redrawCanvas();
  if (state.points.length === 4) {
    const height = calculateHeightCm();
    if (height) {
      setStatus(`4点を取得しました。推定高さは ${height.toFixed(1)} cm です。`);
    }
  }
}

function autoDetectRuler() {
  if (!state.image) {
    setStatus("先に画像を選択してください。", true);
    return;
  }

  if (state.points.length < 2) {
    setStatus("自動検出は補助機能です。先に地面と最高点の2点を指定してください。", true);
    return;
  }

  const x = canvas.width * 0.88;
  const bottom = { x, y: canvas.height * 0.82 };
  const top = { x, y: canvas.height * 0.52 };

  state.points[2] = bottom;
  state.points[3] = top;
  state.points = state.points.slice(0, 4);
  redrawCanvas();
  setStatus("定規候補を仮設定しました。必要に応じて点リセットして手動調整してください。");
}

function saveCurrentLog() {
  const dogName = dogNameInput.value.trim();
  if (!dogName) {
    setStatus("犬の名前を入力してください", true);
    return;
  }
  if (!state.image) {
    setStatus("画像をアップロードしてください", true);
    return;
  }
  const latLng = state.imageLatLng || state.fallbackLatLng;
  if (!latLng) {
    setStatus("位置情報が取れていません", true);
    return;
  }
  if (state.points.length < 4) {
    setStatus("4点選択してから保存してください", true);
    return;
  }

  const heightCm = calculateHeightCm();
  if (!heightCm || !Number.isFinite(heightCm)) {
    setStatus("高さ計算に失敗しました。点を調整してください。", true);
    return;
  }

  const logs = getLogs();
  logs.push({
    id: crypto.randomUUID(),
    dogName,
    lat: latLng.lat,
    lng: latLng.lng,
    heightCm,
    createdAt: new Date().toISOString(),
  });
  saveLogs(logs);

  redrawMap();
  setStatus(`保存しました。${dogName} の推定高さ ${heightCm.toFixed(1)} cm`);
}

function clearAll() {
  if (!confirm("保存済みの記録をすべて削除しますか？")) return;
  localStorage.removeItem(STORAGE_KEY);
  redrawMap();
  setStatus("全記録を削除しました。");
}

imageInput.addEventListener("change", handleImageSelect);
canvas.addEventListener("click", handleCanvasTap);
autoDetectBtn.addEventListener("click", autoDetectRuler);
resetPointsBtn.addEventListener("click", () => {
  resetPoints();
  setStatus("計測点をリセットしました。");
});
saveBtn.addEventListener("click", saveCurrentLog);
redrawBtn.addEventListener("click", () => {
  redrawMap();
  setStatus("保存済みデータから再描画しました。");
});
clearBtn.addEventListener("click", clearAll);

map.on("moveend", () => drawTerritoryGrid(getLogs()));

redrawMap();
