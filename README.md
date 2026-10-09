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
│   ├── records.js           # ประวัติการรักษา + สั่งจ่ายยา
│   ├── medicines.js         # จัดการยา + สต๊อก
│   └── dashboard.js         # สรุปข้อมูลภาพรวม
├── schema.sql               # คำสั่งสร้างฐานข้อมูลทั้งหมด
├── seed.js                  # สคริปต์สร้างผู้ใช้ admin เริ่มต้น
├── server.js                # จุดเริ่มต้นแอปพลิเคชัน
└── .env.example
```

## วิธีติดตั้งและรัน

### 1. ติดตั้ง dependencies
```bash
npm install
```

### 2. ตั้งค่าฐานข้อมูล
สร้างฐานข้อมูลด้วยไฟล์ schema.sql:
```bash
mysql -u root -p < schema.sql
```

### 3. ตั้งค่า environment variables
```bash
cp .env.example .env
```
แล้วแก้ค่า `DB_PASSWORD`, `JWT_SECRET` ให้ตรงกับเครื่องของคุณ

### 4. สร้างผู้ใช้ admin เริ่มต้น
```bash
node seed.js admin "Admin@123" "ผู้ดูแลระบบ"
```

### 5. รันเซิร์ฟเวอร์
```bash
npm run dev     # โหมดพัฒนา (auto-reload ด้วย nodemon)
# หรือ
npm start       # โหมดปกติ
```

เซิร์ฟเวอร์จะรันที่ `http://localhost:3000`

## สรุป API Endpoints

| Method | Endpoint | คำอธิบาย | สิทธิ์ |
|---|---|---|---|
| POST | `/api/auth/login` | เข้าสู่ระบบ | ทุกคน |
| POST | `/api/auth/users` | สร้างบัญชีหมอหรือพยาบาล | admin, doctor |
| GET | `/api/auth/me` | ดูข้อมูลผู้ใช้ปัจจุบัน | ผู้ล็อกอิน |
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
- ออกแบบ ER Diagram ให้ตรงกับ schema.sql (แจ้งได้หากต้องการให้ช่วยทำ)
- เชื่อมต่อ Frontend (เช่น React) เข้ากับ API ชุดนี้
- เพิ่ม validation ที่ละเอียดขึ้น (เช่นด้วย Joi หรือ express-validator)
- เพิ่ม unit test / integration test
- ทำ rate limiting และ logging สำหรับ production

# Clinic_Flow
7ad86bd4ed7350915492d00592ad4d316d814e90
