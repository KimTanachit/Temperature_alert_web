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

## 4) Cloud 24/7
Deploy this Node.js app to a cloud service such as Railway, Render, or another Node.js host. Set the same environment variables in the host dashboard. Supabase remains the cloud database, so your PC does not need to stay on.
