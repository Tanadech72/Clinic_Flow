# Clinic Flow — Backend API

ระบบจัดการคลินิก: ผู้ป่วย, ประวัติการรักษา, สต๊อกยา, ผู้ใช้งาน/สิทธิ์, และ Dashboard

## เทคโนโลยีที่ใช้
- Node.js + Express
- MySQL (mysql2)
- JWT สำหรับ Authentication
- bcryptjs สำหรับเข้ารหัสรหัสผ่าน

## โครงสร้างโปรเจกต์
```
clinic-flow/
├── config/
│   └── db.js               # การเชื่อมต่อฐานข้อมูล MySQL
├── middleware/
│   └── auth.js             # ตรวจสอบ JWT และสิทธิ์ผู้ใช้ (role-based)
├── routes/
│   ├── auth.js              # login, สร้างผู้ใช้งาน
│   ├── patients.js          # CRUD + ค้นหาผู้ป่วย
│   ├── records.js           # ประวัติการรักษา
│   ├── visits.js            # คิวตรวจ: บันทึกก่อนตรวจ → หมอสั่งยา → พยาบาลจ่ายยา
│   ├── medicines.js         # จัดการยา + สต๊อก
│   └── dashboard.js         # สรุปข้อมูลภาพรวม
├── public/                  # Frontend (HTML/CSS/JS) เสิร์ฟโดย Express
│   ├── index.html           # หน้าเข้าสู่ระบบ
│   ├── doctor.html          # หน้าหมอ: ตรวจ วินิจฉัย สั่งยา
│   ├── nurse.html           # หน้าพยาบาล: บันทึกก่อนตรวจ จ่ายยา
│   ├── patients.html        # ข้อมูลผู้ป่วย
│   ├── records.html         # ประวัติการรักษา
│   ├── inventory.html       # สต๊อกยา
│   ├── dashboard.html       # ภาพรวมคลินิก
│   ├── users.html           # จัดการบัญชีผู้ใช้ (เฉพาะเจ้าของคลินิก)
│   ├── account.html         # บัญชีของฉัน / เปลี่ยนรหัสผ่าน
│   ├── css/
│   └── js/
├── migrations/
│   ├── workflow.sql         # ตารางคิว clinic_visits
│   └── patient-hn.sql       # รหัส HN อัตโนมัติ
├── data/
│   └── starter-medicines.json  # รายการยาเริ่มต้น
├── tests/                   # เทสต์ (node --test)
├── scripts/                 # สคริปต์ช่วยงาน UI (apply-ui, preview-ui)
├── artifacts/ui/            # ภาพหน้าจอ UI
├── schema.sql               # คำสั่งสร้างฐานข้อมูลทั้งหมด
├── migrate.js               # อัปเกรดฐานข้อมูลเดิม (npm run migrate)
├── seed.js                  # สคริปต์สร้างผู้ใช้ admin เริ่มต้น
├── seed-medicines.js        # เพิ่มรายการยาเริ่มต้น (npm run seed:medicines)
├── set-medicine-prices.js   # ตั้งราคายาตัวอย่าง
├── server.js                # จุดเริ่มต้นแอปพลิเคชัน
└── .env.example
```

ดูรายละเอียดขั้นตอนการทำงานของหมอและพยาบาลได้ที่ [WORKFLOW.md](WORKFLOW.md)

## วิธีติดตั้งและรัน

### 1. ติดตั้ง dependencies
```bash
npm install
```

### 2. ตั้งค่า environment variables
```bash
cp .env.example .env
```
แล้วแก้ค่า `DB_PASSWORD`, `JWT_SECRET` ให้ตรงกับเครื่องของคุณ (`JWT_SECRET` ควรเป็นข้อความสุ่มยาว ๆ และห้าม commit ไฟล์ `.env`)

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|
| `DB_HOST` | `localhost` | โฮสต์ MySQL |
| `DB_USER` | `root` | ผู้ใช้ MySQL |
| `DB_PASSWORD` | (ว่าง) | รหัสผ่าน MySQL |
| `DB_NAME` | `clinic_flow` | ชื่อฐานข้อมูล |
| `DB_PORT` | `3306` | พอร์ต MySQL |
| `PORT` | `3000` | พอร์ตของเซิร์ฟเวอร์ |
| `JWT_SECRET` | — | คีย์สำหรับเซ็น token (จำเป็น) |
| `JWT_EXPIRES_IN` | `8h` | อายุของ token |

### 3. ตั้งค่าฐานข้อมูล
**ฐานข้อมูลใหม่:** สร้างฐานข้อมูล `clinic_flow` พร้อมตารางทั้งหมดด้วย schema.sql
```bash
mysql -u root -p < schema.sql
```

**ฐานข้อมูลเดิม (เวอร์ชันก่อนมีระบบคิว/HN):** รัน migration แทน ข้อมูลเดิมจะไม่ถูกลบ
```bash
npm run migrate
```

### 4. สร้างผู้ใช้ admin เริ่มต้น
```bash
node seed.js admin "Admin@123" "ผู้ดูแลระบบ"
```
ควรเปลี่ยนรหัสผ่านหลังเข้าสู่ระบบครั้งแรก

### 5. เพิ่มรายการยาเริ่มต้น (ไม่บังคับ)
```bash
npm run seed:medicines       # เพิ่มยาจาก data/starter-medicines.json (สต๊อก 0, ราคา 0; ข้ามยาที่มีอยู่แล้ว)
node set-medicine-prices.js  # ตั้งราคาตัวอย่าง (บาท/หน่วย) เฉพาะยาที่ราคายังเป็น 0
```
รายละเอียดรายการยาดูได้ที่ [data/STARTER-MEDICINES.md](data/STARTER-MEDICINES.md)

### 6. รันเซิร์ฟเวอร์
```bash
npm run dev     # โหมดพัฒนา (auto-reload ด้วย nodemon)
# หรือ
npm start       # โหมดปกติ
```

เปิดเบราว์เซอร์ที่ `http://localhost:3000` แล้วเข้าสู่ระบบด้วยบัญชี admin จากนั้นสร้างบัญชีหมอ/พยาบาลได้ที่หน้า `/users.html`

## หน้าจอตามบทบาท

| บทบาท | หน้าหลัก | สิ่งที่ทำได้ |
|---|---|---|
| admin (เจ้าของคลินิก) | `/doctor.html` | ทุกอย่างที่หมอทำได้ และจัดการบัญชีผู้ใช้ (สร้าง แก้ไข รีเซ็ตรหัสผ่าน ปิด/เปิดบัญชี) |
| doctor | `/doctor.html` | ตรวจ วินิจฉัย สั่งยา ดูภาพรวมคลินิก |
| nurse | `/nurse.html` | ลงทะเบียนผู้ป่วย บันทึกก่อนตรวจ จ่ายยาและตัดสต๊อก |

ทุกบทบาทเข้าถึงหน้าผู้ป่วย ประวัติการรักษา สต๊อกยา และเปลี่ยนรหัสผ่านตัวเองที่ `/account.html` ได้ บัญชีที่ถูกปิดจะใช้งานไม่ได้ทันที แม้ token เดิมยังไม่หมดอายุ

## การทดสอบ
```bash
npm test
```
เทสต์ใช้ฐานข้อมูลจำลอง ไม่ต้องเชื่อมต่อ MySQL ครอบคลุมสิทธิ์ตามบทบาท ขั้นตอนตรวจรักษา/จ่ายยา และการคำนวณอายุ/BMI

## สรุป API Endpoints

| Method | Endpoint | คำอธิบาย | สิทธิ์ |
|---|---|---|---|
| POST | `/api/auth/login` | เข้าสู่ระบบ | ทุกคน |
| GET | `/api/auth/users` | รายชื่อบัญชีผู้ใช้ทั้งหมด | admin |
| POST | `/api/auth/users` | สร้างบัญชีแพทย์หรือพยาบาล | admin |
| PUT | `/api/auth/users/:id` | แก้ไขชื่อและบทบาท | admin |
| PATCH | `/api/auth/users/:id/status` | ปิด/เปิดการใช้งานบัญชี (ไม่มีการลบบัญชี) | admin |
| POST | `/api/auth/users/:id/reset-password` | ตั้งรหัสผ่านใหม่ให้ผู้ใช้ | admin |
| GET | `/api/auth/me` | ดูข้อมูลผู้ใช้ปัจจุบัน | ผู้ล็อกอิน |
| PUT | `/api/auth/me/password` | เปลี่ยนรหัสผ่านของตัวเอง | ผู้ล็อกอิน |
| GET | `/api/patients` | ค้นหา/ดูรายชื่อผู้ป่วย | ผู้ล็อกอิน |
| GET | `/api/patients/:id` | ดูข้อมูลผู้ป่วยรายบุคคล | ผู้ล็อกอิน |
| POST | `/api/patients` | เพิ่มผู้ป่วยใหม่ | admin, doctor, nurse |
| PUT | `/api/patients/:id` | แก้ไขข้อมูลผู้ป่วย | admin, doctor, nurse |
| GET | `/api/records/patient/:patientId` | ดูประวัติการรักษาของผู้ป่วย | ผู้ล็อกอิน |
| GET | `/api/visits` | คิวรอตรวจ รอจ่ายยา และเสร็จสิ้นวันนี้ | admin, doctor, nurse |
| POST | `/api/visits` | บันทึกอาการและสัญญาณชีพ ส่งเข้าคิวตรวจ | nurse |
| POST | `/api/visits/:id/treatment` | วินิจฉัยและสั่งยา ส่งต่อพยาบาล (ยังไม่ตัดสต๊อก) | admin, doctor |
| POST | `/api/visits/:id/dispense` | ยืนยันจ่ายยา ตัดสต๊อก และปิดคิว | nurse |
| GET | `/api/medicines` | ดูรายการยา/ค้นหา/กรองยาใกล้หมด | ผู้ล็อกอิน |
| POST | `/api/medicines` | เพิ่มยาใหม่ | admin, doctor, nurse |
| PUT | `/api/medicines/:id` | แก้ไขข้อมูลยา | admin, doctor, nurse |
| POST | `/api/medicines/:id/stock-in` | รับยาเข้าสต๊อก | admin, doctor, nurse |
| GET | `/api/medicines/:id/transactions` | ประวัติการเคลื่อนไหวสต๊อก | ผู้ล็อกอิน |
| GET | `/api/dashboard` | สรุปข้อมูลภาพรวมคลินิก | ผู้ล็อกอิน |

## ตัวอย่างการเรียกใช้ (ผ่าน Postman หรือ curl)

**Login:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123"}'
```

**เรียก API ที่ต้อง login (แนบ token ที่ได้จาก login):**
```bash
curl http://localhost:3000/api/patients \
  -H "Authorization: Bearer <TOKEN>"
```

## ขั้นตอนถัดไปที่แนะนำ
- ออกแบบ ER Diagram ให้ตรงกับ schema.sql
- เพิ่ม validation ที่ละเอียดขึ้น (เช่นด้วย Joi หรือ express-validator)
- เพิ่ม integration test กับฐานข้อมูล MySQL จริง
- ทำ rate limiting (โดยเฉพาะ `/api/auth/login`) และ logging สำหรับ production
- จำกัด CORS เฉพาะโดเมนที่ใช้งานจริง และไม่ส่งรายละเอียด error ภายในกลับไปให้ client
