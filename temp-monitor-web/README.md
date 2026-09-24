# Temperature Monitor Web - Supabase version

## 1) Supabase
1. Create a Supabase project.
2. Open SQL Editor and run `sql/database.sql`.
3. The SQL creates `temperature_readings`, `alerts`, `settings`, and `device_status`.
4. The optional final INSERT creates 30 days of sample data at 3-minute intervals.

## 2) Local run (only for development)
Copy `.env.example` to `.env` and fill in:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (backend only; never put this in frontend)
- `SENSOR_API_KEY`
- `API_TOKEN` for UNO Q sensor upload and ESP8266 servo polling
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` if Telegram heat alerts are needed
- LINE variables if needed

Then:
```bash
npm install
npm start
```
Open `http://localhost:3000`.

## 3) Sensor API
POST `/api/sensor/temperature` with header:
`x-sensor-api-key: YOUR_SENSOR_API_KEY`

Body:
```json
{"temperature": 105.5}
```

The backend sends realtime data through Socket.IO, checks the 100°C threshold, optionally sends LINE, and saves to Supabase at most once every 3 minutes.

## 4) Thermal scanner flow
- UNO Q posts AMG8833, DS18B20, and buzzer status to `POST /api/sensors` every 1 second with `token: API_TOKEN`.
- The backend averages valid DS18B20 samples for `DS_AVERAGE_INTERVAL_MS` (default 180 seconds) and saves one averaged row to Supabase.
- ESP8266 polls `GET /api/command/long?token=API_TOKEN&since=...` to receive the current servo direction.
- The server scans 8 directions. Each direction has `angle`, `x`, `y`, `direction_index`, and `mode`.
- If `HEAT_LOCK_SOURCE` (default `amg_max_temp_c`) reaches `HEAT_LOCK_THRESHOLD`, scanning locks at that direction.
- If Telegram env vars are set, the server sends an AMG8833 SVG heat snapshot to Telegram when it locks.
- Scanning resumes when the heat value falls to `HEAT_UNLOCK_THRESHOLD`.

## 5) Cloud 24/7
Deploy this Node.js app to a cloud service such as Railway, Render, or another Node.js host. Set the same environment variables in the host dashboard. Supabase remains the cloud database, so your PC does not need to stay on.
