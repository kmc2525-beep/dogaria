const MARKER_CM = 15;

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let points = [];
let img = new Image();
let currentLatLng = null;

document.getElementById("imageInput").addEventListener("change", function(e) {
  const file = e.target.files[0];
  const reader = new FileReader();

  reader.onload = function(event) {
    img.src = event.target.result;
  };

  reader.readAsDataURL(file);

  navigator.geolocation.getCurrentPosition(pos => {
    currentLatLng = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude
    };
  });
});

img.onload = function() {
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);
};

canvas.addEventListener("click", function(e) {
  if (points.length >= 4) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  points.push({x, y});

  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
});

function calcHeight() {
  if (points.length < 4) return null;

  const ground = points[0];
  const top = points[1];
  const markerBottom = points[2];
  const markerTop = points[3];

  const peePx = Math.abs(ground.y - top.y);
  const markerPx = Math.abs(markerBottom.y - markerTop.y);

  return (peePx / markerPx) * MARKER_CM;
}

function saveData() {
  const name = document.getElementById("dogName").value;
  const height = calcHeight();

  if (!height || !currentLatLng) return;

  const data = JSON.parse(localStorage.getItem("logs") || "[]");

  data.push({
    name,
    lat: currentLatLng.lat,
    lng: currentLatLng.lng,
    height
  });

  localStorage.setItem("logs", JSON.stringify(data));

  drawMap();
}

let map;

function drawMap() {
  const data = JSON.parse(localStorage.getItem("logs") || "[]");

  if (!map) {
    map = L.map("map").setView([34.07, 134.55], 16);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap"
    }).addTo(map);
  }

  data.forEach(d => {
    const score = d.height;

    L.circle([d.lat, d.lng], {
      radius: 10 + score * 0.5,
      color: "red",
      fillOpacity: 0.2
    }).addTo(map);
  });
}
