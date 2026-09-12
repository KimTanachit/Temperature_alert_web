require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

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

let currentTemperature = null;
let lastSensorSeen = null;

let dangerThreshold = 100;
let resetThreshold = 100;

let dangerLatched = false;
let lastLineAlert = 0;
let lastDbSave = 0;

const LINE_ALERT_INTERVAL = 30 * 1000; // 30 วินาที

// =====================================================
// LOAD SETTINGS
// =====================================================

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

// =====================================================
// SEND LINE ALERT
// =====================================================

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
    const response = await fetch(
      "https://api.line.me/v2/bot/message/push",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },

        body: JSON.stringify({
          to: process.env.LINE_TO_USER_ID,

          messages: [
            {
              type: "text",
              text: messageText,
            },
          ],
        }),
      }
    );

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

// =====================================================
// SAVE TEMPERATURE
// =====================================================

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

  const { error } = await supabase
    .from("temperature_readings")
    .insert({
      reading_date: readingDate,
      reading_time: readingTime,
      temperature: Number(temp),
      created_at: d.toISOString(),
    });

  if (error) {
    throw error;
  }

  lastDbSave = Date.now();
}

// =====================================================
// SAVE ALERT
// =====================================================

async function saveAlert(temp, lineSent) {
  const { error } = await supabase
    .from("alerts")
    .insert({
      temperature: Number(temp),
      threshold: dangerThreshold,
      line_sent: !!lineSent,
      message: `อุณหภูมิเกิน ${dangerThreshold}°C`,
    });

  if (error) {
    console.error("[DB] alert save error:", error.message);
  }
}

// =====================================================
// PROCESS TEMPERATURE
// =====================================================

async function processTemperature(temp) {
  temp = Number(temp);

  if (!Number.isFinite(temp)) {
    throw new Error("temperature must be a number");
  }

  currentTemperature = temp;
  lastSensorSeen = new Date();

  // ส่งข้อมูลไปหน้าเว็บแบบ Real-time
  io.emit("temperature", {
    temperature: temp,
    timestamp: lastSensorSeen.toISOString(),
  });

  // ===================================================
  // REAL ALERT
  // ===================================================

  if (temp > dangerThreshold) {
    const now = Date.now();

    // แจ้งทันทีครั้งแรก หรือแจ้งซ้ำทุก 30 วินาที
    if (
      !dangerLatched ||
      now - lastLineAlert >= LINE_ALERT_INTERVAL
    ) {
      dangerLatched = true;
      lastLineAlert = now;

      console.log(
        `[ALERT] Temperature ${temp}°C >${dangerThreshold}°C`
      );

      const lineSent = await sendLineAlert(temp);

      await saveAlert(temp, lineSent);

      io.emit("alert", {
        temperature: temp,
        threshold: dangerThreshold,
        line_sent: lineSent,
      });
    }
  }
  // Reset ระบบแจ้งเตือน
  if (temp <= resetThreshold) {
    dangerLatched = false;
    lastLineAlert = 0;
  }

  // ===================================================
  // SAVE DATABASE EVERY 3 MINUTES
  // ===================================================

  if (Date.now() - lastDbSave >= 3 * 60 * 1000) {
    try {
      await saveTemperature(temp, lastSensorSeen);

      console.log("[DB] saved", temp);
    } catch (err) {
      console.error("[DB] save error:", err.message);
    }
  }
}

// =====================================================
// CURRENT TEMPERATURE
// =====================================================

app.get("/api/temperature/current", (req, res) => {
  res.json({
    temperature: currentTemperature,
    last_seen: lastSensorSeen,
  });
});

// =====================================================
// TEMPERATURE HISTORY
// =====================================================

app.get("/api/temperature/history", async (req, res) => {
  const minutes = Math.min(
    Math.max(Number(req.query.minutes || 1440), 1),
    43200
  );

  const since = new Date(
    Date.now() - minutes * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("temperature_readings")
    .select(
      "id, temperature, reading_date, reading_time, created_at"
    )
    .gte("created_at", since)
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    return res.status(500).json({
      error: error.message,
    });
  }

  res.json(
    (data || []).map((r) => ({
      id: r.id,
      temperature: r.temperature,
      recorded_at:
        r.created_at ||
        `${r.reading_date}T${r.reading_time}+07:00`,
    }))
  );
});

// =====================================================
// ALERT HISTORY
// =====================================================

app.get("/api/alerts", async (req, res) => {
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .order("created_at", {
      ascending: false,
    })
    .limit(500);

  if (error) {
    return res.status(500).json({
      error: error.message,
    });
  }

  res.json(data || []);
});

// =====================================================
// SENSOR API
// =====================================================

app.post("/api/sensor/temperature", async (req, res) => {
  if (
    req.headers["x-sensor-api-key"] !==
    process.env.SENSOR_API_KEY
  ) {
    return res.status(401).json({
      error: "Invalid sensor API key",
    });
  }

  try {
    await processTemperature(req.body.temperature);

    // --- ส่วนที่เพิ่มใหม่: อัปเดตสถานะอุปกรณ์ลง Supabase ---
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
    // ---------------------------------------------------------

    res.json({
      ok: true,
      temperature: currentTemperature,
    });
  } catch (err) {
    res.status(400).json({
      error: err.message,
    });
  }
});

// =====================================================
// DEVICE STATUS
// =====================================================

app.get("/api/device/status", async (req, res) => {
  const online =
    lastSensorSeen &&
    Date.now() - lastSensorSeen.getTime() < 15000;

  res.json({
    online: !!online,
    last_seen: lastSensorSeen,
  });
});

// =====================================================
// SETTINGS GET
// =====================================================

app.get("/api/settings", (req, res) => {
  res.json({
    danger_threshold: dangerThreshold,
    reset_threshold: resetThreshold,
  });
});

// =====================================================
// SETTINGS UPDATE
// =====================================================

app.put("/api/settings", async (req, res) => {
  const danger = Number(req.body.danger_threshold);
  const reset = Number(req.body.reset_threshold);

  if (!Number.isFinite(danger) || !Number.isFinite(reset)) {
    return res.status(400).json({
      error: "invalid settings",
    });
  }

  dangerThreshold = danger;
  resetThreshold = reset;

  const { error } = await supabase
    .from("settings")
    .upsert({
      id: 1,
      danger_threshold: danger,
      reset_threshold: reset,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    return res.status(500).json({
      error: error.message,
    });
  }

  res.json({
    ok: true,
    danger_threshold: dangerThreshold,
    reset_threshold: resetThreshold,
  });
});

// =====================================================
// SOCKET.IO
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

// =====================================================
// START SERVER
// =====================================================

(async () => {
  await loadSettings();

  server.listen(PORT, () => {
    console.log(
      `Temperature monitor running on port ${PORT}`
    );
  });
})();