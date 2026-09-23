"use strict";

let chart = null;
let dangerThreshold = 100;
let resetThreshold = 100;
let alertLatched = false;
let lastSensorTimestamp = 0;
let pollTimer = null;

const MAX_REALTIME_POINTS = 50;
const SENSOR_STALE_MS = 15000;
const POLL_INTERVAL_MS = 1000;

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("th-TH", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function setConnection(online) {
  const badge = document.getElementById("connectionBadge");
  const device = document.getElementById("deviceStatus");
  if (badge) {
    badge.textContent = online ? "ออนไลน์" : "ออฟไลน์";
    badge.classList.toggle("online", online);
    badge.classList.toggle("offline", !online);
  }
  if (device) device.textContent = online ? "ออนไลน์" : "ออฟไลน์";
}

function resetTemperatureDisplay(message = "รอข้อมูล DS18B20") {
  const current = document.getElementById("currentTemp");
  const status = document.getElementById("tempStatus");
  const risk = document.getElementById("riskLevel");
  const card = risk?.closest(".stat-card");
  if (current) current.textContent = "-- °C";
  if (status) status.textContent = message;
  if (risk) {
    risk.textContent = "ไม่ทราบ";
    risk.style.color = "#667085";
  }
  if (card) {
    card.style.backgroundColor = "#f8fcff";
    card.querySelectorAll("span, small").forEach((element) => {
      element.style.color = "";
    });
  }
  setConnection(false);
}

function updateRiskLevel(temp) {
  const risk = document.getElementById("riskLevel");
  const card = risk?.closest(".stat-card");
  if (!risk || !card) return;
  let safe = resetThreshold;
  const danger = dangerThreshold;
  if (!Number.isFinite(safe) || safe >= danger) safe = danger - 5;
  const middle = safe + (danger - safe) / 2;
  let background = "#f8fcff";
  let foreground = "black";
  if (temp <= safe) risk.textContent = "ปกติ";
  else if (temp <= middle) {
    risk.textContent = "สูงกว่าปกติ";
    background = "#FFD700";
  } else if (temp <= danger) {
    risk.textContent = "อุณหภูมิสูง มีความเสี่ยงไฟไหม้";
    background = "#FFA500";
  } else {
    risk.textContent = "อันตราย ออกจากพื้นที่";
    background = "#FF0000";
    foreground = "white";
  }
  card.style.backgroundColor = background;
  risk.style.color = foreground;
  card.querySelectorAll("span, small").forEach((element) => {
    element.style.color = foreground;
  });
}

function createRealtimeChart() {
  const canvas = document.getElementById("tempChart");
  if (!canvas || typeof Chart !== "function") return;
  chart?.destroy();
  chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: "DS18B20 (°C)", data: [], borderWidth: 2,
        tension: 0.35, fill: true, pointRadius: 2, pointHoverRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      scales: { y: { suggestedMin: 0, suggestedMax: 120 } },
    },
  });
}

function addRealtimePoint(temp, timestamp) {
  if (!chart || timestamp === lastSensorTimestamp) return;
  lastSensorTimestamp = timestamp;
  chart.data.labels.push(formatTime(timestamp));
  chart.data.datasets[0].data.push(temp);
  while (chart.data.labels.length > MAX_REALTIME_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update("none");
}

function showAlert(temp) {
  const value = document.getElementById("alertTemp");
  if (value) value.textContent = `${temp.toFixed(1)} °C`;
  document.getElementById("alertOverlay")?.classList.remove("hidden");
}

function updateCurrent(temp, timestamp) {
  document.getElementById("currentTemp").textContent = `${temp.toFixed(1)} °C`;
  document.getElementById("tempStatus").textContent =
    temp > dangerThreshold ? `DS18B20 เกิน ${dangerThreshold}°C` : "ข้อมูลจาก DS18B20";
  updateRiskLevel(temp);
  addRealtimePoint(temp, timestamp);
  if (temp > dangerThreshold && !alertLatched) {
    alertLatched = true;
    showAlert(temp);
  } else if (temp <= resetThreshold) {
    alertLatched = false;
  }
}

async function loadTemperatureSettings() {
  try {
    const response = await fetch("/api/settings", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    dangerThreshold = Number(data.danger_threshold ?? 100);
    resetThreshold = Number(data.reset_threshold ?? dangerThreshold);
  } catch (error) {
    console.error("[SETTINGS]", error);
  }
}

async function readDS18B20() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("/api/sensors", {
      cache: "no-store", signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const timestamp = Number(data.updatedAt);
    const temp = Number(data.ds18b20_temp_c);
    const fresh = Number.isFinite(timestamp) && timestamp > 0 &&
      Date.now() - timestamp <= SENSOR_STALE_MS;
    const valid = fresh && Number(data.ds18b20_status) === 1 &&
      data.ds18b20_temp_c !== null && Number.isFinite(temp);
    if (!valid) {
      resetTemperatureDisplay(
        !fresh ? "ไม่ได้รับข้อมูลใหม่จากบอร์ด" : "ไม่พบ DS18B20 หรืออ่านค่าไม่ได้"
      );
      return;
    }
    setConnection(true);
    updateCurrent(temp, timestamp);
  } catch (error) {
    console.error("[DS18B20]", error);
    resetTemperatureDisplay("เชื่อมต่อข้อมูล DS18B20 ไม่ได้");
  } finally {
    clearTimeout(timeout);
    pollTimer = setTimeout(readDS18B20, POLL_INTERVAL_MS);
  }
}

document.getElementById("closeAlert")?.addEventListener("click", () => {
  document.getElementById("alertOverlay")?.classList.add("hidden");
});

document.getElementById("refreshBtn")?.addEventListener("click", async () => {
  clearTimeout(pollTimer);
  await loadTemperatureSettings();
  await readDS18B20();
});

async function initDashboard() {
  createRealtimeChart();
  resetTemperatureDisplay();
  await loadTemperatureSettings();
  await readDS18B20();
}

initDashboard();
