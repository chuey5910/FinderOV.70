/**
 * FINDER — Google Apps Script (รวม 2 หน้าที่ในไฟล์เดียว)
 *   1) doGet  = ส่งข้อมูลจาก Sheet เป็น JSON ให้ web app  (ของเดิม)
 *   2) doPost = Webhook ของ LINE บอท: พิมพ์ "ค้นหา" ในกลุ่ม → ตอบการ์ดปุ่มเปิด web app
 *
 * วิธีใช้: เอาโค้ดนี้ไปวางแทนของเดิมใน Apps Script แล้ว Deploy เวอร์ชันใหม่
 * (Manage deployments → Edit → New version → Deploy) — URL /exec เดิมจะทำได้ทั้งสองอย่าง
 */

// ====== ตั้งค่า ======
var LINE_TOKEN = 'วาง Channel access token ที่นี่';          // จาก Messaging API channel
var APP_URL    = 'https://chuey5910.github.io/FinderOV.70/';  // URL ของ web app (GitHub Pages)
var GROUP_ID   = '';  // ไม่ต้องกรอก! บอทจะบันทึก Group ID ให้เองอัตโนมัติเมื่อมีคนพิมพ์ในกลุ่ม

// ====== 1) ส่งข้อมูลให้ web app (ของเดิม) ======
function doGet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
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
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ====== 2) Webhook ของ LINE บอท ======
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    (body.events || []).forEach(function (ev) {
      // บันทึก groupId อัตโนมัติ (ใช้ตอนแจ้งเตือนวันเกิด — ไม่ต้องหาเอง)
      if (ev.source && ev.source.groupId) {
        PropertiesService.getScriptProperties().setProperty('GROUP_ID', ev.source.groupId);
        Logger.log('groupId = ' + ev.source.groupId);
      }
      // ถ้ามีคนพิมพ์ข้อความที่มีคำว่า "ค้นหา"
      if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
        var text = String(ev.message.text || '').trim();
        if (text.indexOf('ค้นหา') !== -1) {
          replyFinder(ev.replyToken);
        }
        // พิมพ์ "ไอดีกลุ่ม" เพื่อดู/ยืนยัน Group ID (ไม่จำเป็นก็ได้ — ระบบบันทึกให้เองแล้ว)
        else if (text.indexOf('ไอดีกลุ่ม') !== -1) {
          var gid = (ev.source && ev.source.groupId) ? ev.source.groupId : '(ไม่ใช่กลุ่ม)';
          replyText(ev.replyToken, '✅ บันทึกกลุ่มนี้สำหรับแจ้งเตือนวันเกิดแล้ว\nGroup ID:\n' + gid);
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
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + LINE_TOKEN },
    payload: JSON.stringify({ replyToken: replyToken, messages: [flex] }),
    muteHttpExceptions: true
  });
}

// ตอบกลับเป็นข้อความธรรมดา
function replyText(replyToken, msg) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + LINE_TOKEN },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: msg }] }),
    muteHttpExceptions: true
  });
}

// ====== 3) แจ้งเตือนวันเกิดอัตโนมัติ ======
// ตั้ง time-driven trigger ให้รันฟังก์ชันนี้ทุกเช้า (ดูขั้นตอนด้านล่าง)
function notifyBirthdays() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
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

// หา Group ID ที่ใช้ (จากที่บอทบันทึกอัตโนมัติ หรือจากตัวแปร GROUP_ID)
function getGroupId() {
  if (GROUP_ID) return GROUP_ID;
  return PropertiesService.getScriptProperties().getProperty('GROUP_ID') || '';
}

// ส่งข้อความเข้ากลุ่ม
function pushToGroup(msg) {
  var gid = getGroupId();
  if (!gid) { Logger.log('ยังไม่มี Group ID — ให้พิมพ์อะไรก็ได้ในกลุ่ม 1 ครั้ง'); return; }
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + LINE_TOKEN },
    payload: JSON.stringify({ to: gid, messages: [{ type: 'text', text: msg }] }),
    muteHttpExceptions: true
  });
}
