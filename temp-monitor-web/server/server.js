"use strict";
const thermalStatusEl = document.getElementById("thermalStatus");
const temperatureIds = ["amgMin", "amgMax", "amgCenter", "scaleMin", "scaleMax"];
function setTempText(id, value) {
  document.getElementById(id).textContent = typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) + " °C" : "-- °C";
}
        function tempToColor(value, min, max) {
            if (max <= min) {
                max = min + 1;
            }

            const t = Math.max(0, Math.min(1, (value - min) / (max - min)));

            let r = 0;
            let g = 0;
            let b = 0;

            if (t < 0.25) {
                const k = t / 0.25;
                r = 0;
                g = Math.round(80 * k);
                b = Math.round(255);
            } else if (t < 0.5) {
                const k = (t - 0.25) / 0.25;
                r = Math.round(255 * k);
                g = Math.round(80 + 120 * k);
                b = Math.round(255 * (1 - k));
            } else if (t < 0.75) {
                const k = (t - 0.5) / 0.25;
                r = 255;
                g = Math.round(200 * (1 - k));
                b = 0;
            } else {
                const k = (t - 0.75) / 0.25;
                r = 255;
                g = Math.round(255 * k);
                b = Math.round(255 * k);
            }

            return `rgb(${r}, ${g}, ${b})`;
        }

        function lerp(a, b, t) {
            return a + (b - a) * t;
        }

        function getPixelBilinear(pixels, x, y) {
            const x0 = Math.floor(x);
            const y0 = Math.floor(y);
            const x1 = Math.min(x0 + 1, 7);
            const y1 = Math.min(y0 + 1, 7);

            const tx = x - x0;
            const ty = y - y0;

            const p00 = Number(pixels[y0 * 8 + x0]);
            const p10 = Number(pixels[y0 * 8 + x1]);
            const p01 = Number(pixels[y1 * 8 + x0]);
            const p11 = Number(pixels[y1 * 8 + x1]);

            const top = lerp(p00, p10, tx);
            const bottom = lerp(p01, p11, tx);

            return lerp(top, bottom, ty);
        }

        function drawEmptyThermal(message = "No thermal data") {
            const canvas = document.getElementById("thermalCanvas");
            const ctx = canvas.getContext("2d");

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#0b1220";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const cell = canvas.width / 8;

            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    ctx.strokeStyle = "rgba(255,255,255,0.10)";
                    ctx.strokeRect(col * cell, row * cell, cell, cell);
                }
            }

            ctx.fillStyle = "#94a3b8";
            ctx.font = "22px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(message, canvas.width / 2, canvas.height / 2);
        }


function showUnavailable(message) {
  drawEmptyThermal("ไม่มีข้อมูลภาพความร้อน");
  temperatureIds.forEach(id => setTempText(id, null));
  thermalStatusEl.textContent = message;
  thermalStatusEl.classList.add("offline");
}
function drawThermal(data) {
  const timestamp = Number(data?.updatedAt);
  document.getElementById("lastUpdated").textContent = Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toLocaleString("th-TH") : "--";
  if (!Number.isFinite(timestamp) || timestamp <= 0 || Date.now() - timestamp > 15000) {
    showUnavailable("ไม่ได้รับข้อมูลใหม่จากบอร์ด"); return;
  }
  if (Number(data.amg_status) !== 1) {
    showUnavailable("ไม่พบเซ็นเซอร์ AMG8833"); return;
  }
  const pixels = data.amg_pixels;
  if (!Array.isArray(pixels) || pixels.length !== 64 || pixels.some(v => typeof v !== "number" || !Number.isFinite(v))) {
    showUnavailable("ข้อมูลภาพความร้อนไม่ครบ 64 จุด"); return;
  }
  setTempText("amgMin", data.amg_min_temp_c);
  setTempText("amgMax", data.amg_max_temp_c);
  setTempText("amgCenter", data.amg_center_temp_c);
  const min = Math.min(...pixels), max = Math.max(...pixels);
  setTempText("scaleMin", min); setTempText("scaleMax", max);
  const canvas = document.getElementById("thermalCanvas"), ctx = canvas.getContext("2d");
  const size = 64, cell = canvas.width / size;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const temp = getPixelBilinear(pixels, col / (size - 1) * 7, row / (size - 1) * 7);
      ctx.fillStyle = tempToColor(temp, min, max);
      ctx.fillRect(col * cell, row * cell, cell, cell);
    }
  }
  thermalStatusEl.textContent = "AMG8833 เชื่อมต่อแล้ว • 64 จุด";
  thermalStatusEl.classList.remove("offline");
}
async function readSensors() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("/api/sensors", { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("HTTP " + response.status);
    drawThermal(await response.json());
  } catch {
    showUnavailable("เชื่อมต่อ Cloud ไม่ได้ กำลังลองใหม่");
  } finally {
    clearTimeout(timeout);
    setTimeout(readSensors, 1000);
  }
}
showUnavailable("กำลังรอข้อมูล AMG8833");
readSensors();
