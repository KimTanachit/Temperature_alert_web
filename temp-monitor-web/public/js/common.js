document.addEventListener("DOMContentLoaded", async () => {
  // 1. ปุ่มเปิด-ปิด Sidebar บนจอมือถือ
  const menuBtn = document.getElementById("menuBtn");
  const sidebar = document.getElementById("sidebar");
  if (menuBtn && sidebar) {
    menuBtn.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });
  }

  // 2. ซ่อนทางเข้า Login ลับ:
  // - ดับเบิลคลิก (Double Click) ที่โลโก้หรือชื่อระบบด้านบน/ข้าง เพื่อไปหน้า Login
  const brandLogo = document.querySelector(".brand");
  const topTitle = document.querySelector(".top-title");
  [brandLogo, topTitle].forEach((el) => {
    if (el) {
      el.addEventListener("dblclick", () => {
        window.location.href = "/login.html";
      });
    }
  });

  // - กดคีย์ลัด Ctrl + Shift + A (หรือ Cmd + Shift + A บน Mac) เพื่อไปหน้า Login
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a") {
      window.location.href = "/login.html";
    }
  });

  // 3. ตรวจสอบสถานะ Admin จาก Server
  try {
    const res = await fetch("/api/auth/status");
    const data = await res.json();

    const adminElements = document.querySelectorAll(".admin-only");
    const userArea = document.getElementById("userArea") || document.querySelector(".top-user");
    const navMenu = document.getElementById("navMenu") || document.querySelector("aside nav");

    if (data.isAdmin) {
      // แสดงเมนู Servo Control และ Settings
      adminElements.forEach((el) => {
        el.style.display = "block";
      });

      // ปรับแถบสถานะด้านบนเป็น Admin
      if (userArea) {
        userArea.innerHTML = `
          <span>🔔 &nbsp; </span>
          <span style="font-weight: 600;">ผู้ดูแลระบบ (Admin)</span>
          <span> &nbsp; </span>
          <a href="#" id="logoutBtn" title="ออกจากระบบ" style="text-decoration: none; cursor: pointer;">🚪 ออกจากระบบ</a>
        `;

        document.getElementById("logoutBtn")?.addEventListener("click", async (e) => {
          e.preventDefault();
          if (confirm("ต้องการออกจากระบบผู้ดูแลระบบใช่หรือไม่?")) {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/";
          }
        });
      }
    } else {
      // สำหรับ User ทั่วไป: ซ่อนเมนูตั้งค่าและ Servo ทั้งหมด
      adminElements.forEach((el) => {
        el.style.display = "none";
      });

      // แสดงสถานะเป็นไอคอนปกติ โดยคลิกไอคอน 👤 แบบเงียบๆ เพื่อเข้าหน้า Login ได้
      if (userArea) {
        userArea.innerHTML = `
          <span>🔔 &nbsp; </span>
          <span>ผู้ใช้งานทั่วไป</span>
          <span> &nbsp; </span>
          <a href="/login.html" title="" style="text-decoration: none; color: inherit; cursor: default;">👤</a>
        `;
      }
    }
  } catch (err) {
    console.error("Auth check failed:", err);
  }
});