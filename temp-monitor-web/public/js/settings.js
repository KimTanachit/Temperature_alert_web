async function loadSettings(){
  try{const s=await getJSON(API.settings);document.getElementById("dangerThreshold").value=s.danger_threshold;document.getElementById("resetThreshold").value=s.reset_threshold;}catch(e){}
}
document.getElementById("saveSettings").addEventListener("click",async()=>{
  const payload={danger_threshold:Number(document.getElementById("dangerThreshold").value),reset_threshold:Number(document.getElementById("resetThreshold").value)};
  try{await getJSON(API.settings,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  alert("บันทึกการตั้งค่าแล้ว");}
  catch(e) {
  alert("บันทึกไม่สำเร็จ: " + e.message);
  console.error("รายละเอียด Error:", e);
}
});
loadSettings();
