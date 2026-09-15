const deviceOnlineEl = document.getElementById("deviceOnline");
const lastSeenEl = document.getElementById("lastSeen");
const wifiEl = document.getElementById("wifi");
const controllerEl = document.getElementById("controller");
const sensorEl = document.getElementById("sensor");

function setText(el, text) {
  if (el) el.textContent = text;
}

function formatTime(updatedAt) {
  if (!updatedAt) return "--";

  const date = new Date(Number(updatedAt));
  if (Number.isNaN(date.getTime())) return "--";

  return date.toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "medium"
  });
}

function isOnline(updatedAt) {
  return updatedAt && Date.now() - Number(updatedAt) < 15000;
}

async function loadDeviceStatus() {
  try {
    const res = await fetch("/api/sensors", {
      cache: "no-store"
    });

    const data = await res.json();
    const online = isOnline(data.updatedAt);

    setText(deviceOnlineEl, online ? "ออนไลน์" : "ออฟไลน์");
    setText(lastSeenEl, formatTime(data.updatedAt));
    setText(wifiEl, online ? "ออนไลน์" : "ออฟไลน์");
    setText(controllerEl, online ? "ออนไลน์" : "ออฟไลน์");

    if (!online) {
      setText(sensorEl, "ออฟไลน์");
    } else {
      setText(sensorEl, data.sensor_text || "ออนไลน์");
    }
  } catch (err) {
    setText(deviceOnlineEl, "ออฟไลน์");
    setText(lastSeenEl, "--");
    setText(wifiEl, "ออฟไลน์");
    setText(controllerEl, "ออฟไลน์");
    setText(sensorEl, "เชื่อมต่อ server ไม่ได้");
  }
}

loadDeviceStatus();
setInterval(loadDeviceStatus, 3000);
