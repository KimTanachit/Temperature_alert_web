let socket = null;
let chart = null;

let lastAlertState = false;

let dangerThreshold = 100;
let resetThreshold = 100;

const MAX_REALTIME_POINTS = 50;

// ฟังก์ชันอัปเดตระดับความเสี่ยงตามอุณหภูมิ
function updateRiskLevel(temp) {
  const riskLevelEl = document.getElementById("riskLevel");
  
  if (!riskLevelEl) return;

  if (temp <= 38) {
    riskLevelEl.textContent = "ปกติ";
    riskLevelEl.style.color = "white"; // สีขาวปกติ (หรือเปลี่ยนเป็น "inherit" หากต้องการใช้สีตามธีม)
  } else if (temp > 38 && temp <= 50) {
    riskLevelEl.textContent = "สูงกว่าปกติ";
    riskLevelEl.style.color = "#FFD700"; // สีเหลือง (ใช้รหัส Hex เพื่อให้อ่านง่ายบนจอ)
  } else if (temp > 50 && temp <= 80) {
    riskLevelEl.textContent = "อุณหภูมิสูง มีความเสี่ยงไฟไหม้";
    riskLevelEl.style.color = "#FFA500"; // สีส้ม
  } else if (temp > 80) {
    riskLevelEl.textContent = "อันตราย ออกจากพื้นที่";
    riskLevelEl.style.color = "#FF0000"; // สีแดง
  }
}

// =====================================================
// FORMAT TIME
// =====================================================

function formatTime(timestamp) {

  return new Date(timestamp).toLocaleTimeString(
    "th-TH",
    {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }
  );
}


// =====================================================
// CONNECTION STATUS
// =====================================================

function setConnection(online) {

  const badge =
    document.getElementById(
      "connectionBadge"
    );

  const device =
    document.getElementById(
      "deviceStatus"
    );

  if (!badge) return;

  if (online) {

    badge.textContent =
      "ออนไลน์";

    badge.classList.remove(
      "offline"
    );

    badge.classList.add(
      "online"
    );

    if (device) {

      device.textContent =
        "ออนไลน์";
    }

  } else {

    badge.textContent =
      "ออฟไลน์";

    badge.classList.remove(
      "online"
    );

    badge.classList.add(
      "offline"
    );

    if (device) {

      device.textContent =
        "ออฟไลน์";
    }
  }
}


// =====================================================
// LOAD SETTINGS
// =====================================================

async function loadTemperatureSettings() {

  try {

    const response =
      await fetch(
        "/api/settings"
      );

    if (!response.ok) {

      throw new Error(
        "โหลด Settings ไม่สำเร็จ"
      );
    }

    const data =
      await response.json();

    dangerThreshold =
      Number(
        data.danger_threshold ?? 100
      );

    resetThreshold =
      Number(
        data.reset_threshold ??
        dangerThreshold
      );

    updateThresholdDisplay();

  } catch (error) {

    console.error(
      "[SETTINGS]",
      error
    );
  }
}


// =====================================================
// UPDATE THRESHOLD
// =====================================================

function updateThresholdDisplay() {

  const elements =
    document.querySelectorAll(
      "[data-danger-threshold]"
    );

  elements.forEach(
    (element) => {

      element.textContent =
        `${dangerThreshold}°C`;
    }
  );
}


// =====================================================
// LOAD HISTORY
// =====================================================

async function loadDashboardHistory() {

  try {

    const response =
      await fetch(
        "/api/temperature/history?minutes=60"
      );

    if (!response.ok) {

      throw new Error(
        "โหลด History ไม่สำเร็จ"
      );
    }

    const rows =
      await response.json();

    updateDashboardChart(
      rows
    );

  } catch (error) {

    console.error(
      "[HISTORY]",
      error
    );
  }
}


// =====================================================
// CREATE CHART
// =====================================================

function updateDashboardChart(
  rows
) {

  rows =
    Array.isArray(rows)
      ? rows.slice(
          -MAX_REALTIME_POINTS
        )
      : [];

  const labels =
    rows.map(
      (row) =>
        formatTime(
          row.recorded_at
        )
    );

  const values =
    rows.map(
      (row) =>
        Number(
          row.temperature
        )
    );

  const canvas =
    document.getElementById(
      "tempChart"
    );

  if (!canvas) return;

  if (chart) {

    chart.destroy();
  }

  chart =
    new Chart(
      canvas,
      {
        type: "line",

        data: {

          labels,

          datasets: [
            {
              label:
                "อุณหภูมิ (°C)",

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
            duration: 250
          },

          scales: {

            y: {

              suggestedMin: 0,

              suggestedMax: 120
            }
          }
        }
      }
    );
}


// =====================================================
// ADD REALTIME POINT
// =====================================================

function addRealtimePoint(
  temp,
  timestamp
) {

  if (!chart) return;

  const label =
    formatTime(
      timestamp
    );

  const value =
    Number(temp);

  chart.data.labels.push(
    label
  );

  chart.data.datasets[0].data.push(
    value
  );

  while (
    chart.data.labels.length >
    MAX_REALTIME_POINTS
  ) {

    chart.data.labels.shift();

    chart.data.datasets[0].data.shift();
  }

  chart.update(
    "none"
  );
}


// =====================================================
// CURRENT TEMPERATURE
// =====================================================

function updateCurrent(temp) {
  temp = Number(temp);

  if (!Number.isFinite(temp)) {
    return;
  }

  const currentTemp = document.getElementById("currentTemp");
  const riskLevel = document.getElementById("riskLevel");
  const tempStatus = document.getElementById("tempStatus");

  if (currentTemp) {
    currentTemp.textContent = `${temp.toFixed(1)} °C`;
  }

  const danger = temp > dangerThreshold;

  // ----------------------------------------------------
  // ลบส่วนนี้ของเดิมออก:
  // if (riskLevel) {
  //   riskLevel.textContent = danger ? "อันตราย" : "ปกติ";
  // }
  // 
  // แล้วเปลี่ยนเป็นเรียกใช้ฟังก์ชันที่คุณเขียนไว้แทน:
  // ----------------------------------------------------
  updateRiskLevel(temp);

  if (tempStatus) {
    tempStatus.textContent = danger ? `เกิน ${dangerThreshold}°C` : "อยู่ในเกณฑ์ปกติ";
  }

  if (danger && !lastAlertState) {
    showAlert(temp);
  }

  lastAlertState = danger;
}


// =====================================================
// ALERT POPUP
// =====================================================

function showAlert(
  temp
) {

  const alertTemp =
    document.getElementById(
      "alertTemp"
    );

  const overlay =
    document.getElementById(
      "alertOverlay"
    );

  if (alertTemp) {

    alertTemp.textContent =
      `${Number(temp).toFixed(1)} °C`;
  }

  if (overlay) {

    overlay.classList.remove(
      "hidden"
    );
  }

  if (
    "Notification" in window &&
    Notification.permission ===
      "granted"
  ) {

    new Notification(
      "🔥 แจ้งเตือนอุณหภูมิสูง",
      {
        body:
          `ตรวจพบ ${Number(temp).toFixed(1)}°C`
      }
    );
  }
}


// =====================================================
// CLOSE ALERT
// =====================================================

document
  .getElementById(
    "closeAlert"
  )
  ?.addEventListener(
    "click",
    () => {

      document
        .getElementById(
          "alertOverlay"
        )
        ?.classList.add(
          "hidden"
        );
    }
  );


// =====================================================
// REFRESH
// =====================================================

document
  .getElementById(
    "refreshBtn"
  )
  ?.addEventListener(
    "click",
    async () => {

      await loadTemperatureSettings();

      await loadDashboardHistory();
    }
  );


// =====================================================
// LOAD CURRENT
// =====================================================

async function loadCurrentTemperature() {

  try {

    const response =
      await fetch(
        "/api/temperature/current"
      );

    if (!response.ok) {

      throw new Error(
        "โหลด Current Temperature ไม่สำเร็จ"
      );
    }

    const data =
      await response.json();

    if (
      data.temperature !== null &&
      data.temperature !== undefined
    ) {

      updateCurrent(
        data.temperature
      );
    }

  } catch (error) {

    console.error(
      "[CURRENT]",
      error
    );
  }
}


// =====================================================
// SOCKET.IO
// =====================================================

function initSocket() {

  if (
    typeof io !==
    "function"
  ) {

    console.error(
      "[SOCKET] Socket.IO ไม่ถูกโหลด"
    );

    setConnection(false);

    return;
  }

  console.log(
    "[SOCKET] กำลังเชื่อมต่อ..."
  );

  socket =
    io(
      window.location.origin,
      {
        transports: [
          "websocket",
          "polling"
        ]
      }
    );


  // ===================================================
  // CONNECT
  // ===================================================

  socket.on(
    "connect",
    () => {

      console.log(
        "[SOCKET] CONNECTED"
      );

      console.log(
        "[SOCKET] ID:",
        socket.id
      );

      setConnection(true);
    }
  );


  // ===================================================
  // REALTIME TEMPERATURE
  // ===================================================

  socket.on(
    "temperature",
    (data) => {

      console.log(
        "[REALTIME] DATA:",
        data
      );

      if (
        !data ||
        data.temperature ===
          undefined
      ) {

        return;
      }

      updateCurrent(
        data.temperature
      );

      addRealtimePoint(
        data.temperature,
        data.timestamp ||
          new Date().toISOString()
      );
    }
  );


  // ===================================================
  // ALERT
  // ===================================================

  socket.on(
    "alert",
    (data) => {

      console.log(
        "[ALERT EVENT]",
        data
      );

      if (
        data &&
        data.temperature !==
          undefined
      ) {

        showAlert(
          data.temperature
        );
      }
    }
  );


  // ===================================================
  // CONNECT ERROR
  // ===================================================

  socket.on(
    "connect_error",
    (error) => {

      console.error(
        "[SOCKET] CONNECTION ERROR:",
        error.message
      );

      setConnection(false);
    }
  );


  // ===================================================
  // DISCONNECT
  // ===================================================

  socket.on(
    "disconnect",
    (reason) => {

      console.log(
        "[SOCKET] DISCONNECTED:",
        reason
      );

      setConnection(false);
    }
  );
}


// =====================================================
// INITIALIZE
// =====================================================

async function initDashboard() {

  console.log(
    "[DASHBOARD] Starting..."
  );

  // 1. โหลดเกณฑ์
  await loadTemperatureSettings();

  // 2. โหลด History
  await loadDashboardHistory();

  // 3. โหลดค่าปัจจุบัน
  await loadCurrentTemperature();

  // 4. เปิด Realtime
  initSocket();

  console.log(
    "[DASHBOARD] Ready"
  );
}


initDashboard();