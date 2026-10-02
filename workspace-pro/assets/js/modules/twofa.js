import {esc, toast, copyText} from '../utils.js';

const host=()=>document.getElementById('module-twofa');
let current={secret:'',algorithm:'SHA1',digits:6,period:30,issuer:'',account:''};
let accounts=[], timer=null, qrCanvas=null;

const normalizeBase32=v=>String(v||'').toUpperCase().replace(/\s+/g,'').replace(/-/g,'').replace(/=/g,'');
function bytesToBase32(buffer){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0,out='';for(const b of buffer){value=(value<<8)|b;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5}}if(bits>0)out+=alphabet[(value<<(5-bits))&31];return out;}

function parseOTP(value){
  value=value.trim();if(!value)throw new Error('Chưa có dữ liệu.');
  if(value.toLowerCase().startsWith('otpauth://')){
    const totp=OTPAuth.URI.parse(value);
    current={secret:normalizeBase32(totp.secret.base32||bytesToBase32(totp.secret.bytes)),algorithm:(totp.algorithm||'SHA1').toUpperCase(),digits:Number(totp.digits||6),period:Number(totp.period||30),issuer:totp.issuer||'',account:totp.name||''};
  }else current={secret:normalizeBase32(value),algorithm:'SHA1',digits:6,period:30,issuer:'',account:''};
  if(!/^[A-Z2-7]+$/.test(current.secret))throw new Error('Secret Base32 không hợp lệ.');
  return current;
}
async function generateTOTP(acc=current){
  const secret=normalizeBase32(acc.secret),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='',bytes=[];
  for(const c of secret){const n=alphabet.indexOf(c);if(n<0)throw new Error('Secret không hợp lệ.');bits+=n.toString(2).padStart(5,'0')}
  for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  const counter=Math.floor(Date.now()/1000/(Number(acc.period)||30)),data=new Uint8Array(8);let n=counter;
  for(let i=7;i>=0;i--){data[i]=n&255;n=Math.floor(n/256)}
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

function startTimer(){
  clearInterval(timer);
  const tick=async()=>{
    if(!current.secret)return;
    const code=await generateTOTP(current),remain=(current.period||30)-(Math.floor(Date.now()/1000)%(current.period||30));
    const c=document.getElementById('faCode'),tm=document.getElementById('faTimer'),bar=document.getElementById('faProgress');
    if(c)c.textContent=code;if(tm)tm.textContent=`Mã mới sau ${remain} giây`;if(bar)bar.style.width=`${remain/(current.period||30)*100}%`;
  };
  tick();timer=setInterval(tick,1000);
}
function generateQR(text){
  const box=document.getElementById('faQr');box.innerHTML='';new QRCode(box,{text,width:220,height:220,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.M});
  setTimeout(()=>qrCanvas=box.querySelector('canvas'),80);
}
function handleText(text){
  if(text.startsWith('otpauth-migration://')){accounts.push(...parseMigrationQR(text));renderMigration();return;}
  parseOTP(text);document.getElementById('faInput').value=text;document.getElementById('faAccount').textContent=current.account||'-';document.getElementById('faIssuer').textContent=current.issuer||'-';document.getElementById('faAlgo').textContent=`${current.algorithm} · ${current.digits} digits · ${current.period}s`;startTimer();
}
function readQR(file){
  if(!file)return;const reader=new FileReader();
  reader.onload=e=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas'),max=3200;let w=img.naturalWidth,h=img.naturalHeight;if(Math.max(w,h)>max){const s=max/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s)}c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);const d=ctx.getImageData(0,0,w,h),qr=jsQR(d.data,w,h,{inversionAttempts:'attemptBoth'});if(!qr)return toast('Không tìm thấy QR trong ảnh.','danger');try{handleText(qr.data);toast('Đã đọc QR.','success')}catch(err){toast(err.message,'danger')}};img.src=e.target.result};reader.readAsDataURL(file);
}
async function renderMigration(){
  const body=document.getElementById('faAccounts');if(!body)return;
  body.innerHTML=(await Promise.all(accounts.map(async(a,i)=>`<tr><td>${esc(a.account||a.name||'-')}</td><td>${esc(a.issuer||'-')}</td><td><code>${esc(a.secret)}</code></td><td>${esc(a.algorithm)}</td><td class="fw-bold">${await generateTOTP(a)}</td><td><button class="btn btn-sm btn-outline-secondary" data-fa-copy="${i}"><i class="bi bi-copy"></i></button></td></tr>`))).join('')||`<tr><td colspan="6" class="text-center text-secondary py-4">Chưa có tài khoản.</td></tr>`;
  body.querySelectorAll('[data-fa-copy]').forEach(b=>b.onclick=()=>copyText(accounts[Number(b.dataset.faCopy)].secret));
}
export function render(){
  host().innerHTML=`
  <div class="d-flex justify-content-between align-items-center mb-3"><div><h4 class="mb-1">2FA Authenticator</h4><div class="small text-secondary">Xử lý trong trình duyệt. Không lưu Secret/OTP vào localStorage.</div></div></div>
  <ul class="nav nav-tabs mb-3" role="tablist"><li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#faAuth">Authenticator</button></li><li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#faMigration">Migration QR</button></li></ul>
  <div class="tab-content">
    <div class="tab-pane fade show active" id="faAuth">
      <div class="twofa-grid">
        <div class="card p-3">
          <h6><i class="bi bi-key me-2"></i>QR / Secret → OTP</h6>
          <div id="faDrop" class="qr-drop my-3"><i class="bi bi-image fs-2 d-block mb-2"></i>Dán ảnh bằng Ctrl+V, kéo thả hoặc chọn file<input id="faFile" class="form-control form-control-sm mt-3" type="file" accept="image/*"></div>
          <textarea id="faInput" class="form-control code-font" rows="4" placeholder="Secret hoặc otpauth://"></textarea>
          <div class="d-flex gap-2 mt-2"><button id="faProcess" class="btn btn-primary btn-sm">Lấy mã</button><button id="faCopyCode" class="btn btn-outline-secondary btn-sm">Copy mã</button><button id="faReset" class="btn btn-outline-danger btn-sm">Xóa</button></div>
          <div class="text-center mt-4"><div class="small text-secondary">CURRENT OTP</div><div id="faCode" class="otp-code my-2">------</div><div id="faTimer" class="small text-secondary">Chưa có Secret</div><div class="progress mt-2" style="height:4px"><div id="faProgress" class="progress-bar" style="width:100%"></div></div></div>
          <div class="row g-2 mt-3 small"><div class="col-4"><div class="text-secondary">Account</div><div id="faAccount">-</div></div><div class="col-4"><div class="text-secondary">Issuer</div><div id="faIssuer">-</div></div><div class="col-4"><div class="text-secondary">Config</div><div id="faAlgo">SHA1 · 6 · 30s</div></div></div>
        </div>
        <div class="card p-3">
          <h6><i class="bi bi-qr-code me-2"></i>Secret → QR</h6>
          <textarea id="faQrInput" class="form-control code-font" rows="4" placeholder="Secret hoặc otpauth://"></textarea>
          <button id="faQrGenerate" class="btn btn-primary btn-sm mt-2">Tạo QR</button>
          <div class="qr-preview mt-3"><div id="faQr"></div></div>
        </div>
      </div>
    </div>
    <div class="tab-pane fade" id="faMigration">
      <div class="card p-3">
        <div class="row g-3">
          <div class="col-lg-4"><h6>Migration QR</h6><input id="faMigFile" type="file" accept="image/*" class="form-control mb-2"><textarea id="faMigText" class="form-control code-font" rows="6" placeholder="otpauth-migration://..."></textarea><div class="d-flex gap-2 mt-2"><button id="faMigDecode" class="btn btn-primary btn-sm">Giải mã</button><button id="faMigClear" class="btn btn-outline-danger btn-sm">Xóa</button></div></div>
          <div class="col-lg-8"><div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Account</th><th>Issuer</th><th>Secret</th><th>Algo</th><th>OTP</th><th></th></tr></thead><tbody id="faAccounts"></tbody></table></div></div>
        </div>
      </div>
    </div>
  </div>`;
  const process=()=>{try{handleText(document.getElementById('faInput').value.trim());document.getElementById('faQrInput').value=document.getElementById('faInput').value;}catch(e){toast(e.message,'danger')}};
  document.getElementById('faProcess').onclick=process;
  document.getElementById('faCopyCode').onclick=()=>copyText(document.getElementById('faCode').textContent.trim());
  document.getElementById('faReset').onclick=()=>{current={secret:'',algorithm:'SHA1',digits:6,period:30,issuer:'',account:''};clearInterval(timer);render();};
  document.getElementById('faFile').onchange=e=>readQR(e.target.files[0]);
  document.getElementById('faMigFile').onchange=e=>readQR(e.target.files[0]);
  const drop=document.getElementById('faDrop');
  ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));
  drop.addEventListener('drop',e=>readQR(e.dataTransfer.files[0]));
  document.getElementById('faQrGenerate').onclick=()=>{try{const v=document.getElementById('faQrInput').value.trim();const acc=v.startsWith('otpauth://')?parseOTP(v):parseOTP(v);generateQR(v.startsWith('otpauth://')?v:makeOtpAuth(acc));}catch(e){toast(e.message,'danger')}};
  document.getElementById('faMigDecode').onclick=()=>{try{accounts.push(...parseMigrationQR(document.getElementById('faMigText').value.trim()));renderMigration();}catch(e){toast(e.message,'danger')}};
  document.getElementById('faMigClear').onclick=()=>{accounts=[];renderMigration();};
  document.addEventListener('paste',pasteHandler,{once:true});
  renderMigration();
}
function pasteHandler(e){for(const item of e.clipboardData?.items||[]){if(item.type.startsWith('image/')){readQR(item.getAsFile());e.preventDefault();break}}}
export const TwoFA={init(){},render};
