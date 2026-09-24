# FinderOV.70

FINDER — ระบบค้นหาข้อมูลบุคคล (OV70) จาก Google Sheet ใช้งานผ่านกลุ่ม LINE

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `index.html` | เว็บแอปที่ใช้งานจริง (bundle ไฟล์เดียว) — GitHub Pages เสิร์ฟไฟล์นี้ |
| `source/People Finder App.dc.html` | ซอร์สหลักของเว็บแอป (UI + logic) |
| `line-bot.gs` | Apps Script: `doGet` (JSON ให้เว็บ) + `doPost` (LINE webhook) + `notifyBirthdays` |
| `HANDOFF.md` | เอกสารส่งมอบ: ภาพรวมระบบ, CONFIG, การย้าย server, ความปลอดภัย |
| `README-setup.md` | คู่มือตั้งค่า Sheet / Apps Script / LIFF |
