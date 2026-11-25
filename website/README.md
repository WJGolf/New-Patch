# RAMFLOW Official Website

เว็บไซต์ทางการของ RAMFLOW: หน้าแรก · ดาวน์โหลด · ประวัติเวอร์ชัน · Changelog · FAQ/Help

- **Static site** (HTML/CSS/JS ล้วน ไม่มี framework ไม่มี npm dependency) → โหลดเร็ว, deploy บน **GitHub Pages** ฟรี
- **ข้อมูลเวอร์ชันมาจากของจริงเท่านั้น**: GitHub Releases ของ `WJGolf/New-Patch` (repo เดียวกับที่ RAMFLOW ADMIN เผยแพร่)
  + `releases.json` ที่ ADMIN ลงนามไว้ (ตรวจลายเซ็น ECDSA P-256 ด้วย public key เดียวกับ RAMFLOW USER)
- ไม่มีฐานข้อมูล ไม่มีระบบ Login ไม่มี token ในหน้าเว็บ

## ข้อมูลไหลอย่างไร

```
RAMFLOW ADMIN ── Publish ──► GitHub Release v<ver> (เลิกเป็น Draft) + ramflow-feed/releases.json (ลงนาม)
      │                                   │
      └── repository_dispatch ──► GitHub Actions "RAMFLOW Website" (ใน repo เดียวกัน)
                                          │  fetch-releases.mjs: อ่าน Releases + ตรวจลายเซ็น feed + กรองไฟล์
                                          │  build.mjs: สร้างหน้าเว็บ (pre-render ข้อมูลลง HTML → SEO)
                                          ▼
                                   GitHub Pages ── ผู้เข้าชม ── (เบราว์เซอร์ตรวจ GitHub API สดซ้ำทุก 5 นาที)
```

### กฎการแสดงผล (`src/assets/js/releases-core.js` ใช้ร่วมกันทั้งตอน build และในเบราว์เซอร์)
- แสดงเฉพาะ Release ที่ **Publish แล้ว**, tag รูปแบบ `v1.2.3` — ไม่แสดง Draft, ไม่แสดง Pre-release (เปิดได้ด้วย `"includePrereleases": true`), ไม่แสดง `ramflow-feed` / `ramflow-admin`
- แสดงเฉพาะไฟล์ของ RAMFLOW USER: `.msi` (Installer), `*-portable.zip` (Portable), `*setup*.exe` — ไม่แสดงไฟล์ ADMIN / UpdateServer / patch / json
- ไฟล์ต้องผ่านทุกข้อ ไม่งั้น **ไม่มีปุ่มดาวน์โหลด**: อัปโหลดเสร็จแล้ว · ลิงก์เป็น `https://github.com/<repo>/releases/download/<tag>/<file>` ตรงตัว · **ชื่อไฟล์ระบุเวอร์ชันตรงกับ Release** · SHA-256 และขนาดตรงกับ feed ที่ ADMIN ลงนาม (ถ้ามี)
- "เวอร์ชันล่าสุด" = เวอร์ชันสูงสุดที่มีไฟล์ผ่านการตรวจอย่างน้อย 1 ไฟล์
- Release Notes: จาก feed ที่ลงนาม (ภาษาไทยก่อน แล้วอังกฤษ) ถ้าไม่มีจึงใช้ข้อความของ GitHub Release (ยกเว้นข้อความ "Managed by RAMFLOW ADMIN.")
- feed ลายเซ็นไม่ผ่าน → ไม่ใช้ข้อมูลจาก feed เลย (ยังแสดงข้อมูลจาก GitHub ได้)

### อัปเดตอัตโนมัติ / Rate limit / Error
- Workflow ทำงานเมื่อ: ADMIN Publish/Withdraw/เปลี่ยน catalog (repository_dispatch) · มีคน Publish/Unpublish บน GitHub เอง · แก้ source เว็บ · ทุก 6 ชั่วโมง · กดเองที่ Actions
- Build ใช้ `GITHUB_TOKEN` ของ workflow (ฝั่งเซิร์ฟเวอร์เท่านั้น) → ไม่ติด rate limit; ถ้าอ่าน GitHub ไม่ได้ build จะ **ล้มเหลวและเว็บเดิมยังอยู่** (ไม่ deploy หน้าว่าง)
- เบราว์เซอร์: แสดงข้อมูลที่ build ไว้ทันที แล้วเช็ก `api.github.com` แบบไม่ใช้ token (cache ใน localStorage 5 นาที + ETag → คำตอบ 304 ไม่นับโควตา); ถ้าโดน rate limit/ออฟไลน์ จะแสดงข้อมูลเดิมพร้อมบอกเวลา
- มี Loading state (สถานะ "กำลังตรวจ…"), Error state (ปุ่มลองใหม่ + ลิงก์ GitHub), Empty state ("ยังไม่มีเวอร์ชันที่เผยแพร่")
- Download progress: ไฟล์ดาวน์โหลดตรงจาก GitHub (ข้ามโดเมน) หน้าเว็บจึงอ่านความคืบหน้าไม่ได้ — แสดงแผงบอกชื่อไฟล์/ขนาด/SHA-256 และให้ดูความคืบหน้าในแถบดาวน์โหลดของเบราว์เซอร์

## คำสั่ง

```powershell
cd Website
node scripts/fetch-releases.mjs      # ดึงข้อมูลจริงจาก GitHub → .cache/releases.json
node scripts/build.mjs               # สร้างเว็บ → dist/
node scripts/serve.mjs               # ดูตัวอย่างที่ http://localhost:4173/
node --test tests/*.test.mjs         # ทดสอบ (มีเทสต์ที่ต่อ GitHub จริง; ปิดด้วย $env:RAMFLOW_SKIP_LIVE=1)
node scripts/browser-check.mjs       # ทดสอบบน Chrome/Edge จริง (desktop/tablet/mobile) + ภาพหน้าจอ (ต้องเปิด serve ไว้)
```

## Deploy (GitHub Pages)

```powershell
.\Website\deploy\Publish-Website.ps1            # ค่าเริ่มต้น -Repo WJGolf/New-Patch
```
สคริปต์จะ: รันเทสต์ → เปิด GitHub Pages (source = GitHub Actions) → คัดลอก `Website\` ไปที่โฟลเดอร์ `website/` และ workflow ไปที่ `.github/workflows/ramflow-website.yml` ใน repo → commit/push → รอ deploy เสร็จ → พิมพ์ URL
(ไม่แตะ Releases/Tags เดิม · ใช้ login ของ `gh` ไม่มี token ในไฟล์ใด ๆ)

URL จะเป็น `https://wjgolf.github.io/New-Patch/` (ใช้โดเมนของตัวเองได้: GitHub → Settings → Pages → Custom domain แล้ว deploy ใหม่ — canonical/sitemap จะเปลี่ยนตามเอง)

หมายเหตุ: GitHub ปิด schedule ของ repo สาธารณะที่ไม่มีความเคลื่อนไหว 60 วัน — การ Publish ผ่าน ADMIN ยังสั่ง rebuild ได้ตามปกติ

## เผยแพร่เวอร์ชันใหม่ผ่าน ADMIN (เว็บอัปเดตเอง ไม่ต้องอัปโหลดซ้ำ)

1. RAMFLOW ADMIN → **Create New Version** (build + ตรวจ + แพ็กเกจ + manifest/SHA-256)
2. ใส่ **Release notes** (ไทย/อังกฤษ) — เขียนเป็นหมวดเพื่อให้ Changelog แยกหัวข้อให้:
   ```
   ฟีเจอร์ใหม่:
   - ...
   ปรับปรุง:
   - ...
   แก้ไข:
   - ...
   ความปลอดภัย:
   - ...
   ```
   (ใช้ภาษาอังกฤษได้: `New Features:` `Improvements:` `Fixed:` `Security:` หรือ `## Fixed`, หรือขึ้นต้นบรรทัด `Fixed: ...`, `[New] ...`; บรรทัดที่ไม่อยู่ในหมวดจะอยู่ใน "รายละเอียด")
3. **Upload** ไฟล์ (.msi / portable .zip) → **Publish** (ใส่ passphrase ของ signing key)
4. ADMIN จะเปิด Release บน GitHub, อัปโหลด feed ที่ลงนาม แล้วส่งคำสั่งให้เว็บ rebuild (ดูใน ADMIN Logs: "Website rebuild requested")
5. ประมาณ 1–2 นาทีเว็บจะแสดงเวอร์ชันใหม่ (ระหว่างนั้นเบราว์เซอร์ของผู้ใช้ก็เห็นจากการเช็ก GitHub สด)
- **Withdraw** ใน ADMIN → Release กลับเป็น Draft → หายจากเว็บในการ build ถัดไป (และจากการเช็กสดในเบราว์เซอร์)
- ไฟล์ต้องชื่อขึ้นต้นด้วย `RAMFLOW-<เวอร์ชัน>-...` (build-release.ps1 ตั้งให้อยู่แล้ว) — ถ้าเวอร์ชันในชื่อไฟล์ไม่ตรงกับ Release เว็บจะไม่แสดงปุ่มดาวน์โหลด

## เปลี่ยนโลโก้ / เพิ่มเนื้อหา

| ต้องการ | แก้ไฟล์ |
|---|---|
| โลโก้ (เมนู, footer, ไอคอนแท็บ) | แทนที่ `src/assets/img/logo.png` (สี่เหลี่ยมจัตุรัส ≥ 256px) และ `src/assets/img/favicon.ico` |
| ภาพแชร์โซเชียล (Open Graph) | แก้ `tools/og-image.html` (+ `tools/logo.png`) แล้วเรนเดอร์: `& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --window-size=1200,630 --screenshot="$PWD\src\assets\img\og-image.png" "file:///$PWD/tools/og-image.html"` |
| คำถามที่พบบ่อย | `content/faq.json` (id, question, answer เป็น HTML ง่าย ๆ) |
| ภาพหน้าจอจริงของโปรแกรม | วางไฟล์ใน `src/assets/screenshots/` แล้วเพิ่มรายการใน `content/screenshots.json` (หน้าแรกจะมีส่วน "หน้าตาของ RAMFLOW") |
| ข้อความหน้าต่าง ๆ | `src/pages/*.html` · ส่วนหัว/ท้ายทุกหน้า `src/partials/layout.html` |
| สี/ดีไซน์ | ตัวแปรสีบนสุดของ `src/assets/css/site.css` (ตรงกับธีม Dark ของแอป) |
| Repo, ลิงก์แจ้งปัญหา, Pre-release | `site.config.json` (`githubRepo`, `supportUrl`, `includePrereleases`) |
| Title/Description (SEO) ของแต่ละหน้า | `PAGES` ใน `scripts/build.mjs` |

แก้แล้วรัน `node scripts/build.mjs` เพื่อดูในเครื่อง และ `.\Website\deploy\Publish-Website.ps1` เพื่อขึ้นเว็บจริง

## ความปลอดภัย
- ไม่มี GitHub token / secret ในหน้าเว็บ (เทสต์ `build-output.test.mjs` และสคริปต์ deploy ตรวจซ้ำ)
- มีแค่ **public key** (`keys/update-public-key.pem`, ชุดเดียวกับใน RAMFLOW USER) ไว้ตรวจลายเซ็น feed
- Content-Security-Policy: สคริปต์/สไตล์จากเว็บตัวเองเท่านั้น, เชื่อมต่อออกได้เฉพาะ `api.github.com`
- ข้อมูลจาก Draft ไม่ถูกใช้แม้ token ของ workflow จะมองเห็น (เทสต์ด้วย token ที่เห็น Draft จริงแล้ว)

ถ้าเปลี่ยน signing key ใน ADMIN ต้องคัดลอก public key ใหม่มาที่ `keys/update-public-key.pem` ด้วย (ไม่งั้น feed จะตรวจไม่ผ่านและเว็บจะไม่มี Release Notes)
