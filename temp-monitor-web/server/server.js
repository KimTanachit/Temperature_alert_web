require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
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

async function saveAlert(temp, lineSent) {
  const { error } = await supabase.from("alerts").insert({
    temperature: Number(temp),
    threshold: dangerThreshold,
    line_sent: !!lineSent,
    message: `อุณหภูมิเกิน ${dangerThreshold}°C`,
  });

  if (error) {
    console.error("[DB] alert save error:", error.message);
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

let servoCommand = {
  x: 0,
  y: 0,
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

// ฟังก์ชันหน่วงเวลา
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ==========================================
// ลูป Auto ทำงานด้วยตัวเอง 100%
// ==========================================
async function startAutoLoop() {
  let currentX = 0; // เริ่มที่ตรงกลาง (0)
  let xDirection = 1; // 1 = หมุนบวก, -1 = หมุนลบ

  // หน่วงเวลาเล็กน้อยก่อนเริ่มลูป เพื่อให้ ESP8266 เชื่อมต่อทันตอนเปิดเซิร์ฟเวอร์
  await sleep(2000); 

  while (true) { 
    // 1. หมุน X ไป 45 องศา
    currentX += (45 * xDirection);

    // ป้องกันชนขอบ (ส่ายซ้าย-ขวา ระหว่าง -90 ถึง 90)
    if (currentX > 90) {
      xDirection = -1;
      currentX = 45; 
    } else if (currentX < -90) {
      xDirection = 1;
      currentX = -45;
    }

    // สเตป 1: แกน X ขยับ, Y ตรงกลาง -> ค้าง 2 วิ
    updateServo(currentX, 0);
    await sleep(2000);

    // สเตป 2: Y ลง 15 องศา -> ค้าง 2 วิ
    updateServo(currentX, -15);
    await sleep(2000);

    // สเตป 3: Y ขึ้นไป 30 องศา (อยู่ที่ +15) -> ค้าง 2 วิ
    updateServo(currentX, 15);
    await sleep(2000);

    // สเตป 4: Y กลับมาตรงกลาง -> ค้าง 2 วิ ก่อนเริ่มรอบใหม่
    updateServo(currentX, 0);
    await sleep(2000);
  }
}

function updateServo(newX, newY) {
  servoCommand = {
    x: newX,
    y: newY,
    updatedAt: Date.now(),
  };
  sendCommandToWaiters(); // ส่งคำสั่งไปให้ ESP8266 ที่รออยู่
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

app.post("/api/sensors", (req, res) => {
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

  res.json({
    ok: true,
    sensors: servoSensors,
    buzzer_config: buzzerSettings.current(),
  });
});

app.get("/api/sensors", (req, res) => {
  res.set("Cache-Control", "no-store").json(servoSensors);
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
