const API_URL = "https://temperature-alert-web-1.onrender.com/api/sensor/temperature";
const SENSOR_API_KEY = "my-secret-sensor-key";

let temperature = 70;
let direction = 1;

async function sendTemperature() {
  // ทำให้อุณหภูมิขึ้นลงแบบต่อเนื่อง
  temperature += direction * (Math.random() * 2 + 0.5);

  if (temperature >= 110) {
    direction = -1;
  }

  if (temperature <= 70) {
    direction = 1;
  }

  temperature = Number(temperature.toFixed(2));

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sensor-api-key": SENSOR_API_KEY,
      },
      body: JSON.stringify({
        temperature: temperature,
      }),
    });

    const data = await response.json();

    console.log(
      `[TEST SENSOR] ${new Date().toLocaleTimeString()} → ${temperature}°C`,
      data
    );
  } catch (error) {
    console.error("[TEST SENSOR ERROR]", error.message);
  }
}

console.log("เริ่มจำลอง Sensor...");
sendTemperature();

setInterval(sendTemperature, 2000);