/**
 * FINDER — Google Apps Script (รวม 2 หน้าที่ในไฟล์เดียว)
 *   1) doGet  = ส่งข้อมูลจาก Sheet เป็น JSON ให้ web app — เฉพาะคนที่ login LINE และเป็นสมาชิกกลุ่ม
 *   2) doPost = Webhook ของ LINE บอท: พิมพ์ "ค้นหา" ในกลุ่ม → ตอบการ์ดปุ่มเปิด web app
 *
 * วิธีใช้: เอาโค้ดนี้ไปวางแทนของเดิมใน Apps Script แล้ว Deploy เวอร์ชันใหม่
 * (Manage deployments → Edit → New version → Deploy) — URL /exec เดิมจะทำได้ทั้งสองอย่าง
 */

// ====== ตั้งค่า ======
var LINE_TOKEN = 'วาง Channel access token ที่นี่';          // จาก Messaging API channel
var LIFF_ID    = '2011726514-IlkDrkPZ';                      // ค่าเดียวกับในเว็บ
var APP_URL    = 'https://liff.line.me/' + LIFF_ID;           // ปุ่มในกลุ่มเปิดผ่าน LIFF เพื่อให้ login LINE ได้
var GROUP_ID   = '';  // ไม่ต้องกรอก! บอทบันทึก Group ID ของ "กลุ่มแรก" ที่มีคนพิมพ์ให้เอง (ดู saveGroupId)
// Channel ID ของ LINE Login channel ที่สร้าง LIFF — ปกติคือเลขหน้าขีดของ LIFF ID
var LOGIN_CHANNEL_ID = LIFF_ID.split('-')[0];
// userId ที่อนุญาตเพิ่มเติมแม้ไม่ได้อยู่ในกลุ่ม (เช่นแอดมิน) คั่นด้วย , — ปกติว่างไว้
var EXTRA_USER_IDS = '';

// ====== 1) ส่งข้อมูลให้ web app — ต้องยืนยันตัวตนก่อน ======
function doGet(e) {
  var idToken = (e && e.parameter && e.parameter.idToken) || '';
  var auth = authorize(idToken);
  if (!auth.ok) return json({ error: auth.error, message: auth.message });

  var sheet = getDataSheet();
  var rows = sheet.getDataRange().getValues();
  var headers = rows.shift();
  var data = rows
    .filter(function (r) { return r.join('').trim() !== ''; })
    .map(function (r) {
      var o = {};
      headers.forEach(function (h, i) {
        var v = r[i];
        if (v instanceof Date) {
          var d = ('0' + v.getDate()).slice(-2);
          var m = ('0' + (v.getMonth() + 1)).slice(-2);
          var y = v.getFullYear() + 543;
          v = d + '/' + m + '/' + y;
        }
        o[String(h).trim()] = v;
      });
      return o;
    });
  return json(data);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ตรวจ ID token จาก LIFF แล้วเช็กว่า userId เป็นสมาชิกกลุ่ม
function authorize(idToken) {
  if (!idToken) return { ok: false, error: 'unauthorized', message: 'กรุณาเปิดผ่านปุ่มในกลุ่ม LINE' };

  var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: LOGIN_CHANNEL_ID },
    muteHttpExceptions: true
  });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (err) {}
  if (res.getResponseCode() !== 200 || !body.sub) {
    var desc = String(body.error_description || '');
    if (desc.indexOf('expired') !== -1) return { ok: false, error: 'token_expired', message: 'เซสชัน LINE หมดอายุ' };
    Logger.log('verify failed: ' + res.getContentText());
    return { ok: false, error: 'invalid_token', message: 'ยืนยันตัวตน LINE ไม่สำเร็จ' };
  }

  var userId = body.sub;
  if (isMember(userId)) return { ok: true, userId: userId };
  return { ok: false, error: 'not_member', message: 'บัญชี LINE นี้ไม่ได้อยู่ในกลุ่ม' };
}

// สมาชิกกลุ่ม = เรียก group member profile ได้ (ต้องให้บอทอยู่ในกลุ่ม) — cache ผลบวกไว้ 6 ชม.
function isMember(userId) {
  var extra = EXTRA_USER_IDS.split(',').map(function (s) { return s.trim(); });
  if (extra.indexOf(userId) !== -1) return true;

  var cache = CacheService.getScriptCache();
  var key = 'member_' + userId;
  if (cache.get(key)) return true;

  var gid = getGroupId();
  if (!gid) { Logger.log('ยังไม่มี Group ID — ให้พิมพ์อะไรก็ได้ในกลุ่ม 1 ครั้ง'); return false; }
  var res = UrlFetchApp.fetch(
    'https://api.line.me/v2/bot/group/' + gid + '/member/' + encodeURIComponent(userId), {
      headers: { 'Authorization': 'Bearer ' + LINE_TOKEN },
      muteHttpExceptions: true
    });
  if (res.getResponseCode() === 200) {
    cache.put(key, '1', 6 * 60 * 60);
    return true;
  }
  return false;
}

// ====== 2) Webhook ของ LINE บอท ======
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    (body.events || []).forEach(function (ev) {
      // บันทึก groupId อัตโนมัติ (ใช้ตอนแจ้งเตือนวันเกิด และตรวจสิทธิ์สมาชิก)
      if (ev.source && ev.source.groupId) saveGroupId(ev.source.groupId);
      // ถ้ามีคนพิมพ์ข้อความที่มีคำว่า "ค้นหา"
      if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
        var text = String(ev.message.text || '').trim();
        if (text.indexOf('ค้นหา') !== -1) {
          replyFinder(ev.replyToken);
        }
        // พิมพ์ "ไอดีกลุ่ม" เพื่อดู/ยืนยัน Group ID (ไม่จำเป็นก็ได้ — ระบบบันทึกให้เองแล้ว)
        else if (text.indexOf('ไอดีกลุ่ม') !== -1) {
          var gid = (ev.source && ev.source.groupId) ? ev.source.groupId : '';
          var msg = !gid ? 'คำสั่งนี้ใช้ในกลุ่มเท่านั้น'
            : (gid === getGroupId() ? '✅ กลุ่มนี้คือกลุ่มหลักของระบบ\nGroup ID:\n' + gid
                                    : '⚠️ กลุ่มนี้ไม่ใช่กลุ่มหลักของระบบ');
          replyText(ev.replyToken, msg);
        }
      }
    });
  } catch (err) {
    Logger.log(err);
  }
  return ContentService.createTextOutput('OK');
}

// ตอบกลับเป็นการ์ดปุ่มเปิด web app
function replyFinder(replyToken) {
  var flex = {
    type: 'flex',
    altText: 'เปิดระบบค้นหาข้อมูลบุคคล',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: 'FINDER', weight: 'bold', size: 'xxl', color: '#1f9e3f' },
          { type: 'text', text: 'ระบบค้นหาข้อมูลบุคคล', size: 'sm', color: '#888888', wrap: true }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#1f9e3f',
          action: { type: 'uri', label: '🔍 เปิดระบบค้นหา', uri: APP_URL }
        }]
      }
    }
  };
  lineApi('message/reply', { replyToken: replyToken, messages: [flex] });
}

// ตอบกลับเป็นข้อความธรรมดา
function replyText(replyToken, msg) {
  lineApi('message/reply', { replyToken: replyToken, messages: [{ type: 'text', text: msg }] });
}

// ====== 3) แจ้งเตือนวันเกิดอัตโนมัติ ======
// ตั้ง time-driven trigger ให้รันฟังก์ชันนี้ทุกเช้า (ดูขั้นตอนด้านล่าง)
function notifyBirthdays() {
  var sheet = getDataSheet();
  var rows = sheet.getDataRange().getValues();
  var headers = rows.shift().map(function (h) { return String(h).trim(); });

  // หา index ของคอลัมน์ (ยืดหยุ่นตามชื่อจริงใน Sheet)
  var iFirst = headers.indexOf('ชื่อ');
  var iLast  = headers.indexOf('นามสกุล');
  var iChaya = headers.indexOf('ฉายา');
  var iDob = -1;
  headers.forEach(function (h, i) { if (iDob === -1 && h.indexOf('เกิด') !== -1) iDob = i; });
  if (iDob === -1) return;

  var today = new Date();
  var td = today.getDate(), tm = today.getMonth() + 1;
  var thisYearCE = today.getFullYear();

  var list = [];
  rows.forEach(function (r) {
    var raw = r[iDob];
    if (!raw) return;
    var dd, mm, birthYearCE;
    if (raw instanceof Date) {
      dd = raw.getDate(); mm = raw.getMonth() + 1; birthYearCE = raw.getFullYear();
    } else {
      var p = String(raw).trim().split('/');
      if (p.length !== 3) return;
      dd = parseInt(p[0], 10); mm = parseInt(p[1], 10);
      var y = parseInt(p[2], 10);
      birthYearCE = y > 2200 ? y - 543 : y; // เผื่อเก็บเป็น พ.ศ.
    }
    if (dd === td && mm === tm) {
      var name = ((iFirst > -1 ? r[iFirst] : '') + ' ' + (iLast > -1 ? r[iLast] : '')).trim();
      var chaya = iChaya > -1 && r[iChaya] ? (' (' + r[iChaya] + ')') : '';
      var age = thisYearCE - birthYearCE;
      list.push('• ' + name + chaya + ' — อายุครบ ' + age + ' ปี');
    }
  });

  if (!list.length) return; // ไม่มีวันเกิดวันนี้ ไม่ต้องส่ง

  var msg = '🎂 วันนี้วันเกิด\n' + list.join('\n') + '\n\nสุขสันต์วันเกิดครับ 🎉';
  pushToGroup(msg);
}

// ล็อกกลุ่มหลักไว้ที่กลุ่มแรกที่บันทึก — กันคนเชิญบอทเข้ากลุ่มอื่นแล้วได้สิทธิ์ดูข้อมูล
// ถ้าต้องการเปลี่ยนกลุ่ม: Project Settings → Script Properties → ลบ GROUP_ID แล้วพิมพ์ในกลุ่มใหม่
function saveGroupId(groupId) {
  if (GROUP_ID) return;
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GROUP_ID')) {
    props.setProperty('GROUP_ID', groupId);
    Logger.log('groupId = ' + groupId);
  }
}

// หา Group ID ที่ใช้ (จากที่บอทบันทึกอัตโนมัติ หรือจากตัวแปร GROUP_ID)
function getGroupId() {
  if (GROUP_ID) return GROUP_ID;
  return PropertiesService.getScriptProperties().getProperty('GROUP_ID') || '';
}

// ส่งข้อความเข้ากลุ่ม
function pushToGroup(msg) {
  var gid = getGroupId();
  if (!gid) { Logger.log('ยังไม่มี Group ID — ให้พิมพ์อะไรก็ได้ในกลุ่ม 1 ครั้ง'); return; }
  lineApi('message/push', { to: gid, messages: [{ type: 'text', text: msg }] });
}

// เรียก LINE Messaging API — ถ้าไม่สำเร็จจะบันทึก error ไว้ใน Executions (การเรียกใช้)
function lineApi(path, body) {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/' + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + LINE_TOKEN },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.error('LINE ' + path + ' ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  return res;
}

// ====== ตรวจระบบ: เลือกฟังก์ชันนี้ด้านบนแล้วกด "เรียกใช้" (Run) ======
function testToken() {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/info', {
    headers: { 'Authorization': 'Bearer ' + LINE_TOKEN },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 200) {
    Logger.log('✅ token ใช้ได้ — บอท: ' + JSON.parse(res.getContentText()).displayName);
  } else {
    Logger.log('❌ token ใช้ไม่ได้ (' + res.getResponseCode() + ') — ไปคัดลอก Channel access token ใหม่ใน LINE Developers');
  }
  Logger.log('กลุ่มหลัก (GROUP_ID): ' + (getGroupId() || '— ยังไม่มี: พิมพ์อะไรก็ได้ในกลุ่ม 1 ครั้ง'));
  Logger.log('แท็บข้อมูลที่เว็บอ่าน: "' + getDataSheet().getName() + '"');
}

// ====== แท็บข้อมูลหลัก (ตรวจแล้ว) ======
// ล็อกด้วย ID ของแท็บ (ไม่ใช่ลำดับหรือชื่อ) — เพิ่มแท็บคำตอบจาก Google Form / ย้ายลำดับ / เปลี่ยนชื่อ
// ก็ยังอ่านแท็บเดิม ครั้งแรกที่เรียกจะล็อกแท็บแรกสุดในขณะนั้น
// ถ้าต้องการเปลี่ยน: ใน Google Sheet เปิดแท็บที่ต้องการ → เมนู FINDER → ใช้แท็บนี้เป็นข้อมูลหลัก
function getDataSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DATA_SHEET_ID');
  if (id) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (String(sheets[i].getSheetId()) === id) return sheets[i];
    }
    throw new Error('ไม่พบแท็บข้อมูลหลัก (ถูกลบ?) — เปิดแท็บที่ถูกต้อง → เมนู FINDER → ใช้แท็บนี้เป็นข้อมูลหลัก');
  }
  var first = ss.getSheets()[0];
  props.setProperty('DATA_SHEET_ID', String(first.getSheetId()));
  return first;
}

// เมนู FINDER ใน Google Sheet
function onOpen() {
  SpreadsheetApp.getUi().createMenu('FINDER')
    .addItem('✅ ย้ายข้อมูลที่ตรวจแล้ว', 'transferApproved')
    .addItem('เตรียม / เติมช่องติ๊ก "ตรวจแล้ว"', 'setupReview')
    .addSeparator()
    .addItem('ดูแท็บข้อมูลหลักปัจจุบัน', 'showDataSheet')
    .addItem('ใช้แท็บนี้เป็นข้อมูลหลัก', 'lockDataSheet')
    .addToUi();
}

function showDataSheet() {
  SpreadsheetApp.getUi().alert('เว็บและบอทอ่านข้อมูลจากแท็บ: "' + getDataSheet().getName() + '"');
}

function lockDataSheet() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSheet();
  var ok = ui.alert('ใช้แท็บ "' + sheet.getName() + '" เป็นข้อมูลหลัก?',
    'เว็บและบอทจะอ่านข้อมูลจากแท็บนี้ — ต้องเป็นข้อมูลที่ตรวจแล้วเท่านั้น', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty('DATA_SHEET_ID', String(sheet.getSheetId()));
  ui.alert('ล็อกแท็บข้อมูลหลักเป็น "' + sheet.getName() + '" แล้ว');
}

// ====== 4) ย้ายคำตอบจาก Google Form ที่ตรวจแล้ว → แท็บข้อมูลหลัก ======
// ในแท็บคำตอบ: ติ๊ก ☑ "ตรวจแล้ว" แถวที่ถูกต้อง → เมนู FINDER → ย้ายข้อมูลที่ตรวจแล้ว
// - คนที่มีอยู่แล้ว (ชื่อ+นามสกุล หรือเบอร์โทรตรงกัน) → อัปเดตแถวเดิม เฉพาะช่องที่กรอกมา
//   (ไม่แก้ชื่อ-นามสกุลเดิม เช่น ยศที่ใส่ไว้ — ถ้าต้องการเปลี่ยนให้แก้ในแท็บข้อมูลเอง)
// - คนใหม่ → เพิ่มแถวท้ายสุด
// - แถวที่ย้ายแล้วจะมีข้อความใน "สถานะการย้าย" และจะไม่ถูกย้ายซ้ำ
var COL_CHECK  = 'ตรวจแล้ว';
var COL_STATUS = 'สถานะการย้าย';
var COL_ALIASES = { 'อัพเดตล่าสุด': ['ประทับเวลา', 'timestamp'] };

function getResponseSheet() {
  var dataId = getDataSheet().getSheetId();
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() !== dataId && sheets[i].getFormUrl()) return sheets[i];
  }
  throw new Error('ไม่พบแท็บคำตอบจาก Google Form ในไฟล์นี้');
}

function trimStr(v) { return String(v == null ? '' : v).trim(); }
function normKey(h) { return trimStr(h).replace(/[\s.\-_()]/g, '').toLowerCase(); }
// ไม่สนข้อความในวงเล็บ: "วันเดือนปีเกิด (คศ)" = "วันเดือนปีเกิด"
function baseKey(h) { return normKey(trimStr(h).replace(/\(.*?\)/g, '')); }

// จับคู่คอลัมน์ข้อมูลหลัก → คอลัมน์คำตอบ ตามชื่อหัวคอลัมน์
function mapColumns(dataHeaders, respHeaders) {
  var map = [], missing = [];
  dataHeaders.forEach(function (h) {
    var names = [h].concat(COL_ALIASES[h] || []);
    var found = -1;
    names.forEach(function (n) {
      if (found !== -1) return;
      for (var i = 0; i < respHeaders.length; i++) {
        if (respHeaders[i] === COL_CHECK || respHeaders[i] === COL_STATUS) continue;
        if (trimStr(respHeaders[i]) === n || normKey(respHeaders[i]) === normKey(n)) { found = i; return; }
      }
      for (var j = 0; j < respHeaders.length; j++) {
        if (respHeaders[j] === COL_CHECK || respHeaders[j] === COL_STATUS) continue;
        if (baseKey(respHeaders[j]) && baseKey(respHeaders[j]) === baseKey(n)) { found = j; return; }
      }
    });
    map.push(found);
    if (found === -1 && h) missing.push(h);
  });
  return { map: map, missing: missing };
}

// คีย์ระบุตัวคน: ชื่อ (ตัดยศ/คำนำหน้าที่มีจุด) + นามสกุล และเบอร์โทร 9 หลักท้าย
function personKeys(headers, rec) {
  var get = function (name) { var i = headers.indexOf(name); return i === -1 ? '' : trimStr(rec[i]); };
  var first = get('ชื่อ'), last = get('นามสกุล');
  var namePart = trimStr(first.split('.').pop()) || first;
  var keys = [];
  if (namePart || last) keys.push('n:' + (namePart + ' ' + last).replace(/\s+/g, ' ').trim().toLowerCase());
  var digits = get('เบอร์โทรศัพท์').replace(/\D/g, '');
  if (digits.length >= 9) keys.push('t:' + digits.slice(-9));
  return keys;
}

function displayName(headers, rec) {
  var get = function (name) { var i = headers.indexOf(name); return i === -1 ? '' : trimStr(rec[i]); };
  return (get('ชื่อ') + ' ' + get('นามสกุล')).trim() || '(ไม่มีชื่อ)';
}

// อายุ: ถ้าคำตอบไม่มี ให้คำนวณจากวันเกิด (Date หรือ ว/ด/ปปปป — ปี > 2400 ถือเป็น พ.ศ.)
function fillAge(headers, rec, today) {
  var iAge = headers.indexOf('อายุ');
  if (iAge === -1 || trimStr(rec[iAge]) !== '') return;
  var iDob = -1;
  headers.forEach(function (h, i) { if (iDob === -1 && String(h).indexOf('เกิด') !== -1) iDob = i; });
  if (iDob === -1 || !rec[iDob]) return;
  var v = rec[iDob], d, m, y;
  if (Object.prototype.toString.call(v) === '[object Date]') { d = v.getDate(); m = v.getMonth() + 1; y = v.getFullYear(); }
  else {
    var p = trimStr(v).split('/');
    if (p.length !== 3) return;
    d = +p[0]; m = +p[1]; y = +p[2];
    if (y > 2400) y -= 543;
  }
  if (!y) return;
  var age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  rec[iAge] = age;
}

// วางแผนการย้าย: แยกเป็นอัปเดตแถวเดิม / เพิ่มใหม่ (คำตอบซ้ำคนเดียวกันในรอบเดียวรวมเป็นรายการเดียว)
function planTransfer(dataHeaders, dataRows, respHeaders, respRows, colCheck, colStatus, today) {
  var m = mapColumns(dataHeaders, respHeaders);
  var index = {};
  dataRows.forEach(function (r, i) {
    personKeys(dataHeaders, r).forEach(function (k) { if (!(k in index)) index[k] = { row: i + 2 }; });
  });
  var items = [];
  respRows.forEach(function (r, i) {
    if (r[colCheck] !== true || trimStr(r[colStatus]) !== '') return;
    var rec = m.map.map(function (ri) { return ri === -1 ? '' : r[ri]; });
    fillAge(dataHeaders, rec, today);
    var keys = personKeys(dataHeaders, rec);
    if (!keys.length) return;
    var hit = null;
    keys.forEach(function (k) { if (!hit && index[k]) hit = index[k]; });
    if (hit && hit.item) {                       // คนเดียวกับที่เพิ่งจะเพิ่มใหม่ในรอบนี้
      mergeInto(hit.item.rec, rec);
      hit.item.respRows.push(i + 2);
      return;
    }
    var item = { rec: rec, respRows: [i + 2], row: hit ? hit.row : 0, name: displayName(dataHeaders, rec) };
    items.push(item);
    if (!hit) keys.forEach(function (k) { if (!(k in index)) index[k] = { item: item }; });
  });
  return { items: items, missing: m.missing };
}

// เขียนทับเฉพาะช่องที่มีค่า — ช่องที่คำตอบเว้นว่างไว้จะคงข้อมูลเดิม (skip = index ที่ห้ามแก้)
function mergeInto(target, rec, skip) {
  rec.forEach(function (v, j) {
    if (skip && skip.indexOf(j) !== -1) return;
    if (trimStr(v) !== '') target[j] = v;
  });
}

// เพิ่มคอลัมน์ "ตรวจแล้ว" (ช่องติ๊ก) และ "สถานะการย้าย" ในแท็บคำตอบ ถ้ายังไม่มี
function ensureReviewColumns(resp) {
  var headers = resp.getRange(1, 1, 1, resp.getLastColumn()).getValues()[0].map(trimStr);
  var created = false;
  [COL_CHECK, COL_STATUS].forEach(function (h) {
    if (headers.indexOf(h) === -1) {
      resp.getRange(1, headers.length + 1).setValue(h);
      headers.push(h);
      created = true;
    }
  });
  var check = headers.indexOf(COL_CHECK), status = headers.indexOf(COL_STATUS);
  var rows = Math.max(resp.getMaxRows() - 1, 1);
  resp.getRange(2, check + 1, rows, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  return { check: check, status: status, created: created };
}

// ครั้งแรก (ตอนสร้างคอลัมน์): ทำเครื่องหมายคำตอบเก่าที่มีในข้อมูลหลักแล้ว ว่าไม่ต้องย้าย
// กดซ้ำภายหลัง: แค่เติมช่องติ๊กให้แถวใหม่ — ไม่แตะสถานะ เพื่อไม่ให้คำตอบแก้ไขข้อมูลของคนเดิมถูกข้าม
function setupReview() {
  var ui = SpreadsheetApp.getUi();
  var resp = getResponseSheet();
  var cols = ensureReviewColumns(resp);
  if (!cols.created) {
    ui.alert('เติมช่องติ๊ก "ตรวจแล้ว" ให้แถวใหม่แล้ว');
    return;
  }
  var data = getDataSheet();
  var dv = data.getDataRange().getValues(), dh = dv.shift().map(trimStr);
  var known = {};
  dv.forEach(function (r) { personKeys(dh, r).forEach(function (k) { known[k] = true; }); });

  var rv = resp.getDataRange().getValues(), rh = rv.shift().map(trimStr);
  var m = mapColumns(dh, rh);
  var marked = 0, pending = 0;
  var statuses = rv.map(function (r) {
    if (trimStr(r[cols.status]) !== '') return [r[cols.status]];
    var rec = m.map.map(function (ri) { return ri === -1 ? '' : r[ri]; });
    var keys = personKeys(dh, rec);
    if (!keys.length) return [''];
    if (keys.some(function (k) { return known[k]; })) { marked++; return ['มีในข้อมูลหลักแล้ว (ก่อนใช้ปุ่มย้าย)']; }
    pending++;
    return [''];
  });
  if (statuses.length) resp.getRange(2, cols.status + 1, statuses.length, 1).setValues(statuses);
  ui.alert('เตรียมแท็บ "' + resp.getName() + '" แล้ว',
    'คำตอบที่มีในข้อมูลหลักแล้ว: ' + marked + ' แถว (ไม่ต้องย้าย)\n' +
    'คำตอบที่รอตรวจ: ' + pending + ' แถว\n\n' +
    (m.missing.length ? '⚠️ คอลัมน์ที่ไม่มีในคำตอบ (จะไม่ถูกแก้): ' + m.missing.join(', ') + '\n\n' : '') +
    'ตรวจแถวที่ "สถานะการย้าย" ว่าง → ติ๊ก ☑ ตรวจแล้ว → เมนู FINDER → ย้ายข้อมูลที่ตรวจแล้ว',
    ui.ButtonSet.OK);
}

function transferApproved() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) { ui.alert('มีคนกำลังย้ายข้อมูลอยู่ ลองใหม่อีกครั้ง'); return; }
  try {
    var data = getDataSheet(), resp = getResponseSheet();
    var cols = ensureReviewColumns(resp);
    var dv = data.getDataRange().getValues(), dh = dv.shift().map(trimStr);
    var rv = resp.getDataRange().getValues(), rh = rv.shift().map(trimStr);
    var plan = planTransfer(dh, dv, rh, rv, cols.check, cols.status, new Date());
    if (!plan.items.length) { ui.alert('ไม่มีแถวที่ติ๊ก "ตรวจแล้ว" และยังไม่ได้ย้าย'); return; }

    var adds = plan.items.filter(function (it) { return !it.row; });
    var ups  = plan.items.filter(function (it) { return it.row; });
    var list = function (arr) { return arr.map(function (it) { return '• ' + it.name; }).join('\n'); };
    var msg = (adds.length ? 'เพิ่มคนใหม่ ' + adds.length + ' คน:\n' + list(adds) + '\n\n' : '') +
              (ups.length ? 'อัปเดตข้อมูลเดิม ' + ups.length + ' คน:\n' + list(ups) + '\n\n' : '') +
              (plan.missing.length ? '⚠️ คอลัมน์ที่ไม่มีในคำตอบ (จะไม่ถูกแก้): ' + plan.missing.join(', ') : '');
    if (ui.alert('ย้ายไปแท็บ "' + data.getName() + '"?', msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

    var width = dh.length;
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd/M/yyyy HH:mm');
    plan.items.forEach(function (it) {
      var row = it.row;
      if (row) {
        var range = data.getRange(row, 1, 1, width);
        var cur = range.getValues()[0];
        mergeInto(cur, it.rec, [dh.indexOf('ชื่อ'), dh.indexOf('นามสกุล')]);
        range.setValues([cur]);
      } else {
        row = data.getLastRow() + 1;
        data.getRange(row, 1, 1, width).setValues([it.rec]);
        if (row > 2) data.getRange(2, 1, 1, width).copyTo(data.getRange(row, 1, 1, width),
          SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      }
      var note = (it.row ? 'อัปเดต' : 'เพิ่มใหม่') + ' แถว ' + row + ' · ' + stamp;
      it.respRows.forEach(function (rr) { resp.getRange(rr, cols.status + 1).setValue(note); });
    });
    ui.alert('ย้ายเสร็จแล้ว — เพิ่มใหม่ ' + adds.length + ' คน, อัปเดต ' + ups.length + ' คน');
  } finally {
    lock.releaseLock();
  }
}
