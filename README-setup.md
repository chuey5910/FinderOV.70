# ทำ FINDER ให้เป็นแอปจริงบน LINE (ต่อ Google Sheet)

แอปนี้ออกแบบให้ "พร้อมเป็นของจริง" อยู่แล้ว — แค่ทำ 3 ขั้นตอนนี้ก็ใช้งานได้จริง

---

## 1) เตรียม Google Sheet

ใส่หัวคอลัมน์แถวแรกให้ตรงชื่อเหล่านี้ (สะกดตามนี้):

```
ชื่อ | นามสกุล | ฉายา | คณะเด็กเล็ก | คณะเด็กใน | วันเดือนปีเกิด | เบอร์โทรศัพท์ | ID Line | จว.ที่อยู่ | ทำงาน | ตำแหน่ง | อัพเดตล่าสุด
```

หมายเหตุ
- **คณะเด็กเล็ก** ใส่รหัสบ้าน: `สจ.` `นอ.` `สร.` (เว้นว่างถ้าไม่ได้อยู่คณะนี้)
- **คณะเด็กใน** ใส่รหัสบ้าน: `ผบก.` `ดส.` `จล.` `พท.` (เว้นว่างถ้าไม่ได้อยู่คณะนี้)
- **วันเดือนปีเกิด** รูปแบบ `วว/ดด/ปปปป` เป็น พ.ศ. เช่น `12/03/2545` — อายุระบบคำนวณให้อัตโนมัติ
- **อัพเดตล่าสุด** ใส่วันที่ที่แก้ไขข้อมูลแถวนั้นล่าสุด (แสดงบนหน้ารายบุคคล)

---

## 2) เผยแพร่ Sheet เป็น API ด้วย Apps Script

1. เปิด Sheet → เมนู **ส่วนขยาย (Extensions) → Apps Script**
2. ลบโค้ดเดิม วางโค้ดนี้ (มีในไฟล์ `sheet-api.gs` ด้วย):

```javascript
function doGet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();
  const data = rows
    .filter(r => r.join('').trim() !== '')
    .map(r => {
      const o = {};
      headers.forEach((h, i) => { o[String(h).trim()] = r[i]; });
      return o;
    });
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. กด **Deploy → New deployment → ประเภท: Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. คัดลอก **Web app URL** ที่ได้ (ลงท้าย `/exec`)

---

## 3) ตั้งค่า LINE LIFF + ใส่ค่าในแอป

**สร้าง LIFF**
1. ไปที่ [LINE Developers Console](https://developers.line.biz/) → สร้าง Provider + Channel (ประเภท LINE Login)
2. แท็บ **LIFF → Add** → ตั้ง Size = Full, Endpoint URL = URL ที่เราจะโฮสต์ไฟล์ (ดูขั้นตอนโฮสต์ด้านล่าง)
3. คัดลอก **LIFF ID**

**ใส่ค่าลงในแอป** — เปิด `People Finder App.dc.html` แก้บล็อก `CONFIG` ด้านบนของโค้ด:

```javascript
static CONFIG = {
  SHEET_API_URL: 'https://script.google.com/macros/s/XXXX/exec',
  LIFF_ID: '1234567890-abcdefgh',
};
```

ใส่แล้วแอปจะดึงข้อมูลสดจาก Sheet ทันที (มุมขวาบนจะเปลี่ยนจาก `◉ DEMO` เป็น `◉ LIVE`)

---

## 4) โฮสต์ไฟล์ให้เปิดผ่าน HTTPS

ใช้ไฟล์ `People Finder App.standalone.html` (ไฟล์เดียวจบ) อัปขึ้นที่ไหนก็ได้ที่เป็น HTTPS เช่น
- **Netlify Drop** (ลากไฟล์วางในเว็บ ได้ URL ทันที)
- **Vercel** / **GitHub Pages** / **Cloudflare Pages**

เอา URL ที่ได้ไปใส่เป็น Endpoint URL ของ LIFF (ข้อ 3)

**เพิ่มลิงก์ในเมนู LINE OA** (Rich Menu) ให้ชี้ไปที่ `https://liff.line.me/<LIFF_ID>` — พนักงานกดจากเมนูแล้วเปิดแอปในไลน์ได้เลย

---

## สรุปการทำงาน
- **ค้นหา** — พิมพ์ชื่อ/นามสกุล/ฉายา/บ้าน + กรองคณะเด็กใน/เด็กเล็กแบบ dropdown
- **หน้ารายบุคคล** — แสดงครบทุกคอลัมน์ + อายุคำนวณอัตโนมัติ + วันที่อัพเดตล่าสุดจาก Sheet
- **📞 โทร** — โทรออกจริง
- **💬 คัดลอก ID Line** — คัดลอกไปวางหน้า Add friend ได้
