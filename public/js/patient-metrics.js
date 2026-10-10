// ฟังก์ชันคำนวณข้อมูลร่างกายผู้ป่วย: อายุจากวันเกิด, BMI และตรวจค่าน้ำหนัก/ส่วนสูง

// UMD pattern: ใช้ได้ทั้งใน Node.js (require) และในเบราว์เซอร์ (ตัวแปร PatientMetrics)
// เซิร์ฟเวอร์และหน้าเว็บจึงคำนวณอายุ/BMI ด้วยสูตรเดียวกัน
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PatientMetrics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // วันที่ปัจจุบันตามเวลาประเทศไทย ในรูปแบบ YYYY-MM-DD
  function today() {
    return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
  }
  // คำนวณอายุเต็มปีจากวันเกิด
  // คืน null ถ้าไม่มีวันเกิด รูปแบบผิด วันที่ไม่มีจริง (เช่น 31 ก.พ.) หรือเป็นวันในอนาคต
  function age(dateOfBirth, referenceDate = today()) {
    if (!dateOfBirth) return null;
    const dob = String(dateOfBirth).split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || dob > referenceDate) return null;
    const [year, month, day] = dob.split('-').map(Number);
    // ตรวจว่าเป็นวันที่ที่มีอยู่จริง (Date จะเลื่อนวันที่เกินไปเป็นเดือนถัดไป จึงเทียบกลับ)
    const parsed = new Date(0); parsed.setUTCFullYear(year, month - 1, day); parsed.setUTCHours(0,0,0,0);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
    const [currentYear, currentMonth, currentDay] = referenceDate.split('-').map(Number);
    // ลบ 1 ถ้าปีนี้ยังไม่ถึงวันเกิด
    return currentYear - year - (currentMonth < month || (currentMonth === month && currentDay < day) ? 1 : 0);
  }
  // คำนวณ BMI = น้ำหนัก(กก.) / ส่วนสูง(ม.)² ปัดทศนิยม 1 ตำแหน่ง คืน null ถ้าข้อมูลไม่ครบหรือไม่ถูกต้อง
  function bmi(weight, height) {
    const kg = Number(weight), cm = Number(height);
    if (!Number.isFinite(kg) || !Number.isFinite(cm) || kg <= 0 || cm <= 0) return null;
    const result = kg / ((cm / 100) ** 2);
    return Number.isFinite(result) ? Number(result.toFixed(1)) : null;
  }
  // ตรวจค่าน้ำหนัก/ส่วนสูงที่กรอก: ว่างได้ (คืน null) ถ้ามีค่าต้องเป็นตัวเลขมากกว่า 0
  // ไม่เกินค่าสูงสุด และทศนิยมไม่เกิน 2 ตำแหน่ง ถ้าไม่ผ่านจะ throw error
  function measurement(value, max) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'number' && typeof value !== 'string') throw Error('กรุณากรอกน้ำหนักหรือส่วนสูงเป็นตัวเลข');
    if (typeof value === 'string' && !value.trim()) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > max || Math.abs(number * 100 - Math.round(number * 100)) > 0.000001) {
      throw Error('น้ำหนักและส่วนสูงต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง');
    }
    return number;
  }
  return {today, age, bmi, measurement};
});
