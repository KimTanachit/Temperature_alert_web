let allRows = [];
let dangerThreshold = 100; // ค่าเริ่มต้นก่อนโหลด API

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

// 1. ฟังก์ชันดึงค่าการตั้งค่า (เอาเกณฑ์อันตรายมาใช้)
async function loadSettings() {
  try {
    const response = await fetch("/api/settings");
    if (response.ok) {
      const data = await response.json();
      dangerThreshold = Number(data.danger_threshold ?? 100);
    }
  } catch (e) {
    console.error("Load Settings Error:", e);
  }
}

// 2. ฟังก์ชันดึงประวัติจากฐานข้อมูล
async function loadHistory() {
  try {
    const response = await fetch("/api/temperature/history?minutes=43200");
    if (!response.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ");
    
    const data = await response.json();
    
    // เรียงข้อมูลจากเวลาล่าสุด (ใหม่สุด) ลงไปหาเก่าสุด
    allRows = data.sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
    
    render();
  } catch(e) { 
    console.error("Load History Error:", e); 
    document.getElementById("historyBody").innerHTML = `<tr><td colspan="6" style="color:red;">ไม่สามารถดึงข้อมูลประวัติได้</td></tr>`;
  }
}

// 3. ฟังก์ชันสร้างตาราง
function render() {
  const q = (document.getElementById("search").value || "").toLowerCase();
  const date = document.getElementById("dateFilter").value;
  
  // กรองข้อมูลตามการค้นหาและวันที่
  const rows = allRows.filter(r => {
    const d = new Date(r.recorded_at);
    const okDate = !date || d.toLocaleDateString("en-CA", {timeZone:"Asia/Bangkok"}) === date;
    const text = `${r.temperature} ${r.recorded_at}`.toLowerCase();
    return okDate && text.includes(q);
  });
  
  const body = document.getElementById("historyBody");
  
  // นำข้อมูลลงตาราง
  body.innerHTML = rows.length ? rows.map((r, i) => {
    const temp = Number(r.temperature);
    const isDanger = temp > dangerThreshold; 
    
    return `<tr>
      <td>${i + 1}</td>
      <td>${formatDate(r.recorded_at)}</td>
      <td><b>${temp.toFixed(1)}</b></td>
      <td><span class="status-pill ${isDanger ? 'danger' : 'normal'}">${isDanger ? 'อันตราย' : 'ปกติ'}</span></td>
      <td>-</td>
      <td>${isDanger ? `อุณหภูมิเกิน ${dangerThreshold}°C` : '-'}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="6">ไม่พบข้อมูล</td></tr>`;
}

// 4. ฟังก์ชันเริ่มต้นระบบสำหรับหน้านี้
async function initHistoryPage() {
  // ต้องโหลด Settings ก่อน เพื่อให้รู้ว่าเกณฑ์คือเท่าไหร่ ค่อยโหลดประวัติมาแสดง
  await loadSettings();
  await loadHistory();
  
  // อัปเดตข้อมูลอัตโนมัติทุกๆ 10 วินาที
  setInterval(async () => {
    await loadSettings();
    await loadHistory();
  }, 10000);
}

// ผูก Event Listener สำหรับช่องค้นหาและตัวกรองวันที่
document.getElementById("search").addEventListener("input", render);
document.getElementById("dateFilter").addEventListener("change", render);

// เริ่มการทำงาน
initHistoryPage();