function statusText(value) {
  if (value === null || value === undefined) return "รอข้อมูล";
  return value ? "ออนไลน์" : "ออฟไลน์";
}

async function loadDevice() {
  try {
    const d = await getJSON(SERVO_API_TOKEN);

    document.getElementById("deviceOnline").textContent = statusText(d.online);
    document.getElementById("wifi").textContent = statusText(d.wifi_status);
    document.getElementById("controller").textContent = statusText(d.controller_online);
    document.getElementById("sensor").textContent = statusText(d.sensor_status);
    document.getElementById("lastSeen").textContent = formatDate(d.last_seen);

    // ไม่มีแบตเตอรี่ในระบบนี้ จ่ายไฟตรงจาก adapter/USB ตลอดเวลา
    const batteryEl = document.getElementById("battery");
    if (batteryEl) batteryEl.textContent = "จ่ายไฟจาก Adapter";
  } catch(e) { console.error(e); }
}
loadDevice();
setInterval(loadDevice, 2000);