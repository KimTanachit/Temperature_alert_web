const deviceOnlineEl = document.getElementById("deviceOnline");
const lastSeenEl = document.getElementById("lastSeen");
const uptimeEl = document.getElementById("uptime");
const wifiEl = document.getElementById("wifi");
const controllerEl = document.getElementById("controller");
const sensorEl = document.getElementById("sensor");

function setText(element, text) {
    if (element) {
        element.textContent = text;
    }
}

function formatLastSeen(updatedAt) {
    if (!updatedAt) {
        return "--";
    }

    const date = new Date(Number(updatedAt));

    if (Number.isNaN(date.getTime())) {
        return "--";
    }

    return date.toLocaleString("th-TH", {
        dateStyle: "short",
        timeStyle: "medium"
    });
}

function formatUptime(updatedAt) {
    if (!updatedAt) {
        return "-- วัน -- ชั่วโมง";
    }

    const ms = Date.now() - Number(updatedAt);

    if (!Number.isFinite(ms) || ms < 0) {
        return "-- วัน -- ชั่วโมง";
    }

    const totalMinutes = Math.floor(ms / (1000 * 60));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);

    return `${days} วัน ${hours} ชั่วโมง`;
}

function isOnline(updatedAt) {
    if (!updatedAt) {
        return false;
    }

    return Date.now() - Number(updatedAt) < 15000;
}

function sensorStatusText(data, online) {
    if (!online) {
        return "ออฟไลน์";
    }

    const status = Number(data.sensor_status);

    if (status === 3) {
        return "ออนไลน์";
    }

    if (status === 2) {
        return "VL53L0X ออนไลน์ / MLX90614 ไม่พบ";
    }

    if (status === 1) {
        return "MLX90614 ออนไลน์ / VL53L0X ไม่พบ";
    }

    return data.sensor_text || "ไม่พบเซนเซอร์";
}

async function loadDeviceStatus() {
    try {
        const response = await fetch("/api/sensors", {
            cache: "no-store"
        });

        const data = await response.json();
        const online = isOnline(data.updatedAt);

        setText(deviceOnlineEl, online ? "ออนไลน์" : "ออฟไลน์");
        setText(lastSeenEl, formatLastSeen(data.updatedAt));
        setText(uptimeEl, online ? formatUptime(data.updatedAt) : "-- วัน -- ชั่วโมง");
        setText(wifiEl, online ? "ออนไลน์" : "ออฟไลน์");
        setText(controllerEl, online ? "ออนไลน์" : "ออฟไลน์");
        setText(sensorEl, sensorStatusText(data, online));

    } catch (error) {
        setText(deviceOnlineEl, "ออฟไลน์");
        setText(lastSeenEl, "--");
        setText(uptimeEl, "-- วัน -- ชั่วโมง");
        setText(wifiEl, "ออฟไลน์");
        setText(controllerEl, "ออฟไลน์");
        setText(sensorEl, "เชื่อมต่อ server ไม่ได้");
    }
}

loadDeviceStatus();
setInterval(loadDeviceStatus, 3000);
