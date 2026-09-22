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
    // ค้นหาจากข้อความ message หรือ temperature
    const text = `${r.temperature} ${r.message || ''}`.toLowerCase();
    return okDate && text.includes(q);
  });
  
  const body = document.getElementById("historyBody");
  
  // นำข้อมูลลงตาราง โดยดึงค่าตรงๆ จากตาราง alerts ใน Supabase
  body.innerHTML = rows.length ? rows.map((r, i) => {
    return `<tr>
      <td>${i + 1}</td>
      <td>${formatDate(r.created_at)}</td>
      <td><b>${Number(r.temperature).toFixed(2)}</b></td>
      <td><span class="status-pill danger">อันตราย</span></td>
      <td>${r.line_sent ? '✅ ส่งแล้ว' : '❌ ไม่สำเร็จ'}</td>
      <td>${r.message || '-'}</td>
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