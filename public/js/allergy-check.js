// =====================================================================
// ระบบตรวจแพ้ยา (Allergy Check)
// ---------------------------------------------------------------------
// เทียบ "ประวัติแพ้ยา" ของผู้ป่วย (ข้อความอิสระที่พยาบาลพิมพ์ เช่น "แพ้ Ibuprofen (ผื่น)")
// กับ "ยาที่แพทย์สั่ง" โดยดูจาก 3 แหล่ง:
//   1. ชื่อยาภาษาไทย        เช่น "ไอบูโพรเฟน 200 มก."
//   2. ชื่อสามัญภาษาอังกฤษ   (medicines.generic_name) เช่น "ibuprofen"
//   3. กลุ่มยา              (medicines.drug_group)   เช่น "NSAIDs"
//
// ใช้ไฟล์เดียวกันทั้งฝั่งหน้าเว็บ (เตือนทันทีตอนเลือกยา) และฝั่งเซิร์ฟเวอร์
// (routes/visits.js ตรวจซ้ำก่อนบันทึก) ผลการตรวจทั้งสองฝั่งจึงตรงกันเสมอ
//
// หลักการ: "เตือนเกินดีกว่าพลาด" ถ้าเตือนแต่ไม่ได้แพ้จริง แพทย์กรอกเหตุผลแล้วสั่งต่อได้
// แต่ถ้าไม่เตือนแล้วผู้ป่วยแพ้จริง จะเป็นอันตราย
// =====================================================================

// ส่วนนี้ทำให้ไฟล์ใช้ได้ 2 แบบ (UMD pattern)
// - ใน Node.js (เซิร์ฟเวอร์ / เทสต์): require('../public/js/allergy-check')
// - ในเบราว์เซอร์: โหลดด้วย <script> แล้วเรียกผ่านตัวแปร AllergyCheck
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AllergyCheck = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // คำที่หมายถึง "ไม่มีประวัติแพ้" ถ้าเจอคำเหล่านี้จะไม่นับเป็นสิ่งที่แพ้
  // (NKDA = No Known Drug Allergies ศัพท์ทางการแพทย์ที่ใช้บ่อย)
  const NONE = ['-', '–', 'ไม่มี', 'ไม่แพ้', 'ไม่แพ้ยา', 'ไม่ทราบ', 'ปฏิเสธ', 'none', 'no', 'nkda', 'n/a'];

  // ความยาวขั้นต่ำของคำที่นำมาเทียบ
  // ป้องกันคำสั้น ๆ เช่น "ยา" หรือ "a" ไปตรงกับชื่อยาเกือบทุกตัวจนเตือนมั่ว
  // ถ้าต้องการให้เข้มขึ้น (เตือนผิดน้อยลง) ปรับเป็น 4 ได้
  const MIN_LENGTH = 3;

  // แปลงค่าเป็นข้อความตัวพิมพ์เล็กและตัดช่องว่างหัวท้าย
  // ทำให้ "Ibuprofen", "IBUPROFEN", " ibuprofen " ถือเป็นคำเดียวกัน
  // และกันค่า null/undefined ไม่ให้โปรแกรมพัง (กลายเป็นข้อความว่าง)
  function lower(value) {
    if (!value) {
      return '';
    }
    return String(value).trim().toLowerCase();
  }

  // -------------------------------------------------------------------
  // terms(): แยกประวัติแพ้ยาที่เป็นข้อความอิสระ ออกเป็นรายการคำที่จะนำไปเทียบ
  // ตัวอย่าง: "แพ้ Ibuprofen (ผื่น), Penicillin" -> ['ibuprofen', 'penicillin']
  // -------------------------------------------------------------------
  function terms(allergies) {
    // 1) ตัดข้อความในวงเล็บทิ้ง เพราะมักเป็นอาการ ไม่ใช่ชื่อยา เช่น "(ผื่น)"
    const text = lower(allergies).replace(/\([^)]*\)/g, ' ');
    // 2) แยกคำด้วยเครื่องหมาย , ; / | ขึ้นบรรทัดใหม่ หรือคำว่า "และ" / "หรือ"
    const pieces = text.split(/[,;\/\n\r|]+|\s+และ\s+|\s+หรือ\s+/);

    const result = [];
    for (const piece of pieces) {
      // 3) ตัดคำว่า "แพ้ยา" หรือ "แพ้" ที่นำหน้าออก เช่น "แพ้พารา" -> "พารา"
      const term = piece.replace(/^\s*(แพ้ยา|แพ้)\s*/, '').trim();
      // 4) ทิ้งคำที่สั้นเกินไป และคำที่แปลว่าไม่มีประวัติแพ้
      if (term.length >= MIN_LENGTH && !NONE.includes(term)) {
        result.push(term);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------
  // baseName(): เอาเฉพาะชื่อหลักของยา โดยตัดขนาดยาและรูปแบบยาออก
  // ตัดตั้งแต่ช่องว่างหรือตัวเลขตัวแรก
  // ตัวอย่าง: "ไอบูโพรเฟน 200 มก." -> "ไอบูโพรเฟน"
  //          "โคลไตรมาโซล ครีม 1%" -> "โคลไตรมาโซล"
  // -------------------------------------------------------------------
  function baseName(name) {
    return lower(name).split(/\s|\d/)[0];
  }

  // -------------------------------------------------------------------
  // namesOf(): รวมชื่อทั้งหมดของยาหนึ่งตัวที่ใช้เทียบ (ชื่อสามัญ + ชื่อไทยแบบตัดขนาด)
  // ตัวอย่าง: ไอบูโพรเฟน -> ['ibuprofen', 'ไอบูโพรเฟน']
  // ชื่อที่ว่างหรือสั้นกว่า MIN_LENGTH จะถูกทิ้ง (เช่น ยาที่ยังไม่ได้กรอกชื่อสามัญ)
  // -------------------------------------------------------------------
  function namesOf(medicine) {
    const names = [];
    const genericName = lower(medicine.generic_name);
    if (genericName.length >= MIN_LENGTH) {
      names.push(genericName);
    }
    const thaiName = baseName(medicine.name);
    if (thaiName.length >= MIN_LENGTH) {
      names.push(thaiName);
    }
    return names;
  }

  // -------------------------------------------------------------------
  // mentions(): เทียบแบบ "ข้อความหนึ่งอยู่ในอีกข้อความหนึ่ง" ได้ทั้งสองทาง
  // - ทาง 1: คำที่แพ้ มีชื่อยาอยู่ข้างใน
  //          "ibuprofen แล้วหน้าบวม" มี "ibuprofen"  -> ตรง
  // - ทาง 2: ชื่อยา มีคำที่แพ้อยู่ข้างใน (กรณีพยาบาลพิมพ์ชื่อย่อ)
  //          "พาราเซตามอล" มี "พารา"                 -> ตรง
  // หมายเหตุ: เพราะเทียบสองทาง ถ้าแก้ชื่อสามัญเป็นคำสั้นลง เช่น "ibupro"
  // ก็ยังตรงกับ "ibuprofen" อยู่ (เพราะ "ibupro" อยู่ในคำว่า "ibuprofen")
  // -------------------------------------------------------------------
  function mentions(term, name) {
    return term.includes(name) || name.includes(term);
  }

  // หาคำแรกในประวัติแพ้ ที่ตรงกับชื่อใดชื่อหนึ่งของยา (ไม่เจอคืน null)
  function findMatchingTerm(allergyTerms, medicine) {
    const names = namesOf(medicine);
    for (const term of allergyTerms) {
      for (const name of names) {
        if (mentions(term, name)) {
          return term;
        }
      }
    }
    return null;
  }

  // -------------------------------------------------------------------
  // check(): ตรวจยา 1 ตัว ว่าผู้ป่วยอาจแพ้หรือไม่
  //   allergies = ประวัติแพ้ยาของผู้ป่วย (ข้อความ)
  //   medicine  = ยาที่จะสั่ง {id, name, generic_name, drug_group}
  //   catalog   = รายการยาทั้งหมด ใช้หาว่ามียาตัวอื่นในกลุ่มเดียวกันที่ผู้ป่วยแพ้หรือไม่
  // คืนค่า:
  //   null                     = ไม่พบปัญหา
  //   {level: 'direct', ...}  = แพ้ยาตัวนี้โดยตรง (หน้าเว็บแสดงสีแดง)
  //   {level: 'group', ...}   = แพ้ยาในกลุ่มเดียวกัน (หน้าเว็บแสดงสีส้ม)
  // ตรวจตามลำดับ 3 ขั้น และหยุดทันทีเมื่อเจอขั้นใดขั้นหนึ่ง
  // -------------------------------------------------------------------
  function check(allergies, medicine, catalog) {
    const allergyTerms = terms(allergies);
    // ไม่มียา หรือผู้ป่วยไม่มีประวัติแพ้ -> ไม่ต้องตรวจต่อ
    if (!medicine || allergyTerms.length === 0) {
      return null;
    }

    // ขั้นที่ 1: แพ้ยาตัวนี้โดยตรง
    // เทียบทุกคำที่แพ้ กับทุกชื่อของยาตัวนี้ (ชื่อสามัญ + ชื่อไทย)
    // ตัวอย่าง: แพ้ "ibuprofen" แล้วสั่ง "ไอบูโพรเฟน 200 มก." (generic_name = ibuprofen)
    const directTerm = findMatchingTerm(allergyTerms, medicine);
    if (directTerm) {
      return { level: 'direct', term: directTerm, reason: 'ผู้ป่วยมีประวัติแพ้ "' + directTerm + '"' };
    }

    // ขั้นที่ 2 และ 3 ใช้กลุ่มยา ถ้ายาตัวนี้ไม่ได้ระบุกลุ่มยา ก็ข้ามไปเลย
    const group = lower(medicine.drug_group);
    if (group.length < MIN_LENGTH) {
      return null;
    }

    // ขั้นที่ 2: ประวัติแพ้ระบุชื่อกลุ่มยาตรง ๆ
    // ตัวอย่าง: ประวัติแพ้เขียนว่า "NSAIDs" แล้วสั่งยาที่อยู่กลุ่ม NSAIDs
    for (const term of allergyTerms) {
      if (mentions(term, group)) {
        return { level: 'group', term: term, reason: 'ผู้ป่วยแพ้ยากลุ่ม ' + medicine.drug_group };
      }
    }

    // ขั้นที่ 3: แพ้ยาตัวอื่นที่อยู่กลุ่มเดียวกัน (แพ้ข้ามกลุ่ม / cross-reactivity)
    // ตัวอย่าง: แพ้ "ibuprofen" แล้วสั่ง "naproxen" ซึ่งเป็น NSAIDs เหมือนกัน
    // วิธีทำ: ไล่ดูยาทุกตัวใน catalog ที่อยู่กลุ่มเดียวกัน แล้วเช็กว่าผู้ป่วยแพ้ตัวนั้นหรือไม่
    const otherMedicines = catalog || [];
    for (const other of otherMedicines) {
      // ข้ามยาตัวเดียวกัน และยาที่อยู่คนละกลุ่ม
      if (other.id === medicine.id || lower(other.drug_group) !== group) {
        continue;
      }
      const term = findMatchingTerm(allergyTerms, other);
      if (term) {
        return {
          level: 'group',
          term: term,
          reason: 'ผู้ป่วยแพ้ "' + term + '" ซึ่งอยู่กลุ่ม ' + medicine.drug_group + ' เดียวกัน',
        };
      }
    }

    // ผ่านทั้ง 3 ขั้น = ไม่พบความเสี่ยง
    return null;
  }

  // -------------------------------------------------------------------
  // conflicts(): ตรวจยาหลายตัวพร้อมกัน (ทั้งใบสั่งยา) คืนเฉพาะตัวที่มีปัญหา
  // ใช้ที่เซิร์ฟเวอร์ตอนแพทย์กดบันทึกการรักษา
  // ตัวอย่างผลลัพธ์:
  //   [{medicine_id: 2, name: 'ไอบูโพรเฟน 200 มก.', level: 'direct', term: 'ibuprofen', reason: '...'}]
  // ถ้าไม่ส่ง catalog มา จะใช้รายการยาในใบสั่งยาแทน
  // -------------------------------------------------------------------
  function conflicts(allergies, medicines, catalog) {
    const list = medicines || [];
    const found = [];
    for (const medicine of list) {
      const result = check(allergies, medicine, catalog || list);
      if (result) {
        found.push({
          medicine_id: medicine.id,
          name: medicine.name,
          level: result.level,
          term: result.term,
          reason: result.reason,
        });
      }
    }
    return found;
  }

  // ฟังก์ชันที่เปิดให้ไฟล์อื่นเรียกใช้
  return { terms: terms, check: check, conflicts: conflicts };
});
