let socket = null;
let chart = null;
let lastAlertState = false;

// จำนวนจุด Real-time ที่แสดงบนกราฟ
const MAX_REALTIME_POINTS = 60;

// =====================================================
// LOAD HISTORY FROM DATABASE
// =====================================================

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

// =====================================================
// CREATE / UPDATE CHART
// =====================================================

function updateDashboardChart(rows) {
  const labels = rows.map(r =>
    new Date(r.recorded_at).toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  );

  const values = rows.map(r => Number(r.temperature));

  const canvas = document.getElementById("tempChart");

  if (!canvas) return;

  if (chart) {
    chart.destroy();
  }

  chart = new Chart(canvas, {
    type: "line",

    data: {
      labels: labels,

      datasets: [
        {
          label: "อุณหภูมิ (°C)",
          data: values,

          borderWidth: 2,
          tension: 0.35,
          fill: true,

          pointRadius: 2,
          pointHoverRadius: 5
        }
      ]
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,

      animation: {
        duration: 300
      },

      scales: {
        y: {
          suggestedMin: 0,
          suggestedMax: 120
        }
      }
    }
  });
}

// =====================================================
// REAL-TIME ADD POINT
// =====================================================

function addRealtimePoint(temp, timestamp) {
  if (!chart) return;

  const label = new Date(timestamp).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const value = Number(temp);

  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(value);

  // จำกัดจำนวนจุดบนกราฟ
  if (chart.data.labels.length > MAX_REALTIME_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }

  chart.update("none");
}

// =====================================================
// CURRENT TEMPERATURE
// =====================================================

function updateCurrent(temp) {
  document.getElementById("currentTemp").textContent =
    `${Number(temp).toFixed(1)} °C`;

  const danger = Number(temp) > 100;

  document.getElementById("riskLevel").textContent =
    danger ? "อันตราย" : "ปกติ";

  document.getElementById("tempStatus").textContent =
    danger ? "เกิน 100°C" : "อยู่ในเกณฑ์ปกติ";

  document.getElementById("deviceStatus").textContent =
    "ออนไลน์";

  if (danger && !lastAlertState) {
    showAlert(temp);
  }

  lastAlertState = danger;
}

// =====================================================
// POPUP ALERT
// =====================================================

function showAlert(temp) {
  document.getElementById("alertTemp").textContent =
    `${Number(temp).toFixed(1)} °C`;

  document
    .getElementById("alertOverlay")
    .classList.remove("hidden");

  if (
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    new Notification("🔥 แจ้งเตือนอุณหภูมิสูง", {
      body: `ตรวจพบ ${Number(temp).toFixed(1)}°C`
    });
  }
}

// =====================================================
// CLOSE ALERT
// =====================================================

document
  .getElementById("closeAlert")
  ?.addEventListener("click", () => {
    document
      .getElementById("alertOverlay")
      .classList.add("hidden");
  });

// =====================================================
// REFRESH BUTTON
// =====================================================

document
  .getElementById("refreshBtn")
  ?.addEventListener("click", loadDashboardHistory);

// =====================================================
// INITIALIZE DASHBOARD
// =====================================================

async function initDashboard() {

  // โหลดข้อมูลย้อนหลังจาก Database ครั้งแรก
  await loadDashboardHistory();

  // โหลดค่าปัจจุบัน
  try {
    const current = await getJSON(API.current);

    if (current.temperature != null) {
      updateCurrent(current.temperature);
    }
  } catch (e) {
    console.error(e);
  }

  // ===================================================
  // SOCKET.IO REAL-TIME
  // ===================================================

  if (typeof io === "function") {

    socket = io();

    socket.on("connect", () => {
      console.log("[SOCKET] connected");
      setConnection(true);
    });

    socket.on("disconnect", () => {
      console.log("[SOCKET] disconnected");
      setConnection(false);
    });

    // รับค่า Sensor ทุกครั้งที่ส่งมา
    socket.on("temperature", data => {

      console.log(
        "[REAL-TIME]",
        data.temperature,
        data.timestamp
      );

      // อัปเดตตัวเลขปัจจุบัน
      updateCurrent(data.temperature);

      // ⭐ เพิ่มจุดใหม่ลงกราฟทันที
      addRealtimePoint(
        data.temperature,
        data.timestamp
      );
    });
  }
}

initDashboard();
