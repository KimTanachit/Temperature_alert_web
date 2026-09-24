require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const zlib = require("zlib");
const session = require("express-session");
const { createClient } = require("@supabase/supabase-js");
const { Server } = require("socket.io");
const { registerBuzzerSettings } = require("./buzzer-settings");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const ESP32_API_TOKEN = process.env.ESP32_API_TOKEN ||"SensorT22";

// รองรับ Reverse Proxy บน Render เพื่อให้ Cookie ทำงานได้ถูกต้อง
app.set("trust proxy", 1);

// Middleware อ่าน Body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ตั้งค่า Session
app.use(
  session({
    secret: process.env.SESSION_SECRET || "temp-alert-secret-key-12345",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // อยู่ได้ 1 วัน
      secure: false, // ถ้าใช้ HTTPS แล้วติดปัญหา session หลุดสามารถเปิดเป็น true หรือปล่อย false ในโหมดปกติ
    },
  })
);

// Middleware ตรวจสอบสิทธิ์ Admin
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(403).send("Forbidden: เฉพาะ Admin เท่านั้นที่เข้าถึงได้");
}

// =====================================================
// AUTH API (ระบบตรวจสอบสิทธิ์ Admin)
// =====================================================

app.get("/api/auth/status", (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  // ตั้ง User: admin / Password: admin1234
  if (username === "admin" && password === "admin1234") {
    req.session.isAdmin = true;
    return res.json({ success: true, message: "เข้าสู่ระบบสำเร็จ" });
  }
  return res.status(401).json({ success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false });
    res.clearCookie("connect.sid");
    return res.json({ success: true, message: "ออกจากระบบสำเร็จ" });
  });
});

// Send visitors to login before serving the thermal camera page.
function requireThermalLogin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.redirect("/login.html?next=%2Fservocontrol.html");
}

app.get("/servocontrol.html", requireThermalLogin);
app.get("/settings.html", requireAdmin, (req, res, next) => {
  next();
});

// เสิร์ฟโฟลเดอร์ Public (ต้องอยู่หลังบล็อกหน้า HTML)
app.use(express.static(path.join(__dirname, "..", "public")));

// =====================================================
// SUPABASE
// =====================================================

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[SUPABASE] กรุณาตั้ง SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env"
  );
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

const buzzerSettings = registerBuzzerSettings(app, supabase, requireAdmin);

let currentTemperature = null;
let lastSensorSeen = null;

let dangerThreshold = 100;
let resetThreshold = 100;

let dangerLatched = false;
let lastLineAlert = 0;
let lastDbSave = 0;

const LINE_ALERT_INTERVAL = 30 * 1000;
const DS_AVERAGE_INTERVAL_MS = Number(process.env.DS_AVERAGE_INTERVAL_MS || 180000);
const SCAN_STEP_MS = Number(process.env.SCAN_STEP_MS || 3000);
const HEAT_LOCK_SOURCE = process.env.HEAT_LOCK_SOURCE || "amg_max_temp_c";
const HEAT_LOCK_THRESHOLD = Number(process.env.HEAT_LOCK_THRESHOLD || NaN);
const HEAT_UNLOCK_THRESHOLD = Number(process.env.HEAT_UNLOCK_THRESHOLD || NaN);

let dsAverageWindowStartedAt = 0;
let dsAverageSum = 0;
let dsAverageCount = 0;
let dsAverageSeq = 0;

async function loadSettings() {
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("[DB] settings error:", error.message);
    return;
  }

  if (data) {
    dangerThreshold = Number(data.danger_threshold ?? 100);
    resetThreshold = Number(data.reset_threshold ?? 100);

    console.log(
      `[SETTINGS] danger=${dangerThreshold}, reset=${resetThreshold}`
    );
  }
}

async function sendLineAlert(temp, testRound = null) {
  if (
    !process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    !process.env.LINE_TO_USER_ID
  ) {
    console.log(
      "[LINE] ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_TO_USER_ID"
    );
    return false;
  }

  let messageText;
  if (testRound !== null) {
    messageText =
      `🧪 ทดสอบแจ้งเตือนครั้งที่ ${testRound}/10\n` +
      `🔥 อุณหภูมิ: ${Number(temp).toFixed(1)}°C\n` +
      `เกินเกณฑ์ ${dangerThreshold}°C`;
  } else {
    messageText =
      `🔥 แจ้งเตือนอุณหภูมิสูง!\n` +
      `อุณหภูมิปัจจุบัน: ${Number(temp).toFixed(1)}°C\n` +
      `เกินเกณฑ์ ${dangerThreshold}°C`;
  }

  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: process.env.LINE_TO_USER_ID,
        messages: [{ type: "text", text: messageText }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[LINE] ส่งไม่สำเร็จ:", errorText);
      return false;
    }

    console.log(
      testRound !== null
        ? `[LINE TEST] ส่งครั้งที่ ${testRound}/10 สำเร็จ`
        : "[LINE] ส่งแจ้งเตือนแล้ว"
    );
    return true;
  } catch (error) {
    console.error("[LINE] connection error:", error.message);
    return false;
  }
}

async function saveTemperature(temp, timestamp) {
  const d = new Date(timestamp);
  const thai = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(d)
    .reduce((o, p) => {
      o[p.type] = p.value;
      return o;
    }, {});

  const readingDate = `${thai.year}-${thai.month}-${thai.day}`;
  const readingTime = `${thai.hour}:${thai.minute}:${thai.second}`;

  const { error } = await supabase.from("temperature_readings").insert({
    reading_date: readingDate,
    reading_time: readingTime,
    temperature: Number(temp),
    created_at: d.toISOString(),
  });

  if (error) throw error;
  lastDbSave = Date.now();
}

async function saveAlert(temp, lineSent, threshold = dangerThreshold, message = `อุณหภูมิเกิน ${threshold}°C`) {
  const { error } = await supabase.from("alerts").insert({
    temperature: Number(temp),
    threshold,
    line_sent: !!lineSent,
    message,
  });

  if (error) {
    console.error("[DB] alert save error:", error.message);
  }
}

function thermalColor(value, min, max) {
  const span = max > min ? max - min : 1;
  const t = Math.max(0, Math.min(1, (Number(value) - min) / span));
  if (t < 0.25) {
    const k = t / 0.25;
    return `rgb(0,${Math.round(80 * k)},255)`;
  }
  if (t < 0.5) {
    const k = (t - 0.25) / 0.25;
    return `rgb(${Math.round(255 * k)},${Math.round(80 + 120 * k)},${Math.round(255 * (1 - k))})`;
  }
  if (t < 0.75) {
    const k = (t - 0.5) / 0.25;
    return `rgb(255,${Math.round(200 * (1 - k))},0)`;
  }
  const k = (t - 0.75) / 0.25;
  return `rgb(255,${Math.round(255 * k)},${Math.round(255 * k)})`;
}

function buildThermalSvg(sensorData) {
  const pixels = Array.isArray(sensorData.amg_pixels) ? sensorData.amg_pixels.map(Number) : [];
  if (pixels.length !== 64 || pixels.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const min = Math.min(...pixels);
  const max = Math.max(...pixels);
  const cells = pixels.map((value, index) => {
    const x = (index % 8) * 64;
    const y = Math.floor(index / 8) * 64;
    return `<rect x="${x}" y="${y}" width="64" height="64" fill="${thermalColor(value, min, max)}"/>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="560" viewBox="0 0 512 560">
  <rect width="512" height="560" fill="#0b1220"/>
  <g>${cells}</g>
  <g fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1">
    ${Array.from({ length: 9 }, (_, i) => `<path d="M${i * 64} 0V512"/><path d="M0 ${i * 64}H512"/>`).join("")}
  </g>
  <text x="20" y="542" fill="#e2e8f0" font-size="24" font-family="Arial">AMG8833 min ${min.toFixed(2)} C / max ${max.toFixed(2)} C</text>
</svg>`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePngRgba(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rawRow = y * (width * 4 + 1);
    const rgbaRow = y * width * 4;
    raw[rawRow] = 0;
    rgba.copy(raw, rawRow + 1, rgbaRow, rgbaRow + width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function parseRgb(color) {
  const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getThermalPixelBilinear(pixels, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, 7);
  const y1 = Math.min(y0 + 1, 7);
  const tx = x - x0;
  const ty = y - y0;
  const p00 = Number(pixels[y0 * 8 + x0]);
  const p10 = Number(pixels[y0 * 8 + x1]);
  const p01 = Number(pixels[y1 * 8 + x0]);
  const p11 = Number(pixels[y1 * 8 + x1]);
  return lerp(lerp(p00, p10, tx), lerp(p01, p11, tx), ty);
}

function buildThermalPng(sensorData) {
  const pixels = Array.isArray(sensorData.amg_pixels) ? sensorData.amg_pixels.map(Number) : [];
  if (pixels.length !== 64 || pixels.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const width = 512;
  const height = 512;
  const border = 10;
  const radius = 12;
  const inner = width - border * 2;
  const min = Math.min(...pixels);
  const max = Math.max(...pixels);
  const rgba = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      let r = 10;
      let g = 18;
      let b = 32;
      let a = 255;

      const inPanel = x >= border && x < width - border && y >= border && y < height - border;
      const nearCornerX = x < border + radius ? border + radius - x : x >= width - border - radius ? x - (width - border - radius - 1) : 0;
      const nearCornerY = y < border + radius ? border + radius - y : y >= height - border - radius ? y - (height - border - radius - 1) : 0;
      const outsideRoundCorner = nearCornerX > 0 && nearCornerY > 0 && nearCornerX * nearCornerX + nearCornerY * nearCornerY > radius * radius;

      if (inPanel && !outsideRoundCorner) {
        const gx = ((x - border) / (inner - 1)) * 7;
        const gy = ((y - border) / (inner - 1)) * 7;
        const temp = getThermalPixelBilinear(pixels, gx, gy);
        [r, g, b] = parseRgb(thermalColor(temp, min, max));
      }

      rgba[index] = r;
      rgba[index + 1] = g;
      rgba[index + 2] = b;
      rgba[index + 3] = a;
    }
  }

  return encodePngRgba(width, height, rgba);
}

async function sendTelegramThermalAlert(sensorData, scanState) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[TELEGRAM] ยังไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID");
    return false;
  }

  const maxTemp = Number(sensorData.amg_max_temp_c);
  const centerTemp = Number(sensorData.amg_center_temp_c);
  const dsTemp = Number(sensorData.ds18b20_temp_c);
  const direction = scanState.currentDirection;
  const caption = [
    "ตรวจพบความร้อนจาก AMG8833",
    `ทิศที่พบ: ${direction.label} (${direction.angle} องศา)`,
    Number.isFinite(maxTemp) ? `AMG สูงสุด: ${maxTemp.toFixed(2)} C` : null,
    Number.isFinite(centerTemp) ? `AMG กึ่งกลาง: ${centerTemp.toFixed(2)} C` : null,
    Number.isFinite(dsTemp) ? `DS18B20: ${dsTemp.toFixed(2)} C` : null,
    `เกณฑ์ lock: ${scanState.lockThreshold.toFixed(2)} C`,
  ].filter(Boolean).join("\n");

  const png = buildThermalPng(sensorData);
  try {
    if (png && typeof FormData !== "undefined" && typeof Blob !== "undefined") {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", caption);
      form.append("photo", new Blob([png], { type: "image/png" }), "amg8833-thermal.png");
      const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        console.error("[TELEGRAM] ส่งรูป PNG ไม่สำเร็จ:", await response.text());
        return false;
      }
      console.log("[TELEGRAM] ส่งรูป PNG AMG8833 แล้ว");
      return true;
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: caption }),
    });
    if (!response.ok) {
      console.error("[TELEGRAM] ส่งข้อความไม่สำเร็จ:", await response.text());
      return false;
    }
    console.log("[TELEGRAM] ส่งข้อความแจ้งเตือนแล้ว");
    return true;
  } catch (error) {
    console.error("[TELEGRAM] connection error:", error.message);
    return false;
  }
}

async function processTemperature(temp) {
  temp = Number(temp);
  if (!Number.isFinite(temp)) {
    throw new Error("temperature must be a number");
  }

  currentTemperature = temp;
  lastSensorSeen = new Date();

  io.emit("temperature", {
    temperature: temp,
    timestamp: lastSensorSeen.toISOString(),
  });

  if (temp > dangerThreshold) {
    const now = Date.now();
    if (!dangerLatched || now - lastLineAlert >= LINE_ALERT_INTERVAL) {
      dangerLatched = true;
      lastLineAlert = now;

      console.log(`[ALERT] Temperature ${temp}°C >${dangerThreshold}°C`);
      const lineSent = await sendLineAlert(temp);
      await saveAlert(temp, lineSent);

      io.emit("alert", {
        temperature: temp,
        threshold: dangerThreshold,
        line_sent: lineSent,
      });
    }
  }

  if (temp <= resetThreshold) {
    dangerLatched = false;
    lastLineAlert = 0;
  }

}

// =====================================================
// API ROUTES
// =====================================================
// =====================================================
// ESP32 REALTIME
// รับค่าทุกประมาณ 3 วินาที
// ไม่บันทึกลง Supabase
// =====================================================
app.post("/api/realtime", async (req, res) => {

  try {

    // =================================================
    // AUTH
    // =================================================

    const auth =
      req.headers.authorization || "";

    if (
      auth !==
      `Bearer ${ESP32_API_TOKEN}`
    ) {

      return res.status(401).json({
        ok: false,
        error: "Invalid ESP32 API token",
      });
    }


    // =================================================
    // READ DATA
    // =================================================

    const temperature =
      Number(
        req.body.temperature_c
      );

    const deviceId =
      req.body.device_id ||
      "ESP32_NODE_02";


    // =================================================
    // VALIDATE
    // =================================================

    if (
      !Number.isFinite(
        temperature
      )
    ) {

      return res.status(400).json({
        ok: false,
        error:
          "temperature_c must be a number",
      });
    }


    // =================================================
    // PROCESS REALTIME
    // =================================================

    await processTemperature(
      temperature
    );


    // =================================================
    // UPDATE DEVICE STATUS
    // =================================================

    const {
      error: deviceError
    } =
      await supabase
        .from("device_status")
        .update({

          last_seen:
            lastSensorSeen.toISOString(),

          sensor_status: true,

          wifi_status: true,

        })
        .eq("id", 1);


    if (deviceError) {

      console.error(
        "[DB] device status error:",
        deviceError.message
      );
    }


    // =================================================
    // LOG
    // =================================================

    console.log(
      `[REALTIME] ${deviceId}: ${temperature.toFixed(2)}°C`
    );


    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({

      ok: true,

      device_id:
        deviceId,

      temperature_c:
        temperature,

      timestamp:
        lastSensorSeen.toISOString(),

    });

  } catch (err) {

    console.error(
      "[REALTIME] error:",
      err.message
    );

    return res.status(500).json({

      ok: false,

      error:
        err.message,

    });
  }
});

app.get("/api/realtime", (req, res) => {
  res.json({
    ok: true,
    temperature: currentTemperature,
    last_seen: lastSensorSeen,
  });
});
// =====================================================
// ESP32 AVERAGE
// รับค่าเฉลี่ยทุก 3 นาที
// บันทึกลง Supabase
// =====================================================
app.post("/api/average", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";

    if (auth !== `Bearer ${ESP32_API_TOKEN}`) {
      return res.status(401).json({
        error: "Invalid ESP32 API token"
      });
    }

    const temperature = Number(req.body.temperature_c);
    const deviceId = req.body.device_id || "ESP32_NODE_02";
    const seq = Number(req.body.seq);

    if (!Number.isFinite(temperature)) {
      return res.status(400).json({
        error: "temperature_c must be a number"
      });
    }

    if (!Number.isInteger(seq)) {
      return res.status(400).json({
        error: "seq must be an integer"
      });
    }

    const timestamp = new Date();

    // บันทึกค่าเฉลี่ยลง Supabase
    await saveTemperature(
      temperature,
      timestamp
    );

    console.log(
      `[AVERAGE] ${deviceId} | ${temperature.toFixed(2)}°C | SEQ=${seq}`
    );

    return res.status(201).json({
      ok: true,
      device_id: deviceId,
      temperature_c: temperature,
      seq: seq,
      saved_at: timestamp.toISOString()
    });

  } catch (err) {

    console.error(
      "[AVERAGE] save error:",
      err.message
    );

    return res.status(500).json({
      error: err.message
    });
  }
});

app.get("/api/temperature/current", (req, res) => {
  res.json({
    temperature: currentTemperature,
    last_seen: lastSensorSeen,
  });
});

app.get("/api/temperature/history", async (req, res) => {
  const minutes = Math.min(Math.max(Number(req.query.minutes || 1440), 1), 43200);
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("temperature_readings")
    .select("id, temperature, reading_date, reading_time, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  res.json(
    (data || []).map((r) => ({
      id: r.id,
      temperature: r.temperature,
      recorded_at: r.created_at || `${r.reading_date}T${r.reading_time}+07:00`,
    }))
  );
});

app.get("/api/alerts", async (req, res) => {
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/sensor/temperature", async (req, res) => {
  if (req.headers["x-sensor-api-key"] !== process.env.SENSOR_API_KEY) {
    return res.status(401).json({ error: "Invalid sensor API key" });
  }

  try {
    await processTemperature(req.body.temperature);

    const { error: deviceError } = await supabase
      .from("device_status")
      .update({
        last_seen: new Date().toISOString(),
        sensor_status: true,
        wifi_status: true,
      })
      .eq("id", 1);

    if (deviceError) {
      console.error("[DB] device status error:", deviceError.message);
    }

    res.json({ ok: true, temperature: currentTemperature });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/device/status", async (req, res) => {
  const servoLastSeen = servoSensors?.updatedAt
    ? new Date(Number(servoSensors.updatedAt))
    : null;
  const tempLastSeen = lastSensorSeen || null;

  const latestSeen =
    servoLastSeen && tempLastSeen
      ? new Date(Math.max(servoLastSeen.getTime(), tempLastSeen.getTime()))
      : servoLastSeen || tempLastSeen;

  const isOnline = latestSeen && Date.now() - latestSeen.getTime() < 15000;

  res.json({
    online: !!isOnline,
    wifi_status: !!isOnline,
    controller_online: !!isOnline,
    sensor_status: !!isOnline && Number(servoSensors.sensor_status) > 0,
    last_seen: latestSeen ? latestSeen.toISOString() : null,
    servo: {
      ...servoSensors,
      online: !!isOnline,
    },
  });
});

app.get("/api/settings", (req, res) => {
  res.json({
    danger_threshold: dangerThreshold,
    reset_threshold: resetThreshold,
  });
});

// บังคับเฉพาะ Admin เท่านั้นที่เปลี่ยนค่า settings ได้
app.put("/api/settings", requireAdmin, async (req, res) => {
  const danger = Number(req.body.danger_threshold);
  const reset = Number(req.body.reset_threshold);

  if (!Number.isFinite(danger) || !Number.isFinite(reset)) {
    return res.status(400).json({ error: "invalid settings" });
  }

  dangerThreshold = danger;
  resetThreshold = reset;

  const { error } = await supabase.from("settings").upsert({
    id: 1,
    danger_threshold: danger,
    reset_threshold: reset,
    updated_at: new Date().toISOString(),
  });

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    ok: true,
    danger_threshold: dangerThreshold,
    reset_threshold: resetThreshold,
  });
});

// =====================================================
// SERVO LONG POLLING
// =====================================================

const SCAN_DIRECTIONS = [
  { angle: 0, x: 0, y: 1, label: "หน้า" },
  { angle: 45, x: 1, y: 1, label: "หน้า-ขวา" },
  { angle: 90, x: 1, y: 0, label: "ขวา" },
  { angle: 135, x: 1, y: -1, label: "หลัง-ขวา" },
  { angle: 180, x: 0, y: -1, label: "หลัง" },
  { angle: 225, x: -1, y: -1, label: "หลัง-ซ้าย" },
  { angle: 270, x: -1, y: 0, label: "ซ้าย" },
  { angle: 315, x: -1, y: 1, label: "หน้า-ซ้าย" },
];

const scanState = {
  directionIndex: 0,
  mode: "scanning",
  locked: false,
  lockedAt: null,
  lockedTemperature: null,
  telegramSentForLock: false,
  lockThreshold: Number.isFinite(HEAT_LOCK_THRESHOLD) ? HEAT_LOCK_THRESHOLD : dangerThreshold,
  unlockThreshold: Number.isFinite(HEAT_UNLOCK_THRESHOLD) ? HEAT_UNLOCK_THRESHOLD : resetThreshold,
  currentDirection: SCAN_DIRECTIONS[0],
};

let servoCommand = {
  ...SCAN_DIRECTIONS[0],
  direction_index: 0,
  mode: "scanning",
  locked: false,
  updatedAt: Date.now(),
};

// Latest sensor upload from the board, read by Thermal Monitor.
let servoSensors = {
  distance_mm: -1,
  object_temp_c: null,
  ambient_temp_c: null,
  room_temp_c: null,
  ds18b20_temp_c: null,
  ds18b20_status: 0,
  amg_status: 0,
  amg_min_temp_c: null,
  amg_max_temp_c: null,
  amg_center_temp_c: null,
  amg_pixels: [],
  buzzer_status: -1,
  buzzer_config_version: 0,
  buzzer_input_status: 0,
  buzzer_stop_version: 0,
  buzzer_muted: 0,
  sensor_status: 0,
  sensor_text: "waiting for board",
  mlx_address: -1,
  updatedAt: 0,
};

let servoWaiters = [];
const SERVO_API_TOKEN = process.env.API_TOKEN || "servo-god-1234";

function sendCommandToWaiters() {
  const waiters = servoWaiters;
  servoWaiters = [];
  waiters.forEach((res) => {
    res.json(servoCommand);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function updateServo(directionIndex, mode = scanState.mode) {
  const direction = SCAN_DIRECTIONS[directionIndex % SCAN_DIRECTIONS.length];
  scanState.directionIndex = directionIndex % SCAN_DIRECTIONS.length;
  scanState.currentDirection = direction;
  scanState.mode = mode;

  servoCommand = {
    ...direction,
    direction_index: scanState.directionIndex,
    mode,
    locked: scanState.locked,
    updatedAt: Date.now(),
  };
  sendCommandToWaiters();
}

function getHeatValue(sensorData) {
  const value = Number(sensorData?.[HEAT_LOCK_SOURCE]);
  return Number.isFinite(value) ? value : null;
}

async function handleHeatTracking(sensorData) {
  scanState.lockThreshold = Number.isFinite(HEAT_LOCK_THRESHOLD) ? HEAT_LOCK_THRESHOLD : dangerThreshold;
  scanState.unlockThreshold = Number.isFinite(HEAT_UNLOCK_THRESHOLD) ? HEAT_UNLOCK_THRESHOLD : resetThreshold;

  if (Number(sensorData.amg_status) !== 1) return;
  const heatValue = getHeatValue(sensorData);
  if (heatValue === null) return;

  if (!scanState.locked && heatValue >= scanState.lockThreshold) {
    scanState.locked = true;
    scanState.mode = "locked";
    scanState.lockedAt = new Date().toISOString();
    scanState.lockedTemperature = heatValue;
    scanState.telegramSentForLock = false;
    updateServo(scanState.directionIndex, "locked");
    console.log(
      `[SCAN] LOCK ${scanState.currentDirection.label} (${scanState.currentDirection.angle}°) heat=${heatValue.toFixed(2)}°C`
    );

    const telegramSent = await sendTelegramThermalAlert(sensorData, scanState);
    scanState.telegramSentForLock = telegramSent;
    await saveAlert(
      heatValue,
      telegramSent,
      scanState.lockThreshold,
      `Thermal lock ${scanState.currentDirection.label} (${scanState.currentDirection.angle} องศา)`
    );
    io.emit("thermal-lock", {
      temperature: heatValue,
      direction: scanState.currentDirection,
      telegram_sent: telegramSent,
    });
    return;
  }

  if (scanState.locked && heatValue <= scanState.unlockThreshold) {
    console.log(
      `[SCAN] UNLOCK heat=${heatValue.toFixed(2)}°C <= ${scanState.unlockThreshold.toFixed(2)}°C`
    );
    scanState.locked = false;
    scanState.mode = "scanning";
    scanState.lockedAt = null;
    scanState.lockedTemperature = null;
    scanState.telegramSentForLock = false;
  }
}

async function startAutoLoop() {
  await sleep(2000);

  while (true) {
    if (!scanState.locked) {
      const nextDirection = (scanState.directionIndex + 1) % SCAN_DIRECTIONS.length;
      updateServo(nextDirection, "scanning");
    }
    await sleep(SCAN_STEP_MS);
  }
}

// สั่งให้ลูปทำงานทันทีที่รัน server.js
startAutoLoop();

// ==========================================
// API สำหรับ ESP8266 (มารับคำสั่ง และ ส่งค่าเซ็นเซอร์)
// ==========================================

// ESP8266 จะมาดึงค่าจาก API นี้ (Long Polling)
app.get("/api/command/long", (req, res) => {
  if (req.query.token !== SERVO_API_TOKEN) {
    return res.status(401).json({ error: "bad token" });
  }

  const since = Number(req.query.since || 0);

  if (servoCommand.updatedAt > since) {
    return res.json(servoCommand);
  }

  const timeout = setTimeout(() => {
    servoWaiters = servoWaiters.filter((waiter) => waiter !== res);
    res.json(servoCommand);
  }, 25000);

  res.on("close", () => {
    clearTimeout(timeout);
    servoWaiters = servoWaiters.filter((waiter) => waiter !== res);
  });

  servoWaiters.push(res);
});

// ดึงคำสั่งแบบธรรมดา (ถ้าใช้)
app.get("/api/command", (req, res) => {
  if (req.query.token !== SERVO_API_TOKEN) {
    return res.status(401).json({ error: "bad token" });
  }
  res.json(servoCommand);
});

async function recordDS18B20Sample(sensorData) {
  const dsStatus = Number(sensorData.ds18b20_status);
  const temperature = Number(sensorData.ds18b20_temp_c ?? sensorData.room_temp_c);
  if (dsStatus !== 1 || !Number.isFinite(temperature)) return null;

  currentTemperature = temperature;
  lastSensorSeen = new Date();
  io.emit("temperature", {
    temperature,
    timestamp: lastSensorSeen.toISOString(),
  });

  if (!dsAverageWindowStartedAt) {
    dsAverageWindowStartedAt = Date.now();
  }

  dsAverageSum += temperature;
  dsAverageCount += 1;

  if (Date.now() - dsAverageWindowStartedAt < DS_AVERAGE_INTERVAL_MS) {
    return null;
  }

  const average = dsAverageSum / dsAverageCount;
  const count = dsAverageCount;
  const startedAt = new Date(dsAverageWindowStartedAt).toISOString();
  const endedAt = new Date();
  dsAverageSeq += 1;

  dsAverageWindowStartedAt = Date.now();
  dsAverageSum = 0;
  dsAverageCount = 0;

  await saveTemperature(average, endedAt);
  console.log(
    `[DS18B20 AVERAGE] ${average.toFixed(2)}°C from ${count} sample(s), seq=${dsAverageSeq}`
  );

  return {
    seq: dsAverageSeq,
    temperature_c: Number(average.toFixed(2)),
    sample_count: count,
    started_at: startedAt,
    saved_at: endedAt.toISOString(),
  };
}

app.post("/api/sensors", async (req, res) => {
  if (req.body.token !== SERVO_API_TOKEN) {
    return res.status(401).json({ error: "bad token" });
  }

  servoSensors = {
    distance_mm: Number(req.body.distance_mm ?? -1),
    object_temp_c: req.body.object_temp_c ?? null,
    ambient_temp_c: req.body.ambient_temp_c ?? null,
    room_temp_c: req.body.room_temp_c ?? null,
    ds18b20_temp_c: req.body.ds18b20_temp_c ?? null,
    ds18b20_status: Number(req.body.ds18b20_status ?? 0),
    amg_status: Number(req.body.amg_status ?? 0),
    amg_min_temp_c: req.body.amg_min_temp_c ?? null,
    amg_max_temp_c: req.body.amg_max_temp_c ?? null,
    amg_center_temp_c: req.body.amg_center_temp_c ?? null,
    amg_pixels: Array.isArray(req.body.amg_pixels) ? req.body.amg_pixels : [],
    buzzer_status: Number(req.body.buzzer_status ?? -1),
    buzzer_config_version: Number(req.body.buzzer_config_version ?? 0),
    buzzer_input_status: Number(req.body.buzzer_input_status ?? 0),
    buzzer_stop_version: Number(req.body.buzzer_stop_version ?? 0),
    buzzer_muted: Number(req.body.buzzer_muted ?? 0),
    sensor_status: Number(req.body.sensor_status ?? 0),
    sensor_text: req.body.sensor_text || "unknown",
    mlx_address: Number(req.body.mlx_address ?? -1),
    updatedAt: Date.now(),
  };

  try {
    const average_saved = await recordDS18B20Sample(servoSensors);
    await handleHeatTracking(servoSensors);

    res.json({
      ok: true,
      sensors: servoSensors,
      scan: scanState,
      command: servoCommand,
      average_saved,
      buzzer_config: buzzerSettings.current(),
    });
  } catch (error) {
    console.error("[SENSORS] error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sensors", (req, res) => {
  res.set("Cache-Control", "no-store").json(servoSensors);
});

app.get("/api/scan/status", (req, res) => {
  res.set("Cache-Control", "no-store").json({
    ...scanState,
    command: servoCommand,
    directions: SCAN_DIRECTIONS,
    heat_source: HEAT_LOCK_SOURCE,
  });
});

app.post("/api/telegram/test", requireAdmin, async (req, res) => {
  if (Number(servoSensors.amg_status) !== 1) {
    return res.status(400).json({
      ok: false,
      error: "ยังไม่มีข้อมูล AMG8833 ล่าสุดสำหรับส่งทดสอบ",
    });
  }

  const sent = await sendTelegramThermalAlert(servoSensors, scanState);
  res.json({
    ok: sent,
    telegram_sent: sent,
    direction: scanState.currentDirection,
  });
});

// =====================================================
// SOCKET.IO & SERVER LISTEN
// =====================================================

io.on("connection", (socket) => {
  console.log("[SOCKET] client connected");

  if (currentTemperature !== null) {
    socket.emit("temperature", {
      temperature: currentTemperature,
      timestamp: lastSensorSeen?.toISOString(),
    });
  }

  socket.on("disconnect", () => {
    console.log("[SOCKET] client disconnected");
  });
});

(async () => {
  await loadSettings();
  await buzzerSettings.load();

  server.listen(PORT, () => {
    console.log(`Temperature monitor running on port ${PORT}`);
  });
})();
