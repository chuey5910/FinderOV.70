# FINDER (OV70) — เอกสารส่งมอบสำหรับขึ้น server

ระบบค้นหาข้อมูลบุคคลจาก Google Sheet ใช้งานผ่านกลุ่ม LINE (มือถือ) ธีมจอเทอร์มินัลเขียวยุค 80s

---

## 1. ภาพรวมระบบ

```
[กลุ่ม LINE] --พิมพ์ "ค้นหา"--> [LINE Messaging API] --webhook--> [Apps Script doPost]
                                                                        |
                                                              ตอบ Flex card + ปุ่ม
                                                                        v
[สมาชิกกดปุ่ม] -------------------------------------------> [Web app: index.html]
                                                                        |
                                                              fetch JSON (GET)
                                                                        v
                                                          [Apps Script doGet] --> [Google Sheet]

[Time trigger ทุกเช้า 08-09] --> [Apps Script notifyBirthdays] --push--> [กลุ่ม LINE]
```

- **Frontend**: ไฟล์ HTML ไฟล์เดียว (static) ไม่ต้องมี build step ไม่ต้องมี backend ของตัวเอง
- **Backend**: Google Apps Script (Web App URL `/exec` ตัวเดียว ทำทั้ง doGet และ doPost)
- **Data**: Google Sheet (เป็นส่วนตัว ไม่ต้องแชร์) อ่านอย่างเดียว

---

## 2. ไฟล์ในชุดนี้

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `index.html` | **ตัวเว็บแอปที่ใช้งานจริง** (bundle ไฟล์เดียว รวมฟอนต์/รูป/runtime แล้ว) — วางบน server ได้เลย |
| `source/People Finder App.dc.html` | ซอร์สหลักของเว็บแอป (UI + logic) แก้ที่นี่ |
| `source/support.js` | runtime ที่ซอร์สต้องใช้ตอนเปิดแบบไม่ bundle |
| `source/uploads/ov70_crop.png` | โลโก้หัวแอป (ตัดขอบดำแล้ว) |
| `source/uploads/wallpaperiphone.PNG` | ลายน้ำกลางจอ |
| `line-bot.gs` | **โค้ด Apps Script ตัวปัจจุบัน** (doGet + ตรวจสิทธิ์ LIFF + doPost + แจ้งเตือนวันเกิด) |
| `tools/build_bundle.py` | สร้าง `index.html` ใหม่จากซอร์ส (`python3 tools/build_bundle.py`) |
| `README-setup.md` | คู่มือตั้งค่า Sheet / Apps Script แบบละเอียด |

> `sheet-api.gs` เก่าไม่ได้ใส่มา — `line-bot.gs` มี `doGet` ตัวเดียวกันอยู่แล้ว

---

## 3. ค่าที่ตั้งไว้ตอนนี้ (CONFIG)

**เว็บแอป** — `source/People Finder App.dc.html` → `static CONFIG` ในคลาส `Component`
```js
SHEET_API_URL: 'https://script.google.com/macros/s/AKfycbzt31HyaIPtgk-nSgN1cK5k4X72qoImDX_fl_oAhKikqtHPxQeCGWJfXT-lYXg2gAsIDg/exec',
SHEET_ID: '1oOK4TJPGJWVFT008O1fejOUrfYLLgrn1-64sgdLlIxE', // สำรอง (ใช้เมื่อไม่มี SHEET_API_URL และ Sheet แชร์ public)
LIFF_ID: '',                                                // ไม่ได้ใช้ (เปิดผ่านลิงก์ธรรมดา)
```

**Apps Script** — `line-bot.gs` ด้านบนไฟล์
```js
var LINE_TOKEN = '...';                                        // Channel access token (อยู่ใน Apps Script แล้ว ไม่ได้ใส่ในไฟล์นี้)
var APP_URL    = 'https://chuey5910.github.io/FinderOV.70/';  // ⚠️ เปลี่ยนเป็น URL server ใหม่
var GROUP_ID   = '';                                           // ว่างไว้ — บอทเก็บเองใน Script Properties
```

---

## 4. โครงสร้างข้อมูล (หัวคอลัมน์ใน Sheet แถวแรก)

```
ชื่อ | นามสกุล | ฉายา | คณะเด็กเล็ก | คณะเด็กใน | วันเดือนปีเกิด (คศ) | อายุ |
เบอร์โทรศัพท์ | ID Line | จว.ที่อยู่ | ทำงาน | ตำแหน่ง | อัพเดตล่าสุด
```

- คณะเด็กเล็ก: `สจ.` `นอ.` `สร.` · คณะเด็กใน: `ผบก.` `ดส.` `จล.` `พท.` — คนหนึ่งมีได้ทั้งสองคณะ
- `อายุ` ใช้ค่าจาก Sheet ถ้าว่างจะคำนวณจากวันเกิด
- แถวที่ไม่มีชื่อและนามสกุลถูกกรองทิ้ง
- mapping อยู่ที่ `normalize()` ในซอร์ส (รองรับชื่อคอลัมน์หลายแบบ)

---

## 5. ฟีเจอร์

**เว็บแอป**
- ตอนเปิด login LINE (LIFF) → "กำลังโหลดข้อมูล…" → ข้อมูลจริง + ป้าย `◉ LIVE` · ไม่มีสิทธิ์ → `◉ LOCKED` + ACCESS DENIED
- ค้นหาจาก ชื่อ / นามสกุล / ฉายา / บ้าน
- กรอง: ทั้งหมด · คณะเด็กใน ▾ (ผบก./ดส./จล./พท.) · คณะเด็กเล็ก ▾ (สจ./นอ./สร.)
- ผลลัพธ์ 2 บรรทัด: ชื่อ-นามสกุล / ฉายา
- หน้ารายบุคคล: ครบ 12 คอลัมน์ + แถบ "อัพเดตล่าสุด"
- 📞 โทร (`tel:`) · 💬 คัดลอก ID Line (clipboard + toast)
- จอ ≤520px เต็มจอ ไม่มีกรอบ · จอใหญ่แสดงกรอบมือถือ

**บอท LINE (`line-bot.gs`)**
- `ค้นหา` → ตอบ Flex card ปุ่ม "🔍 เปิดระบบค้นหา" → `APP_URL`
- `ไอดีกลุ่ม` → ยืนยัน/แสดง Group ID
- ทุก event จากกลุ่มจะบันทึก `GROUP_ID` ลง Script Properties อัตโนมัติ
- `notifyBirthdays()` — trigger รายวัน 08–09 น. (Head) ส่งรายชื่อวันเกิดวันนี้เข้ากลุ่ม

---

## 6. ย้ายขึ้น server ของตัวเอง

**วิธีง่ายสุด (static hosting)**
1. อัป `index.html` ขึ้น web root (nginx / Apache / S3 / ฯลฯ) — **ต้องเป็น HTTPS**
2. แก้ `APP_URL` ใน Apps Script เป็น URL ใหม่ → Save → **Deploy → Manage deployments → Edit → New version**
3. ถ้าแชร์ลิงก์ในกลุ่มไว้ ให้โพสต์ลิงก์ใหม่
4. Apps Script, Webhook, Trigger **ไม่ต้องเปลี่ยน** (ยังชี้ `/exec` เดิม)

ตัวอย่าง nginx:
```nginx
server {
  listen 443 ssl;
  server_name finder.example.com;
  root /var/www/finder;
  index index.html;
  location = /index.html { add_header Cache-Control "no-cache"; }  # กัน LINE cache เวอร์ชันเก่า
}
```

**ถ้าจะเขียนใหม่เป็นโปรเจกต์โค้ด (React/Vue/ฯลฯ)** — ใช้ `source/People Finder App.dc.html` เป็นสเปก:
- template (ระหว่าง `<x-dc>`) = markup + inline style ทั้งหมด
- `class Component` = state, `loadFromSheet()`, `normalize()`, filter/search, `ageFromDob()`
- design tokens: พื้น `#050a05` · เขียวหลัก `#33ff66` · เขียวรอง `#1f9e3f` · ตัวอักษรค่า `#c9ffd6` · ส้ม `#ffb000` · แดง `#ff5a5a`
- ฟอนต์: Kanit (ไทย), VT323 (โลโก้ FINDER_), Share Tech Mono (mono)
- ขนาดตัวอักษร: FINDER_ 42 · records 12 · ช่องค้นหา 16 · ชิป 13 · ชื่อในผลลัพธ์ 16 · ฉายา 16 · หัวข้อรายละเอียด 17 · ค่า 19
- เอฟเฟกต์ CRT: scanline `repeating-linear-gradient` + ลายน้ำ `mix-blend-mode:screen; opacity:.4`

**ถ้าอยากย้าย backend ออกจาก Apps Script** (ทางเลือก)
- `GET /api/people` → คืน JSON array ของแถว (คีย์ = ชื่อคอลัมน์ไทย) — แทน `doGet`
- `POST /webhook` → ตรวจ `X-Line-Signature` ด้วย Channel secret แล้วทำแบบ `doPost`
- cron รายวัน → `notifyBirthdays`
- อ่าน Sheet ด้วย Google Sheets API + service account (แชร์ Sheet ให้ service account แบบ Viewer)
- เก็บ `LINE_TOKEN`, `GROUP_ID` ใน env / secret store

---

## 7. ความปลอดภัย
- `index.html` ไม่มี secret — มีแค่ URL `/exec` และ LIFF ID (เปิดเผยได้)
- `LINE_TOKEN` อยู่ใน Apps Script เท่านั้น — ถ้าหลุดให้ Issue ใหม่
- **จำกัดสิทธิ์ด้วย LIFF + สมาชิกกลุ่ม**: `doGet` ส่งข้อมูลเฉพาะคนที่ login LINE และเป็นสมาชิกกลุ่มหลัก (ดูหัวข้อ 7.1)
- กลุ่มหลักถูกล็อกไว้ที่กลุ่มแรกที่บอทบันทึก — เชิญบอทไปกลุ่มอื่นไม่ได้สิทธิ์เพิ่ม
- Google Sheet ต้อง **ไม่** แชร์แบบ "ทุกคนที่มีลิงก์" (ไม่งั้นข้ามการตรวจสิทธิ์ได้)

### 7.1 ตั้งค่า LIFF login (ทำครั้งเดียว)

**ลำดับสำคัญ** — เว็บก่อน แล้วค่อย Apps Script (เว็บใหม่ใช้กับ Apps Script เก่าได้ ไม่มีช่วงล่ม)
เว็บที่ `LIFF_ID` ว่างจะดึงข้อมูลแบบเดิม — การตรวจสิทธิ์เริ่มทำงานเมื่อ deploy `line-bot.gs` ตัวใหม่ (ข้อ 3)

1. **สร้าง LIFF** — [LINE Developers Console](https://developers.line.biz/console/) → เลือก **Provider เดียวกับบอท** (สำคัญ: userId แยกตาม Provider)
   → Create channel → **LINE Login** → แท็บ LIFF → Add
   - Size: **Full** · Endpoint URL: `https://chuey5910.github.io/FinderOV.70/`
   - Scopes: ติ๊ก **openid** (และ profile)
   - คัดลอก **LIFF ID** (เช่น `2001234567-AbCdEfGh`)
   - ตั้ง channel เป็น **Published** (ถ้าเป็น Developing จะ login ได้แค่ admin ของ channel)
2. **เว็บ** — ใส่ `LIFF_ID` ใน `source/People Finder App.dc.html` (`static CONFIG`) แล้วรัน
   `python3 tools/build_bundle.py` → commit `index.html` → merge เข้า `main`
3. **Apps Script** — วางโค้ด `line-bot.gs` ใหม่ ใส่ `LINE_TOKEN` (ตัวเดิม) และ `LIFF_ID`
   → Deploy → **Manage deployments → Edit (ดินสอ) → Version: New version → Deploy**
   (ห้ามกด New deployment — URL `/exec` จะเปลี่ยน ทั้ง webhook บอทและเว็บจะหลุด)
4. เช็ก Script Properties มี `GROUP_ID` ของกลุ่มจริง (พิมพ์ `ไอดีกลุ่ม` ในกลุ่ม → ต้องตอบ "กลุ่มหลักของระบบ")

ทดสอบ: พิมพ์ `ค้นหา` ในกลุ่ม → กดปุ่ม → ต้องเห็น `◉ LIVE`
เปิด URL `/exec` ตรง ๆ → ต้องเห็น `{"error":"unauthorized",...}`

| ข้อความบนเว็บ | สาเหตุ |
|---|---|
| กรุณาเปิดผ่านปุ่มในกลุ่ม LINE | เว็บยังไม่มี `LIFF_ID` (ข้อ 2) หรือเปิด URL เว็บตรง ๆ แทนลิงก์ `liff.line.me` |
| ไม่ได้รับ ID token | LIFF ไม่มี scope `openid` |
| ยืนยันตัวตน LINE ไม่สำเร็จ | `LIFF_ID` ใน Apps Script ไม่ตรง / LIFF อยู่คนละ channel |
| บัญชี LINE นี้ไม่ได้อยู่ในกลุ่ม | ไม่ใช่สมาชิก หรือ LIFF อยู่คนละ Provider กับบอท หรือ `GROUP_ID` ผิดกลุ่ม |
- Apps Script ยังไม่ตรวจ `X-Line-Signature` (ข้อจำกัดของ Apps Script อ่าน header ไม่ได้) — ถ้าย้าย backend ควรเพิ่ม

## 8. ย้อนกลับเมื่อพัง
- Apps Script: Deploy → Manage deployments → Edit → เลือก Version ก่อนหน้า → Deploy
- เว็บ: อัป `index.html` เวอร์ชันก่อนหน้ากลับ (เก็บสำเนาไว้ทุกครั้ง)
- เช็กหลังแก้: เปิด `/exec` ต้องเห็น `[{...` · เปิดเว็บเติม `?v=ตัวเลข` ต้องเห็น `◉ LIVE`
