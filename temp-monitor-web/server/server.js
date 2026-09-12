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
  console.error("[SUPABASE] กรุณาตั้ง SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

let currentTemperature = null;
let lastSensorSeen = null;
let dangerThreshold = 100;
let resetThreshold = 100;
let dangerLatched = false;
let lastDbSave = 0;

async function loadSettings() {
  const { data, error } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
  if (error) { console.error("[DB] settings error:", error.message); return; }
  if (data) {
    dangerThreshold = Number(data.danger_threshold ?? 100);
    resetThreshold = Number(data.reset_threshold ?? 100);
  }
}

async function sendLineAlert(temp) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_TO_USER_ID) {
    console.log("[LINE] ยังไม่ได้ตั้งค่า LINE API");
    return false;
  }
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      to: process.env.LINE_TO_USER_ID,
      messages: [{
        type: "text",
        text: `🔥 แจ้งเตือนอุณหภูมิสูง!\nอุณหภูมิปัจจุบัน: ${Number(temp).toFixed(1)}°C\nเกินเกณฑ์ ${dangerThreshold}°C`
      }]
    })
  });
  if (!response.ok) {
    console.error("[LINE] ส่งไม่สำเร็จ:", await response.text());
    return false;
  }
  console.log("[LINE] ส่งแจ้งเตือนแล้ว");
  return true;
}

async function saveTemperature(temp, timestamp) {
  const d = new Date(timestamp);
  const thai = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(d).reduce((o,p)=>(o[p.type]=p.value,o),{});
  const readingDate = `${thai.year}-${thai.month}-${thai.day}`;
  const readingTime = `${thai.hour}:${thai.minute}:${thai.second}`;

  const { error } = await supabase.from("temperature_readings").insert({
    reading_date: readingDate,
    reading_time: readingTime,
    temperature: Number(temp),
    created_at: d.toISOString()
  });
  if (error) throw error;
  lastDbSave = Date.now();
}

async function saveAlert(temp, lineSent) {
  const { error } = await supabase.from("alerts").insert({
    temperature: Number(temp),
    threshold: dangerThreshold,
    line_sent: !!lineSent,
    message: `อุณหภูมิเกิน ${dangerThreshold}°C`
  });
  if (error) console.error("[DB] alert save error:", error.message);
}

async function processTemperature(temp) {
  temp = Number(temp);
  if (!Number.isFinite(temp)) throw new Error("temperature must be a number");
  currentTemperature = temp;
  lastSensorSeen = new Date();

  io.emit("temperature", { temperature: temp, timestamp: lastSensorSeen.toISOString() });

  if (temp > dangerThreshold && !dangerLatched) {
    dangerLatched = true;
    const lineSent = await sendLineAlert(temp);
    await saveAlert(temp, lineSent);
    io.emit("alert", { temperature: temp, threshold: dangerThreshold, line_sent: lineSent });
  }

  if (temp <= resetThreshold) dangerLatched = false;

  if (Date.now() - lastDbSave >= 3 * 60 * 1000) {
    try {
      await saveTemperature(temp, lastSensorSeen);
      console.log("[DB] saved", temp);
    } catch (err) {
      console.error("[DB] save error:", err.message);
    }
  }
}

app.get("/api/temperature/current", (req, res) => {
  res.json({ temperature: currentTemperature, last_seen: lastSensorSeen });
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
  res.json((data || []).map(r => ({
    id: r.id,
    temperature: r.temperature,
    recorded_at: r.created_at || `${r.reading_date}T${r.reading_time}+07:00`
  })));
});

app.get("/api/alerts", async (req, res) => {
  const { data, error } = await supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/sensor/temperature", async (req, res) => {
  if (req.headers["x-sensor-api-key"] !== process.env.SENSOR_API_KEY) {
    return res.status(401).json({ error: "Invalid sensor API key" });
  }
  try {
    await processTemperature(req.body.temperature);
    res.json({ ok: true, temperature: currentTemperature });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/device/status", async (req, res) => {
  const online = lastSensorSeen && (Date.now() - lastSensorSeen.getTime() < 15000);
  res.json({ online: !!online, last_seen: lastSensorSeen });
});

app.get("/api/settings", (req, res) => {
  res.json({ danger_threshold: dangerThreshold, reset_threshold: resetThreshold });
});

app.put("/api/settings", async (req, res) => {
  const danger = Number(req.body.danger_threshold);
  const reset = Number(req.body.reset_threshold);
  if (!Number.isFinite(danger) || !Number.isFinite(reset)) {
    return res.status(400).json({ error: "invalid settings" });
  }
  dangerThreshold = danger;
  resetThreshold = reset;
  const { error } = await supabase.from("settings").upsert({
    id: 1, danger_threshold: danger, reset_threshold: reset, updated_at: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, danger_threshold: dangerThreshold, reset_threshold: resetThreshold });
});

io.on("connection", socket => {
  if (currentTemperature !== null) {
    socket.emit("temperature", { temperature: currentTemperature, timestamp: lastSensorSeen?.toISOString() });
  }
});

(async () => {
  await loadSettings();
  server.listen(PORT, () => console.log(`Temperature monitor running on port ${PORT}`));
})();
