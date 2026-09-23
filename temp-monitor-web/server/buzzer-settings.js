const { randomInt } = require('node:crypto');
const SOURCES = ['ds18b20', 'amg_max', 'amg_center', 'amg_min'];

function validateSettings(body) {
  if (!body || typeof body.enabled !== 'boolean' || !SOURCES.includes(body.source)) return null;
  const { on_c } = body;
  const low = body.source === 'ds18b20' ? -55 : 0;
  const high = body.source === 'ds18b20' ? 125 : 80;
  if (typeof on_c !== 'number' || !Number.isFinite(on_c)) return null;
  const on = Math.round(on_c * 100) / 100;
  if (on < low || on > high) return null;
  return { enabled: body.enabled, source: body.source, on_c: on };
}

function registerBuzzerSettings(app, supabase, requireAdmin) {
  let current = null;
  let saving = false;
  async function load() {
    const { data, error } = await supabase.from('buzzer_settings').select('*').eq('id', 1).single();
    const parsed = validateSettings(data);
    if (error || !parsed || !Number.isInteger(data.revision) || data.revision < 1) {
      console.error('[BUZZER] Settings unavailable; run sql/buzzer-settings.sql first.');
      return false;
    }
    current = { ...parsed, revision: data.revision, stop_revision: data.stop_revision || 0 };
    return true;
  }
  app.get('/api/buzzer/settings', requireAdmin, async (req, res) => {
    try {
      if (!current && !await load()) return res.status(503).json({error: 'ยังอ่านค่าตั้งไม่ได้ กรุณารันไฟล์ SQL และตรวจสอบฐานข้อมูล'});
      res.set('Cache-Control', 'no-store').json(current);
    } catch (error) {
      res.status(503).json({error: 'เชื่อมต่อฐานข้อมูลไม่ได้'});
    }
  });
  app.put('/api/buzzer/settings', requireAdmin, async (req, res) => {
    const parsed = validateSettings(req.body);
    if (!parsed) return res.status(400).json({error: 'อุณหภูมิต้องอยู่ในช่วง DS18B20: -55 ถึง 125°C หรือ AMG8833: 0 ถึง 80°C'});
    if (saving) return res.status(409).json({error: 'กำลังบันทึกค่าตั้ง กรุณาลองอีกครั้ง'});
    saving = true;
    try {
      if (!current && !await load()) return res.status(503).json({error: 'อ่านค่าตั้งเดิมไม่ได้ กรุณาตรวจสอบฐานข้อมูล'});
      let revision;
      do { revision = randomInt(1, 2147483647); } while (revision === current?.revision);
      const next = {...parsed, revision, stop_revision: current.stop_revision};
      const {error} = await supabase.from('buzzer_settings').upsert({id: 1, ...next, updated_at: new Date().toISOString()});
      if (error) return res.status(503).json({error: 'บันทึกไม่สำเร็จ กรุณาตรวจสอบฐานข้อมูลและไฟล์ SQL'});
      current = next;
      res.json(current);
    } catch (error) {
      res.status(503).json({error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่'});
    } finally {
      saving = false;
    }
  });
  app.post('/api/buzzer/stop', requireAdmin, async (req, res) => {
    if (saving) return res.status(409).json({error: 'กำลังบันทึกคำสั่ง กรุณาลองอีกครั้ง'});
    saving = true;
    try {
      if (!current && !await load()) return res.status(503).json({error: 'อ่านค่าตั้งไม่ได้ กรุณาตรวจสอบฐานข้อมูล'});
      let stop_revision;
      do { stop_revision = randomInt(1, 2147483647); } while (stop_revision === current.stop_revision);
      const next = {...current, stop_revision};
      const {error} = await supabase.from('buzzer_settings').upsert({id: 1, ...next, updated_at: new Date().toISOString()});
      if (error) return res.status(503).json({error: 'ส่งคำสั่งหยุดไม่สำเร็จ กรุณาลองใหม่'});
      current = next;
      res.json(current);
    } catch (error) {
      res.status(503).json({error: 'ส่งคำสั่งหยุดไม่สำเร็จ กรุณาลองใหม่'});
    } finally {
      saving = false;
    }
  });
  return {load, current: () => current};
}
module.exports = {registerBuzzerSettings, validateSettings};
