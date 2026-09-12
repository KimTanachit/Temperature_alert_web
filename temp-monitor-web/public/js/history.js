let allRows = [];
async function loadHistory() {
  try {
    allRows = await getJSON(`${API.history}?minutes=43200`);
    render();
  } catch(e) { console.error(e); }
}
function render() {
  const q = (document.getElementById("search").value || "").toLowerCase();
  const date = document.getElementById("dateFilter").value;
  const rows = allRows.filter(r => {
    const d = new Date(r.recorded_at);
    const okDate = !date || d.toLocaleDateString("en-CA", {timeZone:"Asia/Bangkok"}) === date;
    const text = `${r.temperature} ${r.recorded_at}`.toLowerCase();
    return okDate && text.includes(q);
  });
  const body = document.getElementById("historyBody");
  body.innerHTML = rows.length ? rows.map((r,i)=>`<tr><td>${i+1}</td><td>${formatDate(r.recorded_at)}</td><td><b>${Number(r.temperature).toFixed(1)}</b></td><td><span class="status-pill ${Number(r.temperature)>100?'danger':'normal'}">${Number(r.temperature)>100?'อันตราย':'ปกติ'}</span></td><td>-</td><td>${Number(r.temperature)>100?'อุณหภูมิเกิน 100°C':'-'}</td></tr>`).join("") : `<tr><td colspan="6">ไม่พบข้อมูล</td></tr>`;
}
document.getElementById("search").addEventListener("input", render);
document.getElementById("dateFilter").addEventListener("change", render);
loadHistory();
setInterval(loadHistory, 2000);
