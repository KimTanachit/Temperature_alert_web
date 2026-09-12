let tempChart = null;
let minutes = 1440;

async function loadTemperature() {
  try {
    const rows = await getJSON(`${API.history}?minutes=${minutes}`);
    const vals = rows.map(r => Number(r.temperature));
    document.getElementById("maxTemp").textContent = vals.length ? `${Math.max(...vals).toFixed(1)} °C` : "-- °C";
    document.getElementById("minTemp").textContent = vals.length ? `${Math.min(...vals).toFixed(1)} °C` : "-- °C";
    document.getElementById("avgTemp").textContent = vals.length ? `${(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1)} °C` : "-- °C";
    draw(rows);
  } catch(e) { console.error(e); }
}
function draw(rows) {
  const canvas = document.getElementById("tempChart");
  if (tempChart) tempChart.destroy();
  tempChart = new Chart(canvas, {
    type:"line",
    data:{labels:rows.map(r=>new Date(r.recorded_at).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})),datasets:[{label:"อุณหภูมิ",data:rows.map(r=>Number(r.temperature)),borderWidth:2,tension:.3,fill:true}]},
    options:{responsive:true,maintainAspectRatio:false,scales:{y:{suggestedMin:0,suggestedMax:120}}}
  });
}
document.querySelectorAll(".range-btn").forEach(btn => btn.addEventListener("click",()=>{document.querySelectorAll(".range-btn").forEach(b=>b.classList.remove("active"));btn.classList.add("active");minutes=Number(btn.dataset.minutes);loadTemperature();}));
async function init(){try{const c=await getJSON(API.current);document.getElementById("currentTemp").textContent=`${Number(c.temperature).toFixed(1)} °C`;}catch(e){}await loadTemperature();setInterval(loadTemperature,2000);if(typeof io==="function"){const socket=io();socket.on("temperature",d=>document.getElementById("currentTemp").textContent=`${Number(d.temperature).toFixed(1)} °C`);}}
init();
