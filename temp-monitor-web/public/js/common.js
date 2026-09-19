document.addEventListener("DOMContentLoaded", async () => {
  // 1. ปุ่มเปิด-ปิด Sidebar บนมือถือ
  const menuBtn = document.getElementById("menuBtn");
  const sidebar = document.getElementById("sidebar");
  if (menuBtn && sidebar) {
    menuBtn.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });
  }

  // 2. ตรวจสอบสถานะ Admin
  try {
    const res = await fetch("/api/auth/status");
    const data = await res.json();

    const adminElements = document.querySelectorAll(".admin-only");
    const userArea = document.getElementById("userArea") || document.querySelector(".top-user");

    if (data.isAdmin) {
      // โหมด Admin: แสดงเมนู Servo & Settings
      adminElements.forEach((el) => {
        el.style.display = "block";
      });

      // แถบขวาบนแสดงชื่อ Admin พร้อมปุ่มออกจากระบบสีแดง
      if (userArea) {
        userArea.innerHTML = `
          <span>🔔 &nbsp; </span>
          <strong style="color: #22c55e;">ผู้ดูแลระบบ (Admin)</strong>
          <span> &nbsp; </span>
          <button id="logoutBtn" style="background: #ef4444; color: #fff; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;">ออกจากระบบ</button>
        `;

        document.getElementById("logoutBtn")?.addEventListener("click", async () => {
          if (confirm("ต้องการออกจากระบบหรือไม่?")) {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/";
          }
        });
      }
    } else {
      // โหมด User ทั่วไป: ซ่อนเมนู Admin
      adminElements.forEach((el) => {
        el.style.display = "none";
      });

      // ทำให้แถบ "ผู้ใช้งานทั่วไป 👤" ด้านขวาบนคลิกได้จริง เพื่อเข้า Login
      if (userArea) {
        userArea.style.cursor = "pointer";
        userArea.title = "เข้าสู่ระบบ";
        userArea.innerHTML = `
          <span>🔔 &nbsp; </span>
          <span>ผู้ใช้งานทั่วไป</span>
          <span> &nbsp; 👤</span>
        `;
        
        userArea.onclick = () => {
          window.location.href = "/login.html";
        };
      }
    }
  } catch (err) {
    console.error("Auth check failed:", err);
  }
});