document.addEventListener("DOMContentLoaded", async () => {
  // รองรับการกดปุ่มเมนูเปิด-ปิด Sidebar บนมือถือ
  const menuBtn = document.getElementById("menuBtn");
  const sidebar = document.getElementById("sidebar");
  if (menuBtn && sidebar) {
    menuBtn.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });
  }

  // ตรวจสอบสถานะ Admin และจัดการเมนูนำทาง
  try {
    const res = await fetch("/api/auth/status");
    const data = await res.json();

    const adminElements = document.querySelectorAll(".admin-only");
    const navMenu = document.getElementById("navMenu") || document.querySelector("aside nav");
    const userStatusText = document.getElementById("userStatusText");

    if (data.isAdmin) {
      // 1. ถ้าเป็น Admin ให้แสดงปุ่มตั้งค่าและ Servo
      adminElements.forEach((el) => {
        el.style.display = "block";
      });

      if (userStatusText) {
        userStatusText.innerText = "ผู้ดูแลระบบ (Admin)";
      }

      // 2. เพิ่มปุ่มออกจากระบบ (Logout)
      if (navMenu && !document.getElementById("navLogout")) {
        const logoutLink = document.createElement("a");
        logoutLink.id = "navLogout";
        logoutLink.href = "#";
        logoutLink.innerText = "ออกจากระบบ";
        logoutLink.style.color = "#ff4d4f";
        logoutLink.addEventListener("click", async (e) => {
          e.preventDefault();
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/";
        });
        navMenu.appendChild(logoutLink);
      }
    } else {
      // 1. ถ้าไม่ใช่ Admin ให้ซ่อนเมนู
      adminElements.forEach((el) => {
        el.style.display = "none";
      });

      if (userStatusText) {
        userStatusText.innerText = "ผู้ใช้งานทั่วไป";
      }

      // 2. เพิ่มปุ่มเข้าสู่ระบบสำหรับ Admin
      if (navMenu && !document.getElementById("navLogin")) {
        const loginLink = document.createElement("a");
        loginLink.id = "navLogin";
        loginLink.href = "/login.html";
        loginLink.innerText = "เข้าสู่ระบบ Admin";
        navMenu.appendChild(loginLink);
      }
    }
  } catch (err) {
    console.error("Auth check failed:", err);
  }
});