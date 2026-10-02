import {esc, toast, copyText} from '../utils.js';

const host=()=>document.getElementById('module-twofa');
let current={secret:'',algorithm:'SHA1',digits:6,period:30,issuer:'',account:''};
let accounts=[],timer=null,qrCanvas=null,pasteBound=false;

const normalizeBase32=v=>String(v||'').toUpperCase().replace(/\s+/g,'').replace(/-/g,'').replace(/=/g,'');
function bytesToBase32(buffer){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0,out='';for(const b of buffer){value=(value<<8)|b;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5}}if(bits>0)out+=alphabet[(value<<(5-bits))&31];return out;}

function parseOTP(value){
  value=value.trim();if(!value)throw new Error('Chưa có dữ liệu.');
  if(value.toLowerCase().startsWith('otpauth://')){
    const totp=OTPAuth.URI.parse(value);
    current={secret:normalizeBase32(totp.secret.base32||bytesToBase32(totp.secret.bytes)),algorithm:(totp.algorithm||'SHA1').toUpperCase(),digits:Number(totp.digits||6),period:Number(totp.period||30),issuer:totp.issuer||'',account:totp.name||''};
  }else current={secret:normalizeBase32(value),algorithm:'SHA1',digits:6,period:30,issuer:'',account:''};
  if(!current.secret||!/^[A-Z2-7]+$/.test(current.secret))throw new Error('Secret Base32 không hợp lệ.');
  return current;
}

async function generateTOTP(acc=current){
  const secret=normalizeBase32(acc.secret),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='',bytes=[];
  for(const c of secret){const n=alphabet.indexOf(c);if(n<0)throw new Error('Secret không hợp lệ.');bits+=n.toString(2).padStart(5,'0');}
  for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  const counter=Math.floor(Date.now()/1000/(Number(acc.period)||30)),data=new Uint8Array(8);let n=counter;
  for(let i=7;i>=0;i--){data[i]=n&255;n=Math.floor(n/256);}
  const alg=(acc.algorithm||'SHA1').toUpperCase(),hashName=alg==='SHA512'?'SHA-512':alg==='SHA256'?'SHA-256':'SHA-1';
  const key=await crypto.subtle.importKey('raw',new Uint8Array(bytes),{name:'HMAC',hash:hashName},false,['sign']);
  const hash=new Uint8Array(await crypto.subtle.sign('HMAC',key,data)),offset=hash[hash.length-1]&15;
  const binary=(((hash[offset]&127)<<24)|((hash[offset+1]&255)<<16)|((hash[offset+2]&255)<<8)|(hash[offset+3]&255))>>>0;
  return String(binary%Math.pow(10,Number(acc.digits)||6)).padStart(Number(acc.digits)||6,'0');
}

function makeOtpAuth(acc){
  const label=encodeURIComponent((acc.issuer?acc.issuer+':':'')+acc.account);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(acc.secret)}&issuer=${encodeURIComponent(acc.issuer||'2FA')}&algorithm=${encodeURIComponent(acc.algorithm||'SHA1')}&digits=${encodeURIComponent(acc.digits||6)}&period=${encodeURIComponent(acc.period||30)}`;
}

function parseMigrationQR(uri){
  if(!uri.startsWith('otpauth-migration://offline?data='))throw new Error('Không phải Google Authenticator Migration QR.');
  const encoded=uri.split('data=')[1],bytes=Uint8Array.from(atob(decodeURIComponent(encoded)),c=>c.charCodeAt(0));return parseMigrationBytes(bytes);
}
function parseMigrationBytes(bytes){let offset=0,out=[];const varint=()=>{let r=0,shift=0;while(offset<bytes.length){const b=bytes[offset++];r|=(b&127)<<shift;if(!(b&128))break;shift+=7}return r>>>0};while(offset<bytes.length){const tag=varint(),wire=tag&7,field=tag>>>3;if(field===1){const len=varint(),sub=bytes.subarray(offset,offset+len);offset+=len;const a=parseOtpParameters(sub);if(a)out.push(a)}else if(wire===0)varint();else if(wire===2){const len=varint();offset+=len}else break}return out;}
function parseOtpParameters(bytes){let offset=0,secretBytes=null,name='',issuer='',algorithm=1,digits=1;const varint=()=>{let r=0,shift=0;while(offset<bytes.length){const b=bytes[offset++];r|=(b&127)<<shift;if(!(b&128))break;shift+=7}return r>>>0};const text=()=>{const len=varint(),s=new TextDecoder().decode(bytes.subarray(offset,offset+len));offset+=len;return s};while(offset<bytes.length){const tag=varint(),wire=tag&7,field=tag>>>3;if(field===1){const len=varint();secretBytes=bytes.subarray(offset,offset+len);offset+=len}else if(field===2)name=text();else if(field===3)issuer=text();else if(field===4)algorithm=varint();else if(field===5)digits=varint();else if(wire===0)varint();else if(wire===2){const len=varint();offset+=len}else break}if(!secretBytes)return null;const map={1:'SHA1',2:'SHA256',3:'SHA512',4:'MD5'};return {name,account:name,issuer,secret:bytesToBase32(secretBytes),algorithm:map[algorithm]||'SHA1',digits:digits===2?8:6,period:30};}

function switchTab(selector){
  const trigger=document.querySelector(`[data-bs-target="${selector}"]`);if(trigger)bootstrap.Tab.getOrCreateInstance(trigger).show();
}

function startTimer(){
  clearInterval(timer);
  const tick=async()=>{
    if(!current.secret)return;
    try{
      const code=await generateTOTP(current),remain=(current.period||30)-(Math.floor(Date.now()/1000)%(current.period||30));
      const c=document.getElementById('faCode'),tm=document.getElementById('faTimer'),bar=document.getElementById('faProgress');
      if(c)c.textContent=code;if(tm)tm.textContent=`Mã mới sau ${remain} giây`;if(bar)bar.style.width=`${remain/(current.period||30)*100}%`;
    }catch(e){console.error(e);}
  };
  tick();timer=setInterval(tick,1000);
}

function generateQR(text){
  const box=document.getElementById('faQr');if(!box)return;box.innerHTML='';new QRCode(box,{text,width:220,height:220,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
  setTimeout(()=>qrCanvas=box.querySelector('canvas'),80);
}

function updateAuthInfo(){
  document.getElementById('faAccount')?.replaceChildren(document.createTextNode(current.account||'-'));
  document.getElementById('faIssuer')?.replaceChildren(document.createTextNode(current.issuer||'-'));
  document.getElementById('faAlgo')?.replaceChildren(document.createTextNode(`${current.algorithm} · ${current.digits} digits · ${current.period}s`));
}

function handleText(text){
  if(text.startsWith('otpauth-migration://')){
    const result=parseMigrationQR(text);accounts.push(...result);const mig=document.getElementById('faMigText');if(mig)mig.value=text;switchTab('#faMigration');renderMigration();toast(`Đã đọc ${result.length} tài khoản.`,'success');return;
  }
  parseOTP(text);const input=document.getElementById('faInput');if(input)input.value=text;const qrInput=document.getElementById('faQrInput');if(qrInput)qrInput.value=text;updateAuthInfo();switchTab('#faAuth');startTimer();
}

function readQR(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{const img=new Image();img.onload=()=>{
    const c=document.createElement('canvas'),max=3200;let w=img.naturalWidth,h=img.naturalHeight;
    if(Math.max(w,h)>max){const s=max/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s);}
    c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);
    const d=ctx.getImageData(0,0,w,h),qr=jsQR(d.data,w,h,{inversionAttempts:'attemptBoth'});
    if(!qr)return toast('Không tìm thấy QR trong ảnh.','danger');
    try{handleText(qr.data);toast('Đã đọc QR từ ảnh.','success');}catch(err){toast(err.message,'danger');}
  };img.onerror=()=>toast('Không đọc được ảnh từ clipboard/file.','danger');img.src=e.target.result;};
  reader.onerror=()=>toast('Không đọc được file ảnh.','danger');reader.readAsDataURL(file);
}

function getImageFromClipboard(e){
  const items=[...(e.clipboardData?.items||[])];
  const imageItem=items.find(item=>item.kind==='file'&&item.type.startsWith('image/'));
  if(imageItem)return imageItem.getAsFile();
  const files=[...(e.clipboardData?.files||[])];
  return files.find(f=>f.type.startsWith('image/'))||null;
}

function globalPasteHandler(e){
  if(!host()?.classList.contains('active'))return;
  const file=getImageFromClipboard(e);if(!file)return;
  e.preventDefault();
  readQR(file);
}

async function renderMigration(){
  const body=document.getElementById('faAccounts');if(!body)return;
  if(!accounts.length){body.innerHTML=`<tr><td colspan="6" class="text-center text-secondary py-4"><i class="bi bi-qr-code-scan fs-3 d-block mb-2"></i>Chưa có tài khoản.</td></tr>`;return;}
  body.innerHTML=(await Promise.all(accounts.map(async(a,i)=>`<tr><td>${esc(a.account||a.name||'-')}</td><td>${esc(a.issuer||'-')}</td><td><code>${esc(a.secret)}</code></td><td>${esc(a.algorithm)}</td><td class="fw-bold text-success">${await generateTOTP(a)}</td><td><button class="btn btn-sm btn-outline-secondary" data-fa-copy="${i}" title="Copy secret"><i class="bi bi-copy"></i></button></td></tr>`))).join('');
  body.querySelectorAll('[data-fa-copy]').forEach(b=>b.onclick=async()=>{await copyText(accounts[Number(b.dataset.faCopy)].secret);toast('Đã copy Secret.','success');});
}

export function render(){
  host().innerHTML=`
  <div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-3">
    <div><div class="d-flex align-items-center gap-2 mb-1"><div class="brand-logo" style="width:32px;height:32px"><i class="bi bi-shield-lock-fill"></i></div><h4 class="mb-0 fw-bold">2FA Authenticator</h4></div><div class="small text-secondary">Secret, QR và OTP chỉ tồn tại trong bộ nhớ của trang hiện tại.</div></div>
    <div class="fa-paste-hint"><i class="bi bi-clipboard me-1"></i><strong>Ctrl + V</strong> ảnh QR ở bất kỳ đâu trong tab 2FA</div>
  </div>

  <ul class="nav nav-pills gap-1 mb-3" role="tablist">
    <li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#faAuth"><i class="bi bi-key-fill me-1"></i>Authenticator</button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#faMigration"><i class="bi bi-qr-code-scan me-1"></i>Migration QR</button></li>
  </ul>

  <div class="tab-content">
    <div class="tab-pane fade show active" id="faAuth">
      <div class="twofa-grid">
        <div class="card twofa-card p-3">
          <div class="d-flex align-items-center gap-2"><i class="bi bi-shield-check text-primary fs-5"></i><div><div class="fw-bold">QR / Secret → OTP</div><div class="small text-secondary">Dán ảnh, kéo thả, chọn file hoặc nhập Secret.</div></div></div>
          <div id="faDrop" class="qr-drop my-3"><i class="bi bi-clipboard-plus fs-2 d-block mb-2 text-primary"></i><div class="fw-semibold">Ctrl + V ảnh QR</div><div class="small text-secondary mt-1">hoặc kéo ảnh vào đây / chọn file</div><input id="faFile" class="form-control form-control-sm mt-3" type="file" accept="image/*"></div>
          <textarea id="faInput" class="form-control code-font" rows="4" placeholder="Secret hoặc otpauth://"></textarea>
          <div class="d-flex gap-2 mt-2 flex-wrap"><button id="faProcess" class="btn btn-primary btn-sm"><i class="bi bi-key me-1"></i>Lấy mã</button><button id="faCopyCode" class="btn btn-outline-secondary btn-sm"><i class="bi bi-copy me-1"></i>Copy mã</button><button id="faReset" class="btn btn-outline-danger btn-sm"><i class="bi bi-trash3 me-1"></i>Xóa</button></div>
          <div class="text-center mt-4"><div class="section-title">Current OTP</div><div id="faCode" class="otp-code my-2">------</div><div id="faTimer" class="small text-secondary">Chưa có Secret</div><div class="progress mt-2" style="height:4px"><div id="faProgress" class="progress-bar" style="width:100%"></div></div></div>
          <div class="row g-2 mt-3 small"><div class="col-4"><div class="text-secondary">Account</div><div id="faAccount" class="text-truncate">-</div></div><div class="col-4"><div class="text-secondary">Issuer</div><div id="faIssuer" class="text-truncate">-</div></div><div class="col-4"><div class="text-secondary">Config</div><div id="faAlgo">SHA1 · 6 digits · 30s</div></div></div>
        </div>
        <div class="card twofa-card p-3">
          <div class="d-flex align-items-center gap-2"><i class="bi bi-qr-code text-primary fs-5"></i><div><div class="fw-bold">Secret → QR</div><div class="small text-secondary">Tạo QR có thể quét lại bằng Authenticator.</div></div></div>
          <textarea id="faQrInput" class="form-control code-font mt-3" rows="4" placeholder="Secret hoặc otpauth://"></textarea>
          <div class="d-flex gap-2 mt-2"><button id="faQrGenerate" class="btn btn-primary btn-sm"><i class="bi bi-stars me-1"></i>Tạo QR</button><button id="faQrCopy" class="btn btn-outline-secondary btn-sm"><i class="bi bi-copy me-1"></i>Copy ảnh</button></div>
          <div class="qr-preview mt-3"><div id="faQr"><div class="text-secondary small">QR sẽ xuất hiện ở đây</div></div></div>
        </div>
      </div>
    </div>

    <div class="tab-pane fade" id="faMigration">
      <div class="card twofa-card p-3">
        <div class="row g-3">
          <div class="col-lg-4"><div class="fw-bold mb-1"><i class="bi bi-qr-code-scan me-2"></i>Google Authenticator Migration</div><div class="small text-secondary mb-3">Ctrl + V cũng hoạt động ở tab này.</div><input id="faMigFile" type="file" accept="image/*" class="form-control form-control-sm mb-2"><textarea id="faMigText" class="form-control code-font" rows="7" placeholder="otpauth-migration://..."></textarea><div class="d-flex gap-2 mt-2"><button id="faMigDecode" class="btn btn-primary btn-sm"><i class="bi bi-binary me-1"></i>Giải mã</button><button id="faMigClear" class="btn btn-outline-danger btn-sm"><i class="bi bi-trash3 me-1"></i>Xóa</button></div></div>
          <div class="col-lg-8"><div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Account</th><th>Issuer</th><th>Secret</th><th>Algo</th><th>OTP</th><th></th></tr></thead><tbody id="faAccounts"></tbody></table></div></div>
        </div>
      </div>
    </div>
  </div>`;

  const process=()=>{try{handleText(document.getElementById('faInput').value.trim());}catch(e){toast(e.message,'danger');}};
  document.getElementById('faProcess').onclick=process;
  document.getElementById('faCopyCode').onclick=async()=>{const code=document.getElementById('faCode').textContent.trim();if(code==='------')return toast('Chưa có OTP.','warning');await copyText(code);toast('Đã copy OTP.','success');};
  document.getElementById('faReset').onclick=()=>{current={secret:'',algorithm:'SHA1',digits:6,period:30,issuer:'',account:''};clearInterval(timer);timer=null;render();};
  document.getElementById('faFile').onchange=e=>readQR(e.target.files[0]);
  document.getElementById('faMigFile').onchange=e=>readQR(e.target.files[0]);
  const drop=document.getElementById('faDrop');
  ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag');}));
  drop.addEventListener('drop',e=>readQR(e.dataTransfer.files?.[0]));
  document.getElementById('faQrGenerate').onclick=()=>{try{const v=document.getElementById('faQrInput').value.trim();const acc=parseOTP(v);generateQR(v.startsWith('otpauth://')?v:makeOtpAuth(acc));}catch(e){toast(e.message,'danger');}};
  document.getElementById('faQrCopy').onclick=()=>{const c=qrCanvas||document.querySelector('#faQr canvas');if(!c)return toast('Chưa có QR.','warning');c.toBlob(async blob=>{try{await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);toast('Đã copy ảnh QR.','success');}catch{toast('Trình duyệt không cho copy ảnh trực tiếp.','warning');}},'image/png');};
  document.getElementById('faMigDecode').onclick=()=>{try{const result=parseMigrationQR(document.getElementById('faMigText').value.trim());accounts.push(...result);renderMigration();toast(`Đã giải mã ${result.length} tài khoản.`,'success');}catch(e){toast(e.message,'danger');}};
  document.getElementById('faMigClear').onclick=()=>{accounts=[];renderMigration();};
  renderMigration();
}

export const TwoFA={
  init(){
    if(pasteBound)return;
    document.addEventListener('paste',globalPasteHandler);
    pasteBound=true;
  },
  render
};
