let allRows = [];

// ฟังก์ชันจัดรูปแบบเวลา
function formatDate(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

// ฟังก์ชันดึงประวัติจากตาราง alerts
async function loadHistory() {
  try {
    // ⚠️ เปลี่ยน URL ตรงนี้ให้ตรงกับ API ที่ดึงข้อมูลจากตาราง alerts ของคุณ
    // เช่น "/api/alerts" หรือ "/api/history/alerts"
    const response = await fetch("/api/alerts"); 
    
    if (!response.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ");
    
    const data = await response.json();
    
    // เรียงข้อมูลจากเวลาล่าสุด (ใหม่สุด) ลงไปหาเก่าสุด (ใช้ created_at ตาม DB)
    allRows = data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    render();
  } catch(e) { 
    console.error("Load History Error:", e); 
    document.getElementById("historyBody").innerHTML = `<tr><td colspan="6" style="color:red;">ไม่สามารถดึงข้อมูลประวัติแจ้งเตือนได้</td></tr>`;
  }
}

// ฟังก์ชันสร้างตาราง
function render() {
  const q = (document.getElementById("search").value || "").toLowerCase();
  const date = document.getElementById("dateFilter").value;
  
  // กรองข้อมูลตามการค้นหาและวันที่ (ใช้ created_at)
  const rows = allRows.filter(r => {
    const d = new Date(r.created_at);
    const okDate = !date || d.toLocaleDateString("en-CA", {timeZone:"Asia/Bangkok"}) === date;
    const text = [
      r.temperature,
      r.message,
      r.alert_type,
      r.notification_channel,
      r.direction_label,
      r.direction_angle,
      r.heat_source,
    ].filter(Boolean).join(" ").toLowerCase();
    return okDate && text.includes(q);
  });
  
  const body = document.getElementById("historyBody");
  
  body.innerHTML = rows.length ? rows.map((r, i) => {
    const channel = r.notification_channel || (r.line_sent ? "line" : "-");
    const sent = r.telegram_sent === true || r.line_sent === true;
    const direction = r.direction_label
      ? `ทิศ: ${r.direction_label}${r.direction_angle !== null && r.direction_angle !== undefined ? ` (${r.direction_angle}°)` : ""}`
      : "";
    const source = r.heat_source ? `แหล่งข้อมูล: ${r.heat_source}` : "";
    const amg = Number.isFinite(Number(r.amg_max_temp_c)) ? `AMG Max: ${Number(r.amg_max_temp_c).toFixed(2)}°C` : "";
    const ds = Number.isFinite(Number(r.ds18b20_temp_c)) ? `DS18B20: ${Number(r.ds18b20_temp_c).toFixed(2)}°C` : "";
    const detail = [r.message || "-", direction, source, amg, ds].filter(Boolean).join("<br>");

    return `<tr>
      <td>${i + 1}</td>
      <td>${formatDate(r.created_at)}</td>
      <td><b>${Number(r.temperature).toFixed(2)}</b></td>
      <td><span class="status-pill danger">${r.alert_type === "thermal_lock" ? "Thermal Lock" : "อันตราย"}</span></td>
      <td>${sent ? "✅ ส่งแล้ว" : "❌ ไม่สำเร็จ"}<br><small>${channel}</small></td>
      <td>${detail}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="6">ไม่พบข้อมูล</td></tr>`;
}

// ผูก Event Listener สำหรับช่องค้นหาและตัวกรองวันที่
document.getElementById("search").addEventListener("input", render);
document.getElementById("dateFilter").addEventListener("change", render);

// เริ่มการทำงาน
loadHistory();

// อัปเดตข้อมูลอัตโนมัติทุกๆ 10 วินาที
setInterval(loadHistory, 10000);
