// สคริปต์ตรวจหน้าเว็บอัตโนมัติด้วย Chrome แบบไม่มีหน้าต่าง และถ่ายภาพหน้าจอเก็บไว้ที่ artifacts/ui/
// ต้องเปิดเซิร์ฟเวอร์ไว้ที่ http://localhost:3000 ก่อน
// วิธีใช้: node scripts/preview-ui.js

const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// เปิด Chrome แบบไม่มีหน้าต่าง (headless) ด้วยโปรไฟล์ชั่วคราว แล้วควบคุมผ่าน DevTools Protocol
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-ui-preview-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, 'about:blank'], {windowsHide:true, stdio:'ignore'});
let socket;
const keepAlive = setInterval(() => {}, 1000);
// ถ้าทำงานเกิน 45 วินาที ให้หยุดและถือว่าล้มเหลว
const deadline = setTimeout(() => { console.error('Preview timed out'); process.exitCode=1; if(socket)socket.close(); chrome.kill(); clearInterval(keepAlive); }, 45000);
(async () => {
  try {
    let target;
    // รอจน Chrome พร้อม แล้วเปิดแท็บใหม่
    for (let i=0;i<40;i++) {
      try { target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', {method:'PUT'})).json(); break; } catch { await delay(250); }
    }
    if (!target) throw Error('Headless browser did not start');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject) => { socket.onopen=resolve; socket.onerror=reject; });
    let serial=0; const pending=new Map(); const errors=[];
    // รับข้อความจาก Chrome: เก็บ error ของ JavaScript ในหน้า และส่งผลลัพธ์คืนให้คำสั่งที่รออยู่
    socket.onmessage = event => {
      const message=JSON.parse(event.data);
      if (message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      if (message.id) { const callbacks=pending.get(message.id); if(!callbacks)return; pending.delete(message.id); message.error ? callbacks.reject(Error(message.error.message)) : callbacks.resolve(message.result); }
    };
    // ส่งคำสั่งไปที่ Chrome แล้วรอผล
    const send=(method,params={}) => new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    await send('Page.enable'); await send('Runtime.enable');
    fs.mkdirSync('artifacts/ui',{recursive:true});
    const results=[];
    // วนเปิดแต่ละหน้า ตามบทบาท และความกว้างจอ (1440 = คอม, 390 = มือถือ)
    for (const [page,role,width] of [['users','admin',1440],['dashboard','admin',1440],['doctor','admin',1440],['nurse','nurse',1440],['users','admin',390],['nurse','nurse',390],['patients','nurse',1440],['patients','nurse',390],['inventory','nurse',390]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
      await send('Page.navigate',{url:'http://localhost:3000/'}); await delay(400);
      const user={id:role==='nurse'?2:1,role,username:role,full_name:role==='nurse'?'พยาบาล':'เจ้าของคลินิก'};
      // สร้าง token ให้ล็อกอินอัตโนมัติ (ต้องมีบัญชี id 1 = admin และ id 2 = พยาบาล ในฐานข้อมูล)
      const token=jwt.sign(user,process.env.JWT_SECRET,{expiresIn:'10m'});
      await send('Runtime.evaluate',{expression:`localStorage.setItem('token',${JSON.stringify(token)});localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))})`});
      await send('Page.navigate',{url:`http://localhost:3000/${page}.html`}); await delay(900);
      // เก็บความกว้างหน้า เพื่อตรวจว่าไม่มีส่วนไหนล้นจอจนต้องเลื่อนแนวนอน
      const layout=await send('Runtime.evaluate',{expression:`JSON.stringify({page:location.pathname,width:innerWidth,scroll:document.documentElement.scrollWidth,heading:document.querySelector('h1')?.textContent,formVisible:document.getElementById('userForm') ? !document.getElementById('userForm').hidden : true})`,returnByValue:true});
      const value=JSON.parse(layout.result.value); results.push(value);
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      fs.writeFileSync(`artifacts/ui/${page}-${width}.png`,Buffer.from(shot.data,'base64'));
      // หน้าแพทย์: จำลองคิวแล้วทดสอบว่าเลือกยาซ้ำไม่ได้ และตัวเลือกกลับมาเมื่อเปลี่ยน/ลบแถว
      if (page === 'doctor') {
        await send('Runtime.evaluate',{expression:`window.originalFetch=window.fetch;window.fetch=(url,options)=>url==='/api/visits'?Promise.resolve(new Response(JSON.stringify({data:[{id:999,patient_id:999,hn_code:'PREVIEW',first_name:'ตัวอย่าง',last_name:'ทดสอบ',status:'waiting',symptoms:'ทดสอบหน้าจอ',vital_signs:{},prescriptions:[]}]}),{status:200,headers:{'Content-Type':'application/json'}})):window.originalFetch(url,options);document.getElementById('refresh').click();`}); await delay(250);
        await send('Runtime.evaluate',{expression:`document.querySelector('[data-treat]').click()`}); await delay(400);
        const duplicateCheck=await send('Runtime.evaluate',{expression:`(()=>{
          const add=()=>document.getElementById('addMedicine').click();
          const selectValue=(s,value)=>{s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));};
          add();let first=document.querySelector('#medicineRows select');
          const options=[...first.options].filter(o=>o.value);if(options.length<3)return false;
          const [a,b,c]=options.map(o=>o.value);selectValue(first,a);add();
          let second=document.querySelectorAll('#medicineRows select')[1];
          if(![...second.options].find(o=>o.value===a).disabled)return false;
          selectValue(second,b);if(![...first.options].find(o=>o.value===b).disabled)return false;
          selectValue(first,c);if([...second.options].find(o=>o.value===a).disabled)return false;
          selectValue(second,c);if(second.value!=='')return false;
          selectValue(second,b);second.parentElement.querySelector('[data-remove]').click();
          if([...first.options].find(o=>o.value===b).disabled)return false;
          add();second=document.querySelectorAll('#medicineRows select')[1];
          if(![...second.options].find(o=>o.value===c).disabled)return false;
          document.getElementById('treatmentDialog').close();window.fetch=window.originalFetch;
          return true;
        })()`,returnByValue:true});
        if(!duplicateCheck.result.value)throw Error('Medicine duplicate selection, change or removal failed');
        console.log('PASS duplicate medicine choices disabled, rejected, and restored on change/removal');
      }
      // หน้าผู้ป่วย: API ต้องส่งอายุ ไม่มีช่องน้ำหนัก/ส่วนสูงในฟอร์ม และ HN สร้างอัตโนมัติ
      if (page === 'patients') {
        const response = await send('Runtime.evaluate', {expression:`(async()=>{const response=await fetch('/api/patients',{headers:{Authorization:'Bearer '+localStorage.getItem('token')}});const result=await response.json();return JSON.stringify({status:response.status,metricsAvailable:result.data.every(p=>'age' in p && !['bmi','weight_kg','height_cm'].some(key=>key in p))})})()`,awaitPromise:true,returnByValue:true});
        const check=JSON.parse(response.result.value);
        if(check.status!==200 || !check.metricsAvailable) throw Error('Patient API must return age without intake measurements');
        await send('Runtime.evaluate',{expression:`openModal();document.getElementById('date_of_birth').value='2000-10-10';updatePatientMetrics();`});
        const preview=await send('Runtime.evaluate',{expression:`JSON.stringify({autoHn:document.getElementById('hn_code').readOnly && !document.getElementById('hn_code').required && document.getElementById('hn_code').value==='',measurementsAbsent:!document.getElementById('weight_kg') && !document.getElementById('height_cm') && !document.getElementById('bmi'),age:document.getElementById('age').value,expectedAge:String(PatientMetrics.age('2000-10-10')),modalWidth:document.querySelector('#patientModal .modal-content').getBoundingClientRect().width,viewport:innerWidth})`,returnByValue:true});
        const calculated=JSON.parse(preview.result.value);
        if(!calculated.autoHn || !calculated.measurementsAbsent || calculated.age!==calculated.expectedAge || calculated.modalWidth>calculated.viewport) throw Error('Patient form automatic HN, calculation or layout failed');
        const modalShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        fs.writeFileSync(`artifacts/ui/patient-form-${width}.png`,Buffer.from(modalShot.data,'base64'));
        console.log(`PASS patient age retained and intake fields removed at ${width}px`);
      }
      // หน้าพยาบาล: ขั้นตอน 1-2-3 ไฮไลต์ถูก, เลือกผู้ป่วยแล้วข้อมูลขึ้นครบ, BMI คำนวณถูก และล้างค่าเมื่อเปิดใหม่
      if (page === 'nurse') {
        const initialStep=await send('Runtime.evaluate',{expression:`document.querySelector('.flow .current')?.textContent`,returnByValue:true});
        if(!initialStep.result.value?.startsWith('1')) throw Error('Nurse workspace must start at intake step 1');
        await send('Runtime.evaluate',{expression:`document.querySelector('[data-filter=ready]').click()`});
        const dispensingStep=await send('Runtime.evaluate',{expression:`document.querySelector('.flow .current')?.textContent`,returnByValue:true});
        if(!dispensingStep.result.value?.startsWith('3')) throw Error('Dispensing tab must highlight step 3');
        await send('Runtime.evaluate',{expression:`document.getElementById('newIntake').click()`}); await delay(400);
        const intakeStep=await send('Runtime.evaluate',{expression:`document.querySelector('.flow .current')?.textContent`,returnByValue:true});
        if(!intakeStep.result.value?.startsWith('1')) throw Error('New intake must return to step 1');
        await send('Runtime.evaluate',{expression:`document.getElementById('patient').selectedIndex=1;document.getElementById('patient').dispatchEvent(new Event('change'));`}); await delay(400);
        const details=await send('Runtime.evaluate',{expression:`JSON.stringify({selected:document.getElementById('patient').value,title:document.querySelector('#intakePatientDetails h3')?.textContent,hasAge:document.getElementById('intakePatientDetails').textContent.includes('อายุ'),hasAllergies:document.getElementById('intakePatientDetails').textContent.includes('ประวัติแพ้ยา'),hasConditions:document.getElementById('intakePatientDetails').textContent.includes('โรคประจำตัว')})`,returnByValue:true});
        const patient=JSON.parse(details.result.value);
        if(!patient.selected || !patient.title || !patient.hasAge || !patient.hasAllergies || !patient.hasConditions) throw Error('Selected patient details were not loaded into intake');
        await send('Runtime.evaluate',{expression:`document.getElementById('intake_weight_kg').value=70;document.getElementById('intake_height_cm').value=175;document.getElementById('intake_height_cm').dispatchEvent(new Event('input'));`});
        const intake=await send('Runtime.evaluate',{expression:`JSON.stringify({bmi:document.getElementById('intake_bmi').value,modalWidth:document.getElementById('intakeDialog').getBoundingClientRect().width,viewport:innerWidth})`,returnByValue:true});
        const value=JSON.parse(intake.result.value);
        if(value.bmi!=='22.9' || value.modalWidth>value.viewport) throw Error('Intake BMI or responsive layout failed');
        const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        fs.writeFileSync(`artifacts/ui/intake-form-${width}.png`,Buffer.from(shot.data,'base64'));
        await send('Runtime.evaluate',{expression:`document.getElementById('intakeDialog').close();document.getElementById('newIntake').click()`}); await delay(100);
        const reset=await send('Runtime.evaluate',{expression:`document.getElementById('intake_bmi').value`,returnByValue:true});
        if(reset.result.value!=='') throw Error('Intake BMI must reset for a new visit');
        const cleared=await send('Runtime.evaluate',{expression:`document.querySelector('#intakePatientDetails h3') === null`,returnByValue:true});
        if(!cleared.result.value) throw Error('Previous patient details must be cleared on a new intake');
        console.log(`PASS patient details, per-visit intake BMI and reset at ${width}px`);
      }
    }
    // สรุปผล: ถ้ามี error ในหน้าเว็บ หรือหน้าใดกว้างเกินจอ ให้ถือว่าล้มเหลว
    console.log(JSON.stringify({results,errors},null,2));
    if(errors.length || results.some(r=>r.scroll>r.width || !r.formVisible)) process.exitCode=1;
    await send('Browser.close');
  } finally { clearInterval(keepAlive); clearTimeout(deadline); if(socket)socket.close(); chrome.kill(); }
})().catch(error=>{console.error(error.message);process.exitCode=1;chrome.kill();});
