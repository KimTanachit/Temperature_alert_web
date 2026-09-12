let socket = null;
let chart = null;
let lastAlertState = false;

async function loadDashboardHistory() {
  try {
    const rows = await getJSON(`${API.history}?minutes=60`);
    updateDashboardChart(rows);
    setConnection(true);
  } catch (e) {
    console.error(e);
    setConnection(false);
  }
}

function updateDashboardChart(rows) {
  const labels = rows.map(r => new Date(r.recorded_at).toLocaleTimeString("th-TH", {hour:"2-digit",minute:"2-digit"}));
  const values = rows.map(r => Number(r.temperature));
  const canvas = document.getElementById("tempChart");
  if (!canvas) return;
  if (chart) chart.destroy();
  chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ label:"อุณหภูมิ (°C)", data:values, borderWidth:2, tension:.35, fill:true }] },
    options: { responsive:true, maintainAspectRatio:false, scales:{ y:{ suggestedMin:0, suggestedMax:120 } } }
  });
}

function updateCurrent(temp) {
  document.getElementById("currentTemp").textContent = `${Number(temp).toFixed(1)} °C`;
  const danger = Number(temp) > 100;
  document.getElementById("riskLevel").textContent = danger ? "อันตราย" : "ปกติ";
  document.getElementById("tempStatus").textContent = danger ? "เกิน 100°C" : "อยู่ในเกณฑ์ปกติ";
  document.getElementById("deviceStatus").textContent = "ออนไลน์";
  if (danger && !lastAlertState) showAlert(temp);
  lastAlertState = danger;
}

function showAlert(temp) {
  document.getElementById("alertTemp").textContent = `${Number(temp).toFixed(1)} °C`;
  document.getElementById("alertOverlay").classList.remove("hidden");
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("🔥 แจ้งเตือนอุณหภูมิสูง", { body:`ตรวจพบ ${Number(temp).toFixed(1)}°C` });
  }
}

document.getElementById("closeAlert")?.addEventListener("click", () => {
  document.getElementById("alertOverlay").classList.add("hidden");
});

document.getElementById("refreshBtn")?.addEventListener("click", loadDashboardHistory);

async function initDashboard() {
  await loadDashboardHistory();
  try {
    const current = await getJSON(API.current);
    if (current.temperature != null) updateCurrent(current.temperature);
  } catch(e) {}

  if (typeof io === "function") {
    socket = io();
    socket.on("connect", () => setConnection(true));
    socket.on("disconnect", () => setConnection(false));
    socket.on("temperature", data => {
      updateCurrent(data.temperature);
      loadDashboardHistory();
    });
  }

  // ตาม requirement: ดึงข้อมูลจาก Database ทุก 2 วินาที
  setInterval(loadDashboardHistory, 2000);
}
initDashboard();
