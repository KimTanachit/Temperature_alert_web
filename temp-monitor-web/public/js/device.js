async function loadDevice() {
  try {
    const d = await getJSON(API.device);
    const online = !!d.online;
    document.getElementById("deviceOnline").textContent = online ? "ออนไลน์" : "ออฟไลน์";
    document.getElementById("wifi").textContent = online ? "ออนไลน์" : "ออฟไลน์";
    document.getElementById("controller").textContent = online ? "ออนไลน์" : "ออฟไลน์";
    document.getElementById("sensor").textContent = online ? "ออนไลน์" : "ออฟไลน์";
    document.getElementById("lastSeen").textContent = formatDate(d.last_seen);
  } catch(e) { console.error(e); }
}
loadDevice();
setInterval(loadDevice, 2000);
