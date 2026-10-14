// หน้าบัญชีของฉัน (account.html) ใช้ได้ทุกบทบาท: ดูข้อมูลบัญชี และเปลี่ยนรหัสผ่านของตัวเอง

(function () {
  const token = localStorage.getItem('token');
  const message = document.getElementById('message');

  // ชื่อบทบาทภาษาไทย
  function roleLabel(role) {
    if (role === 'admin') {
      return 'เจ้าของคลินิก';
    }
    if (role === 'doctor') {
      return 'แพทย์';
    }
    if (role === 'nurse') {
      return 'พยาบาล';
    }
    return role;
  }

  // แสดงข้อความผลลัพธ์ใต้ฟอร์ม (สีเขียวเมื่อสำเร็จ สีแดงเมื่อผิดพลาด)
  function showMessage(state, text) {
    message.dataset.state = state;
    message.textContent = text;
  }

  // เรียก API พร้อมแนบ token ถ้า token หมดอายุหรือบัญชีถูกปิด (401) จะกลับหน้า login
  async function callApi(url, method, body) {
    const options = {
      method: method || 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    const data = await res.json();
    if (res.status === 401) {
      localStorage.clear();
      location.replace('/');
      throw new Error(data.message);
    }
    if (!res.ok) {
      throw new Error(data.message || 'ดำเนินการไม่สำเร็จ');
    }
    return data;
  }

  // ออกจากระบบ: ลบ token ในเบราว์เซอร์แล้วกลับหน้า login
  document.getElementById('logout').addEventListener('click', function () {
    localStorage.clear();
    location.href = '/';
  });

  // สร้างเมนูด้านซ้ายตามบทบาท
  function buildMenu(user) {
    const isNurse = user.role === 'nurse';
    let html = '';
    if (isNurse) {
      html += '<a href="/nurse.html">คิวตรวจและจ่ายยา</a>';
    } else {
      html += '<a href="/doctor.html">ห้องตรวจแพทย์</a>';
    }
    html += '<a href="/patients.html">ข้อมูลผู้ป่วย</a>';
    html += '<a href="/records.html">ประวัติการรักษา</a>';
    html += '<a href="/inventory.html">คลังยา</a>';
    if (!isNurse) {
      html += '<a href="/dashboard.html">ภาพรวมคลินิก</a>';
    }
    if (user.role === 'admin') {
      html += '<a href="/users.html">บัญชีผู้ใช้งาน</a>';
    }
    html += '<a class="active" aria-current="page" href="/account.html">บัญชีของฉัน</a>';
    // ใส่เมนูต่อจากชื่อบทบาท (ก่อนข้อความท้ายแถบเมนู)
    document.getElementById('navRole').insertAdjacentHTML('afterend', html);
  }

  // เมื่อเปิดหน้า: โหลดข้อมูลบัญชีปัจจุบัน แล้วแสดงในหน้าและสร้างเมนู
  async function loadAccount() {
    if (!token) {
      location.replace('/');
      return;
    }
    try {
      const data = await callApi('/api/auth/me');
      const user = data.user;
      document.getElementById('profileName').textContent = user.full_name || '-';
      document.getElementById('profileUsername').textContent = user.username;
      document.getElementById('profileRole').textContent = roleLabel(user.role);
      document.getElementById('navRole').textContent = roleLabel(user.role);
      buildMenu(user);
    } catch (err) {
      showMessage('error', err.message);
    }
  }

  // เปลี่ยนรหัสผ่าน: ตรวจว่ารหัสใหม่กับช่องยืนยันตรงกันก่อนส่ง
  document.getElementById('passwordForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.target;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    if (newPassword !== confirmPassword) {
      showMessage('error', 'รหัสผ่านใหม่และการยืนยันไม่ตรงกัน');
      return;
    }

    // ปิดปุ่มระหว่างรอผล กันกดซ้ำ
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    message.textContent = '';
    try {
      const result = await callApi('/api/auth/me/password', 'PUT', {
        current_password: document.getElementById('currentPassword').value,
        new_password: newPassword,
      });
      // สำเร็จ -> ล้างช่องรหัสผ่านทั้งหมด แล้วแสดงข้อความสีเขียว
      form.reset();
      showMessage('success', result.message);
    } catch (err) {
      showMessage('error', err.message);
    } finally {
      button.disabled = false;
    }
  });

  loadAccount();
})();
