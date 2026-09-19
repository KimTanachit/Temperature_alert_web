let tempChart = null;
let minutes = 1440;

async function getJSON(url, options = {}) {
  const res = await fetch(url, options);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.json();
}

async function loadRoomTemperature() {
  const roomTempEl = document.getElementById("roomTemp");

  if (!roomTempEl) {
    return;
  }

  try {
    const data = await getJSON("/api/sensors");
    const temp = data.room_temp_c ?? data.ds18b20_temp_c;

    roomTempEl.textContent =
      temp === null || temp === undefined
        ? "-- °C"
        : `${Number(temp).toFixed(1)} °C`;
  } catch (e) {
    console.error("ROOM TEMP ERROR:", e);
    roomTempEl.textContent = "-- °C";
  }
}

async function loadTemperature() {
  try {
    const rows = await getJSON(`/api/temperature/history?minutes=${minutes}`);
    const vals = rows.map(r => Number(r.temperature));

    document.getElementById("maxTemp").textContent =
      vals.length ? `${Math.max(...vals).toFixed(1)} °C` : "-- °C";

    document.getElementById("minTemp").textContent =
      vals.length ? `${Math.min(...vals).toFixed(1)} °C` : "-- °C";

    document.getElementById("avgTemp").textContent =
      vals.length
        ? `${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)} °C`
        : "-- °C";

    draw(rows);
  } catch (e) {
    console.error("TEMP HISTORY ERROR:", e);
  }
}

function draw(rows) {
  const canvas = document.getElementById("tempChart");

  if (!canvas) {
    return;
  }

  if (tempChart) {
    tempChart.destroy();
  }

  tempChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: rows.map(r =>
        new Date(r.recorded_at).toLocaleTimeString("th-TH", {
          hour: "2-digit",
          minute: "2-digit"
        })
      ),
      datasets: [
        {
          label: "อุณหภูมิ",
          data: rows.map(r => Number(r.temperature)),
          borderWidth: 2,
          tension: 0.3,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          suggestedMin: 0,
          suggestedMax: 120
        }
      }
    }
  });
}

document.querySelectorAll(".range-btn").forEach(btn =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".range-btn").forEach(b =>
      b.classList.remove("active")
    );

    btn.classList.add("active");
    minutes = Number(btn.dataset.minutes);

    loadTemperature();
  })
);

async function init() {
  await loadRoomTemperature();
  await loadTemperature();

  setInterval(loadRoomTemperature, 3000);
  setInterval(loadTemperature, 2000);
}

init();
