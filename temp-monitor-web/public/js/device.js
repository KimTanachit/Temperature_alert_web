const deviceOnlineEl = document.getElementById("deviceOnline");
const lastSeenEl = document.getElementById("lastSeen");
const wifiEl = document.getElementById("wifi");
const controllerEl = document.getElementById("controller");
const sensorEl = document.getElementById("sensor");

function setText(el, text) {
  if (el) el.textContent = text;
}

function formatTime(value) {
  if (!value) return "--";

  const date = new Date(value);
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

async function loadDeviceStatus() {
  try {
    const res = await fetch("/api/device/status", {
      cache: "no-store"
    });

    if (!res.ok) throw new Error("status api failed");

    const data = await res.json();
    const online = !!data.online;

    setText(deviceOnlineEl, online ? "ออนไลน์" : "ออฟไลน์");
    setText(lastSeenEl, formatTime(data.last_seen));
    setText(wifiEl, data.wifi_status ? "ออนไลน์" : "ออฟไลน์");
    setText(controllerEl, data.controller_online ? "ออนไลน์" : "ออฟไลน์");

    if (!online) {
      setText(sensorEl, "ออฟไลน์");
    } else if (data.servo?.sensor_text) {
      setText(sensorEl, data.servo.sensor_text);
    } else {
      setText(sensorEl, data.sensor_status ? "ออนไลน์" : "ไม่พบเซนเซอร์");
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
