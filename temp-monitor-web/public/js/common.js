const API = {
  history: "/api/temperature/history",
  current: "/api/temperature/current",
  device: "/api/device/status",
  settings: "/api/settings"
};

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("menuBtn");
  const sidebar = document.getElementById("sidebar");
  if (btn && sidebar) btn.addEventListener("click", () => sidebar.classList.toggle("open"));
});

async function getJSON(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatDate(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "medium" });
}

function setConnection(online) {
  const el = document.getElementById("connectionBadge");
  if (!el) return;
  el.textContent = online ? "● เชื่อมต่อแล้ว" : "○ ออฟไลน์";
  el.className = `badge ${online ? "online" : "offline"}`;
}
