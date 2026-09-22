// กำหนด URL สำหรับเรียกใช้งาน API (แก้ไข Path ได้ตามที่ Backend คุณตั้งไว้)
const API = {
  settings: "/api/settings" 
};

// สร้างฟังก์ชัน getJSON สำหรับจัดการดึงและส่งข้อมูล
async function getJSON(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return await response.json();
}
document.addEventListener("DOMContentLoaded", async () => {
  // ปุ่มเปิด-ปิดเมนูบนมือถือ
  const menuBtn = document.getElementById("menuBtn");
  const sidebar = document.getElementById("sidebar");
  
  if (menuBtn && sidebar) {
    menuBtn.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });
  }

  try {
    const res = await fetch("/api/auth/status");
    const data = await res.json();

    const adminElements = document.querySelectorAll(".admin-only");
    const userArea = document.getElementById("userArea");
    const userStatusText = document.getElementById("userStatusText");

    if (data.isAdmin) {
      // 1. ถ้าเป็น Admin ให้เปิดการแสดงเมนู
      adminElements.forEach((el) => {
        el.style.display = "block";
      });

      // 2. เปลี่ยนปุ่มขวาบนให้กลายเป็นปุ่มออกจากระบบ
      if (userArea) {
        userArea.href = "#";
        userArea.innerHTML = `
          <span>🔔 &nbsp; </span>
          <span style="font-weight: bold; color: #4ade80;">ผู้ดูแลระบบ (Admin)</span>
          <span> &nbsp; </span>
          <span style="background: #ef4444; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 12px;">ออกจากระบบ</span>
        `;
        
        userArea.onclick = async (e) => {
          e.preventDefault();
          if (confirm("ต้องการออกจากระบบใช่หรือไม่?")) {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/";
          }
        };
      }
    } else {
      // ถ้าไม่ใช่ Admin ให้ซ่อนเมนู
      adminElements.forEach((el) => {
        el.style.display = "none";
      });

      // ตั้งค่าให้คลิกแล้วไปหน้า login
      if (userArea) {
        userArea.href = "/login.html";
      }
    }
  } catch (err) {
    console.error("Auth check failed:", err);
  }
});