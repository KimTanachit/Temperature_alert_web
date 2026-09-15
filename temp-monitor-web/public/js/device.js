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

  const parts = new Intl.DateTimeFormat("th-TH", {
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value;

  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

function isOnline(updatedAt) {
  if (!updatedAt) return false;

  return Date.now() - Number(updatedAt) < 30000;
}

async function loadDeviceStatus() {
  try {
    const res = await fetch("/api/sensors", {
      cache: "no-store"
    });

    if (!res.ok) {
      throw new Error("api error");
    }

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
setInterval(loadDeviceStatus, 1000);
