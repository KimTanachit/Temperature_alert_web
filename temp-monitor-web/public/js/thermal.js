"use strict";
const thermalStatusEl = document.getElementById("thermalStatus");
const temperatureIds = ["amgMin", "amgMax", "amgCenter", "scaleMin", "scaleMax"];
let savedAlarm = null;
let lastSensorData = null;
let alarmSaveInProgress = false;
let requestedStopVersion = 0;
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
  const size = 128, cell = canvas.width / size;
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
function updateExtraSensors(data) {
  lastSensorData = data;
  const fresh = data && Number(data.updatedAt) > 0 && Date.now() - Number(data.updatedAt) <= 15000;
  const dsOK = fresh && Number(data.ds18b20_status) === 1 && typeof data.ds18b20_temp_c === "number" && Number.isFinite(data.ds18b20_temp_c);
  setTempText("dsTemp", dsOK ? data.ds18b20_temp_c : null);
  document.getElementById("dsStatus").textContent = !fresh ? "ไม่ได้รับข้อมูลใหม่" : dsOK ? "DS18B20 เชื่อมต่อแล้ว" : "ไม่พบ DS18B20 หรืออ่านค่าไม่ได้";
  const knownBuzzer = fresh && [0, 1].includes(data.buzzer_status);
  const sounding = knownBuzzer && data.buzzer_status === 1;
  document.getElementById("buzzerState").textContent = !knownBuzzer ? "ไม่ทราบสถานะ" : sounding ? "กำลังดัง" : "เงียบ";
  document.getElementById("buzzerState").classList.toggle("buzzer-on", sounding);
  let message = !fresh ? "รอข้อมูลใหม่จากบอร์ด" : "กำลังโหลดค่าตั้งเสียงเตือน";
  if (fresh && savedAlarm) {
    if (data.buzzer_config_version !== savedAlarm.revision) message = "บันทึกแล้ว รอบอร์ดรับค่า";
    else if (!savedAlarm.enabled) message = "บอร์ดรับค่าแล้ว • ปิดใช้เสียงเตือน";
    else if (data.buzzer_input_status !== 1) message = "บอร์ดรับค่าแล้ว • เซ็นเซอร์ที่เลือกอ่านไม่ได้";
    else if (data.buzzer_muted === 1) message = "หยุดเสียงแล้ว • รออุณหภูมิลดต่ำกว่าเกณฑ์ก่อนเตือนรอบใหม่";
    else message = "บอร์ดรับค่าแล้ว • เปิดใช้เสียงเตือน";
  }
  document.getElementById("buzzerDetail").textContent = message;
  if (requestedStopVersion) {
    document.getElementById("stopMessage").textContent = fresh && data.buzzer_stop_version === requestedStopVersion
      ? "บอร์ดรับคำสั่งหยุดแล้ว"
      : "ส่งคำสั่งแล้ว รอบอร์ดรับคำสั่งหยุด";
  }
}

function updateAlarmRange() {
  const ds = document.getElementById("alarmSource").value === "ds18b20";
  for (const id of ["alarmOn"]) {
    document.getElementById(id).min = ds ? "-55" : "0";
    document.getElementById(id).max = ds ? "125" : "80";
  }
}
async function settingsRequest(options, path = "/api/buzzer/settings") {
  const response = await fetch(path, {cache: "no-store", signal: AbortSignal.timeout(8000), ...options});
  if (response.status === 401 || response.status === 403) {
    window.location.href = "/login.html?next=%2Fservocontrol.html";
    throw new Error("กรุณาเข้าสู่ระบบใหม่");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "บันทึกไม่สำเร็จ");
  return data;
}
async function loadAlarmSettings() {
  const message = document.getElementById("alarmMessage");
  document.getElementById("reloadAlarm").hidden = true;
  try {
    savedAlarm = await settingsRequest();
    document.getElementById("alarmEnabled").checked = savedAlarm.enabled;
    document.getElementById("alarmSource").value = savedAlarm.source;
    document.getElementById("alarmOn").value = savedAlarm.on_c;
    updateAlarmRange();
    document.getElementById("alarmFields").disabled = false;
    message.textContent = "เลือกเซ็นเซอร์และอุณหภูมิ แล้วกดบันทึก";
    updateExtraSensors(lastSensorData);
  } catch (error) {
    message.textContent = error.message || "โหลดค่าตั้งไม่ได้";
    document.getElementById("reloadAlarm").hidden = false;
  }
}
document.getElementById("alarmSource").addEventListener("change", updateAlarmRange);
document.getElementById("reloadAlarm").addEventListener("click", loadAlarmSettings);
document.getElementById("alarmForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (alarmSaveInProgress) return;
  const message = document.getElementById("alarmMessage");
  const on_c = Number(document.getElementById("alarmOn").value);
  if (!Number.isFinite(on_c)) {
    message.textContent = "กรุณาระบุอุณหภูมิเริ่มดัง";
    return;
  }
  const payload = {enabled: document.getElementById("alarmEnabled").checked, source: document.getElementById("alarmSource").value, on_c};
  alarmSaveInProgress = true;
  document.getElementById("alarmFields").disabled = true;
  message.textContent = "กำลังบันทึก…";
  try {
    savedAlarm = await settingsRequest({method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)});
    message.textContent = "บันทึกค่าบนเว็บแล้ว ตรวจสอบการรับค่าของบอร์ดที่สถานะ Buzzer";
    updateExtraSensors(lastSensorData);
  } catch (error) {
    message.textContent = error.message || "บันทึกไม่สำเร็จ กรุณาลองใหม่";
  } finally {
    alarmSaveInProgress = false;
    document.getElementById("alarmFields").disabled = false;
  }
});
document.getElementById("stopBuzzer").addEventListener("click", async () => {
  const button = document.getElementById("stopBuzzer");
  const message = document.getElementById("stopMessage");
  button.disabled = true;
  requestedStopVersion = 0;
  message.textContent = "กำลังส่งคำสั่งหยุด…";
  try {
    savedAlarm = await settingsRequest({method: "POST"}, "/api/buzzer/stop");
    requestedStopVersion = savedAlarm.stop_revision;
    updateExtraSensors(lastSensorData);
  } catch (error) {
    message.textContent = "ยังยืนยันคำสั่งหยุดไม่ได้ กรุณาลองใหม่: " + error.message;
  } finally {
    button.disabled = false;
  }
});
async function readSensors() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("/api/sensors", { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    updateExtraSensors(data);
    drawThermal(data);
  } catch {
    showUnavailable("เชื่อมต่อ Cloud ไม่ได้ กำลังลองใหม่");
    updateExtraSensors(null);
  } finally {
    clearTimeout(timeout);
    setTimeout(readSensors, 1000);
  }
}
showUnavailable("กำลังรอข้อมูล AMG8833");
readSensors();
loadAlarmSettings();
