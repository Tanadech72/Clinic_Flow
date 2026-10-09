const loginForm = document.getElementById('loginForm');
const message = document.getElementById('message');
const submitButton = loginForm.querySelector('button[type="submit"]');

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  message.textContent = '';
  message.className = '';
  submitButton.disabled = true;
  submitButton.textContent = 'กำลังเข้าสู่ระบบ...';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
    }

    localStorage.setItem('token', data.token);

    if (data.user) {
      localStorage.setItem('user', JSON.stringify(data.user));
    }

    message.textContent = 'เข้าสู่ระบบสำเร็จ';
    message.className = 'success';

    // เมื่อสร้างหน้า dashboard แล้วจะเปลี่ยนไปยังหน้านั้น
    window.location.href = data.user?.role === 'nurse' ? '/nurse.html' : '/doctor.html';
  } catch (error) {
    message.textContent = error.message;
    message.className = 'error';
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'เข้าสู่ระบบ';
  }
});
