// หน้าเข้าสู่ระบบ (index.html)
// ส่งชื่อผู้ใช้/รหัสผ่านไปที่ API แล้วพาไปหน้าทำงานตามบทบาท (พยาบาล -> nurse.html, อื่น ๆ -> doctor.html)

const loginForm = document.getElementById('loginForm');
const message = document.getElementById('message');
const submitButton = loginForm.querySelector('button[type="submit"]');

// เมื่อกดปุ่มเข้าสู่ระบบ
loginForm.addEventListener('submit', async (event) => {
  // หยุดไม่ให้ฟอร์มรีโหลดหน้า แล้วส่งข้อมูลด้วย fetch แทน
  event.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  message.textContent = '';
  message.className = '';
  // ปิดปุ่มชั่วคราว กันกดซ้ำระหว่างรอผล
  submitButton.disabled = true;
  submitButton.textContent = 'กำลังเข้าสู่ระบบ...';

  try {
    // ส่งชื่อผู้ใช้และรหัสผ่านไปตรวจที่เซิร์ฟเวอร์
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    // รหัสสถานะไม่ใช่ 2xx (เช่น 401 รหัสผิด) -> โยน error ไปแสดงใน catch
    if (!response.ok) {
      throw new Error(data.message || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
    }

    // เก็บ token ไว้ในเบราว์เซอร์ หน้าอื่นจะใช้ token นี้เรียก API
    localStorage.setItem('token', data.token);

    // เก็บข้อมูลผู้ใช้ (ชื่อ บทบาท) ไว้แสดงผลในหน้าอื่น
    if (data.user) {
      localStorage.setItem('user', JSON.stringify(data.user));
    }

    message.textContent = 'เข้าสู่ระบบสำเร็จ';
    message.className = 'success';

    // ไปหน้าทำงานตามบทบาท: พยาบาล -> หน้าคิวพยาบาล, แพทย์และเจ้าของคลินิก -> ห้องตรวจแพทย์
    window.location.href = data.user?.role === 'nurse' ? '/nurse.html' : '/doctor.html';
  } catch (error) {
    // แสดงข้อความ error สีแดงใต้ฟอร์ม
    message.textContent = error.message;
    message.className = 'error';
  } finally {
    // คืนสถานะปุ่มเสมอ ไม่ว่าสำเร็จหรือไม่
    submitButton.disabled = false;
    submitButton.textContent = 'เข้าสู่ระบบ';
  }
});
