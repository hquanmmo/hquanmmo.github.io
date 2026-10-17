import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,getRedirectResult,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js';
import {firebaseConfig,functionsRegion} from './firebase-config.js';
const root=document.getElementById('app'),modals=document.getElementById('modal-root'),toastEl=document.getElementById('toast');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const encode=x=>encodeURIComponent(x??'');
const dec=x=>decodeURIComponent(x??'');
const $=id=>document.getElementById(id);
const state={view:'calendar',month:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,7),me:null,role:null,dev:false,members:[],attendance:[],requests:[],roles:[],pendingImports:[],integration:{},filter:'',level:'',dot:'',whoStatus:'',filterDate:'',auth:null,busy:false};
const cfgOk=firebaseConfig.apiKey!=='REPLACE_ME'&&!firebaseConfig.projectId.startsWith('YOUR_');
let auth,funcs;
const button=(txt,action,cls='')=>`<button class="btn ${cls}" data-action="${esc(action)}">${txt}</button>`;
const roleName=m=>({dev:'Dev',admin:'Admin',lead:'Lead',assign:'Assign',staff:'Nhân viên'}[m.roleId]||m.roleId);
const initials=s=>(String(s||'TN').split(' ').filter(Boolean).slice(-2).map(x=>x[0]).join('')||'T').toUpperCase();
const has=x=>state.dev||(state.me?.roleId==='admin'&&x==='viewRoster')||!!state.role?.[x];
const myScope=()=>state.me?.roleId==='lead'?'team':state.me?.roleId==='admin'?'all':state.role?.scope||'self';
const monthTitle=m=>{const [y,mm]=m.split('-');return `Tháng ${+mm}/${y}`};
const daysIn=m=>{const [y,mm]=m.split('-').map(Number);return new Date(y,mm,0).getDate()};
const dateAt=d=>state.month+'-'+String(d).padStart(2,'0');
const getEntry=(email,date)=>state.attendance.find(x=>x.email===email&&x.date===date);
const statusLabel=s=>({ON:'ON',OFF:'OFF',PENDING:'Chờ duyệt',APPROVED:'Đã duyệt',REJECTED:'Từ chối',PAID:'Có lương',UNPAID:'Không lương'}[s]||'—');
const roleScopeLabels={all:'Toàn bộ',team:'Nhóm Lead',self:'Cá nhân'};
const canEditMember=m=>has('setStatus')&&(myScope()==='all'||(myScope()==='team'&&(m.leadEmail===state.me?.email||m.email===state.me?.email))||(myScope()==='self'&&m.email===state.me?.email));
function toast(msg){toastEl.textContent=msg;toastEl.classList.add('show');clearTimeout(toastEl._t);toastEl._t=setTimeout(()=>toastEl.classList.remove('show'),4300)}
function errorMsg(e){return e?.message?.replace(/^functions\/[^ ]+\s*:?\s*/,'')||'Có lỗi xảy ra';}
async function api(name,data={}){const r=await httpsCallable(funcs,name)(data);return r.data}
async function act(fn){if(state.busy)return;state.busy=true;try{await fn()}catch(e){console.error(e);toast(errorMsg(e))}finally{state.busy=false}}
function pendingView(){root.innerHTML='<div class="loading-center">Đang kết nối dữ liệu an toàn…</div>'}
function login(error=''){
 root.innerHTML=`<main class="login"><div class="card login-card"><div class="login-icon">◷</div><h1>TimeNest</h1><p>Điểm danh ON · Xin OFF · Quản lý theo lịch</p><div style="height:24px"></div>${error?`<div class="callout" style="margin-bottom:18px">${esc(error)}</div>`:''}<button class="google" data-action="login"><span class="g">G</span> Tiếp tục với Google</button><div class="login-steps">🔒 Xác thực bằng Google/Firebase<br>☑️ Dev cấp quyền trước khi tài khoản được sử dụng<br>☑️ Dữ liệu không lưu trong trình duyệt</div></div></main>`;
}
async function load(){const data=await api('dashboard',{month:state.month});Object.assign(state,data);}
async function start(){pendingView();try{const me=await api('openSession');Object.assign(state,me);await load();render()}catch(e){console.error(e);login('Tài khoản Google chưa được Dev cấp quyền, hoặc Firebase chưa cấu hình đúng. '+errorMsg(e))}}
function navItems(){return [
 ['calendar','Lịch','▦'],...(has('viewRoster')?[['matrix','Bảng công','▤']]:[]),
 ['requests','Xin OFF','◷'],...(state.dev?[['members','Nhân sự','♧'],['roles','Vai trò','⚙'],['setup','Kết nối','◇']]:[])
 ]}
function navButton([id,name,ico]){return `<button data-action="nav" data-view="${id}" class="${state.view===id?'active':''}"><span class="emoji">${ico}</span>${esc(name)}</button>`}
function render(){
 if(!state.me){login();return}
 const name=esc(state.me.name||state.me.email), items=navItems();
 if(!items.some(x=>x[0]===state.view))state.view='calendar';
 root.innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand"><span class="logo">◷</span>TimeNest</div><div class="nav">${items.map(navButton).join('')}</div><div class="end"><div class="strong">${esc(roleName(state.me))}</div><div class="tiny" style="margin:7px 0;overflow-wrap:anywhere">${esc(state.me.email)}</div><button class="btn sm" data-action="logout">Đăng xuất ↗</button></div></aside><main class="main"><header class="top"><div><div class="eyebrow">TIME NEST / ${esc(roleName(state.me))}</div><h1 class="title">${{calendar:'Lịch điểm danh',matrix:'Bảng chấm công',requests:'Đơn xin OFF',members:'Nhân sự',roles:'Vai trò & phân quyền',setup:'Hướng dẫn kết nối'}[state.view]}</h1><div class="sub">${state.view==='calendar'?'Báo ON một lần mỗi ngày • OFF cần đăng ký trước':state.view==='matrix'?'Dữ liệu nhân viên × ngày • đồng bộ Google Sheets':state.view==='requests'?'Ưu tiên theo số thứ tự gửi đơn':'Quản lý tập trung và bảo mật theo nhóm'}</div></div><div class="user"><div class="details" style="text-align:right"><div class="strong" style="font-size:12px">${name}</div><div class="tiny">${esc(state.me.email)}</div></div><div class="avatar">${esc(initials(state.me.name))}</div></div></header>${views[state.view]()}<div class="notice" style="margin-top:22px">Thời điểm ON và quyền được máy chủ xác thực • Google Sheets có thể đồng bộ chậm nếu tài khoản chưa kết nối hoặc hết hạn mức.</div></main><div class="mobilebar">${items.map(([id,n,ico])=>`<button data-action="nav" data-view="${id}" class="${state.view===id?'active':''}"><b>${ico}</b>${esc(n)}</button>`).join('')}</div></div>`;
}
const monthSelector=()=>`<div class="buttons"><button class="btn sm" data-action="prevMonth">←</button><span class="strong">${monthTitle(state.month)}</span><button class="btn sm" data-action="nextMonth">→</button>${button('Làm mới','refresh','sm')}</div>`;
function calendarView(){
 const own=state.me.email,now=state.today,dayNum=daysIn(state.month),[y,m]=state.month.split('-').map(Number),first=(new Date(y,m-1,1).getDay()+6)%7;
 const ownRows=state.attendance.filter(x=>x.email===own),myON=ownRows.filter(x=>x.status==='ON').length,myOFF=ownRows.filter(x=>x.status==='OFF').length;
 const queue=state.requests.filter(x=>x.email===own&&x.status==='PENDING').length;
 const onNow=getEntry(own,now);
 const days=Array.from({length:first},()=>'<div class="day filler"></div>').concat(Array.from({length:dayNum},(_,i)=>{
  const d=i+1,date=dateAt(d),entry=getEntry(own,date),cl=entry?.status?.toLowerCase()||'',past=date<now;
  const tip=entry?.status==='ON'? 'ON':entry?.status==='OFF'?'OFF':'';
  return `<button class="day ${cl} ${past?'past':''} ${date===now?'today':''}" data-action="day" data-date="${date}"><span>${d}</span>${tip?`<b>${tip}</b>`:''}</button>`;
 }));
 return `<div class="grid g4"><div class="card"><div class="tiny">Ngày ON</div><div class="number green">${myON}</div><span class="tiny">trong tháng</span></div><div class="card"><div class="tiny">Ngày OFF</div><div class="number red">${myOFF}</div><span class="tiny">trong tháng</span></div><div class="card"><div class="tiny">Đơn chờ duyệt</div><div class="number amber">${queue}</div><span class="tiny">của bạn</span></div><div class="card"><div class="tiny">Hôm nay</div><div class="number blue">${now.slice(8)}</div><span class="tiny">${now.slice(0,7)}</span></div></div>
 <div class="section"><h3>Lịch của tôi</h3>${monthSelector()}</div><div class="card"><div class="row between wrap"><div class="legend"><i class="dot l-on"></i> ON <i class="dot l-off"></i> OFF</div><div class="buttons">${button(onNow?'Đã báo ON':'● Báo ON hôm nay','on','primary')} ${button('Xin OFF','requestOff')}</div></div><div class="calendar-head">${['T2','T3','T4','T5','T6','T7','CN'].map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar">${days.join('')}</div><div class="sub" style="margin-top:15px">Chạm vào ngày để xem trạng thái. OFF chỉ gửi cho ngày tương lai.</div></div>
 ${has('viewRoster')?`<div class="section"><h3>Nhóm của bạn</h3>${button('Xem bảng tất cả →','matrix')}</div><div class="grid g3"><div class="card"><div class="tiny">Nhân sự nhìn thấy</div><div class="number">${state.members.length}</div></div><div class="card"><div class="tiny">ON hôm nay</div><div class="number green">${state.attendance.filter(x=>x.date===now&&x.status==='ON').length}</div></div><div class="card"><div class="tiny">OFF hôm nay</div><div class="number red">${state.attendance.filter(x=>x.date===now&&x.status==='OFF').length}</div></div></div>`:''}`;
}
function filtered(){let q=state.filter.trim().toLowerCase();return state.members.filter(m=>{
 if(q&&!`${m.email} ${m.name} ${m.code}`.toLowerCase().includes(q))return false;
 if(state.dot&&m.dot!==state.dot)return false;
 if(state.level&&m.level!==state.level)return false;
 if(state.whoStatus){let d=state.filterDate||state.today,entry=getEntry(m.email,d);if((entry?.status||'NONE')!==state.whoStatus)return false}
 return true;
 });}
function optionSet(list,value){return [...new Set(list.filter(Boolean))].sort().map(s=>`<option value="${esc(s)}" ${value===s?'selected':''}>${esc(s)}</option>`).join('')}
function filters(){return `<div class="filterbar"><input class="input search" id="searchInput" placeholder="⌕  Tên, mã NV, email" value="${esc(state.filter)}"><select class="input" id="dotInput"><option value="">Tất cả đợt</option>${optionSet(state.members.map(m=>m.dot),state.dot)}</select><select class="input" id="levelInput"><option value="">Mọi Level</option>${optionSet(state.members.map(m=>m.level),state.level)}</select><select class="input" id="statusInput"><option value="">Mọi trạng thái</option>${['ON','OFF','NONE'].map(s=>`<option value="${s}" ${state.whoStatus===s?'selected':''}>${s==='NONE'?'Chưa báo':s}</option>`).join('')}</select><input type="date" class="input" id="filterDateInput" value="${esc(state.filterDate||state.today)}"></div>`}
function matrixView(){
 const visible=filtered(),last=daysIn(state.month),today=state.today;
 return `<div class="grid g4"><div class="card"><div class="tiny">Nhân viên</div><div class="number">${state.members.length}</div></div><div class="card"><div class="tiny">ON trong tháng</div><div class="number green">${state.attendance.filter(x=>x.status==='ON').length}</div></div><div class="card"><div class="tiny">OFF trong tháng</div><div class="number red">${state.attendance.filter(x=>x.status==='OFF').length}</div></div><div class="card"><div class="tiny">Đơn đang chờ</div><div class="number amber">${state.requests.filter(x=>x.status==='PENDING').length}</div></div></div>
 <div class="section"><h3>Ma trận nhân viên × ngày <span class="badge-count">${visible.length}</span></h3>${monthSelector()}</div><div class="card">${filters()}<div class="row between wrap" style="margin-bottom:13px"><div class="legend"><i class="dot l-on"></i> ON <i class="dot l-off"></i> OFF <span>Chạm vào ô để thay đổi (nếu có quyền)</span></div>${button('Xuất CSV','export','sm')}</div>
 <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="who">Nhân viên</th>${Array.from({length:last},(_,i)=>`<th>${i+1}</th>`).join('')}</tr></thead><tbody>${visible.map(m=>`<tr><td class="who"><div class="strong">${esc(m.name)}</div><small>${esc(m.code)} · ${esc(m.email)}</small></td>${Array.from({length:last},(_,i)=>{const date=dateAt(i+1),v=getEntry(m.email,date),editable=canEditMember(m);return `<td><button class="cell ${editable?'editable':''} ${v?.status==='ON'?'day-on':v?.status==='OFF'?'day-off':''} ${date===today?'day-today':''}" title="${esc(date+' '+(v?.status||''))}" ${editable?`data-action="editCell" data-email="${encode(m.email)}" data-date="${date}"`:'disabled'}>${v?.status||'·'}</button></td>`}).join('')}</tr>`).join('')||'<tr><td colspan="32" class="empty">Không có nhân viên phù hợp.</td></tr>'}</tbody></table></div></div>`;
}
function requestsView(){
 const r=[...state.requests].sort((a,b)=>(a.order||0)-(b.order||0));
 const canApprove=has('approveOff');
 return `<div class="section"><h3>Đơn OFF <span class="badge-count">${r.length}</span></h3>${button('+ Tạo đơn OFF','requestOff','primary')}</div><div class="callout">Các đơn được đánh số theo thứ tự gửi. Lead chỉ duyệt nhân viên trong nhóm; Admin/Dev có thể phân loại có lương hoặc không lương.</div>
 <div class="card" style="margin-top:15px"><div class="table-wrap"><table class="table"><thead><tr><th>STT</th><th>Nhân viên</th><th>Ngày OFF</th><th>Lý do</th><th>Trạng thái</th><th>Loại nghỉ</th><th>Thao tác</th></tr></thead><tbody>${r.map(x=>`<tr><td><span class="badge-count">#${x.order}</span></td><td><b>${esc(x.name)}</b><div class="tiny">${esc(x.email)}</div></td><td>${esc(x.date)}</td><td style="max-width:210px;overflow:hidden;text-overflow:ellipsis" title="${esc(x.reason)}">${esc(x.reason)}</td><td><span class="pill ${esc(x.status.toLowerCase())}">${statusLabel(x.status)}</span></td><td>${esc(statusLabel(x.leaveType))}</td><td>${canApprove&&x.status==='PENDING'?`<div class="buttons"><button class="btn sm positive" data-action="approve" data-id="${encode(x.id)}">Duyệt</button><button class="btn sm negative" data-action="reject" data-id="${encode(x.id)}">Từ chối</button></div>`:has('classifyLeave')&&x.status==='APPROVED'&&x.leaveType==='PENDING'?`<button class="btn sm" data-action="classify" data-id="${encode(x.id)}">Chọn lương</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">Chưa có đơn OFF.</td></tr>'}</tbody></table></div></div>`;
}
function membersView(){return `${state.pendingImports?.length?`<div class="callout" style="margin-bottom:15px"><b>${state.pendingImports.length} nhân sự được nhập từ Sheet đang chờ Dev cấp quyền</b><div class="buttons" style="margin-top:10px">${state.pendingImports.map(m=>`<button class="btn sm" data-action="importMember" data-email="${encode(m.email)}">+ ${esc(m.name||m.email)}</button>`).join('')}</div></div>`:''}<div class="section"><h3>Quản lý nhân sự <span class="badge-count">${state.members.length}</span></h3>${button('+ Thêm nhân viên','memberNew','primary')}</div><div class="card">${filters()}<div class="table-wrap"><table class="table"><thead><tr><th>Mã NV</th><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Lead</th><th>Đợt</th><th>Level</th><th>Trạng thái</th><th></th></tr></thead><tbody>${filtered().map(m=>`<tr><td>${esc(m.code)}</td><td><b>${esc(m.name)}</b></td><td>${esc(m.email)}</td><td>${esc(roleName(m))}</td><td>${esc(m.leadEmail||'—')}</td><td>${esc(m.dot)}</td><td>${esc(m.level)}</td><td><span class="pill ${m.active?'approved':'off'}">${m.active?'Đang hoạt động':'Khóa'}</span></td><td>${m.roleId==='dev'?'—':`<button class="btn sm" data-action="editMember" data-email="${encode(m.email)}">Sửa</button>`}</td></tr>`).join('')}</tbody></table></div></div>`}
function rolesView(){return `<div class="section"><h3>Vai trò & phân quyền</h3>${button('+ Vai trò mới','newRole','primary')}</div><div class="grid g3">${state.roles.map(r=>`<div class="card"><div class="row between"><h3>${esc(r.label)}</h3><span class="pill">${esc(r.id)}</span></div><div class="sub">Phạm vi: <b>${esc(roleScopeLabels[r.scope])}</b></div><div class="rule"></div><div class="sub">${[['viewRoster','Xem bảng'],['setStatus','Chuyển ON/OFF'],['approveOff','Duyệt OFF'],['classifyLeave','Phân loại lương']].filter(([k])=>r[k]).map(([,s])=>`✓ ${s}`).join('<br>')||'Cá nhân'}</div><div style="margin-top:14px">${r.id==='dev'?'<span class="notice">Vai trò bảo vệ</span>':`<button class="btn sm" data-action="editRole" data-id="${encode(r.id)}">Điều chỉnh</button>`}</div></div>`).join('')}</div><div class="callout" style="margin-top:15px">Quyền được thực thi tại Cloud Functions. Chỉ Dev thật có quyền tạo/sửa vai trò, dù cấu hình của vai trò khác có thay đổi.</div>`}
function setupView(){const sid=state.integration.spreadsheetId||'';return `<div class="callout">Bước này cần tài khoản Google sở hữu Sheet và dự án Firebase của bạn. Không nhập private key hoặc SYNC_TOKEN vào giao diện web.</div><div class="card" style="margin-top:17px"><h3>Kết nối Google Sheets</h3><p class="sub">Sau khi Admin chạy Apps Script và chia sẻ Sheet cho service account của Firebase Functions, Dev điền Spreadsheet ID:</p><form id="sheetForm" class="buttons"><input class="input" style="flex:1;min-width:190px" name="spreadsheetId" placeholder="Spreadsheet ID" required value="${esc(sid)}"><button class="btn primary" type="submit">Kiểm tra & lưu</button></form>${sid?`<p><a href="https://docs.google.com/spreadsheets/d/${encode(sid)}/edit" target="_blank" rel="noopener">Mở Sheet hiện tại ↗</a></p>`:''}<div class="rule"></div><h3>Đồng bộ lại tháng</h3><p class="sub">Khi cần đưa toàn bộ dữ liệu Firestore tháng được chọn sang Sheet.</p><div class="buttons"><input type="month" class="input" style="width:auto" id="syncMonth" value="${state.month}">${button('Đồng bộ ngay','syncMonth','primary')} ${button('Gửi lại email chờ','retryMail','sm')}</div></div>
 <div class="card" style="margin-top:17px"><h3>6 bước triển khai</h3>${[
 ['Tạo Firebase','Tạo project bằng email Admin, bật Authentication → Google, Firestore và Billing (Blaze) để triển khai Functions.'],
 ['Đăng ký Web App','Lấy apiKey, authDomain, projectId và appId điền vào public/firebase-config.js. Thêm tên miền Hosting vào Authorized domains.'],
 ['Triển khai Firebase','Cài Node.js 22 và Firebase CLI, cấu hình functions/.env.<project-id> với DEV_EMAIL, đặt SYNC_TOKEN và chạy firebase deploy.'],
 ['Tạo Google Sheets','Admin mở script.google.com tạo project Apps Script độc lập, dán scripts/Code.gs, khai báo Script Properties và chạy initTimeNest.'],
 ['Liên kết dữ liệu','Chia sẻ Google Sheets cho runtime service account của Cloud Functions (Editor), dán Spreadsheet ID vào ô bên trên.'],
 ['Phân quyền nhân sự','Dev vào mục Vai trò và Nhân sự tạo tài khoản, sau đó phân nhân viên cho từng Lead.']
 ].map(([h,d],i)=>`<div class="setup-step"><span class="step-num">${i+1}</span><div><b>${esc(h)}</b><div class="sub">${esc(d)}</div></div></div>`).join('')}<p class="sub">Chi tiết lệnh và quy trình nằm trong file <span class="code">README.md</span> đi kèm mã nguồn.</p></div>`}
const views={calendar:calendarView,matrix:matrixView,requests:requestsView,members:membersView,roles:rolesView,setup:setupView};
function modal(title,body,footer=''){modals.innerHTML=`<div class="modal-back" id="modalBg"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="row between"><div><h2>${esc(title)}</h2></div><button class="btn ghost" data-action="close">✕</button></div>${body}${footer}</div></div>`;}
function closeModal(){modals.innerHTML=''}
function offModal(date=''){
 modal('Xin OFF',`<p class="sub">Đơn OFF chỉ được gửi cho ngày tương lai và sẽ xếp hàng theo thứ tự gửi.</p><form id="offForm"><div class="formgrid"><div class="field full"><label>Ngày OFF</label><input type="date" name="date" class="input" required min="${new Date(Date.parse(state.today)+86400000).toISOString().slice(0,10)}" value="${esc(date)}"></div><div class="field full"><label>Lý do</label><textarea name="reason" class="input" required maxlength="800" placeholder="Lý do xin nghỉ…"></textarea></div></div><div class="buttons">${button('Hủy','close')}<button class="btn primary" type="submit">Gửi đơn OFF</button></div></form>`);
}
function editStatusModal(mail,date){const m=state.members.find(x=>x.email===mail);if(!m)return;const old=getEntry(mail,date);
 modal('Cập nhật ON / OFF',`<p class="sub">${esc(m.name)} · ${esc(date)}. Việc sửa sẽ ghi nhật ký và đồng bộ Google Sheets.</p><form id="attendanceForm" data-email="${encode(mail)}" data-date="${date}"><div class="formgrid"><div class="field full"><label>Trạng thái</label><select name="status" class="input"><option value="ON" ${old?.status==='ON'?'selected':''}>ON</option><option value="OFF" ${old?.status==='OFF'?'selected':''}>OFF</option></select></div><div class="field full"><label>Ghi chú thay đổi</label><textarea class="input" name="note" placeholder="Lý do điều chỉnh…"></textarea></div>${has('classifyLeave')?`<div class="field full"><label>Nếu OFF – loại nghỉ</label><select class="input" name="leaveType"><option value="PENDING">Chưa phân loại</option><option value="PAID" ${old?.leaveType==='PAID'?'selected':''}>Có lương</option><option value="UNPAID" ${old?.leaveType==='UNPAID'?'selected':''}>Không lương</option></select></div>`:''}</div><div class="buttons">${button('Đóng','close')}<button class="btn primary" type="submit">Lưu cập nhật</button></div></form>`);
}
function memberModal(email=''){
 const m=state.members.find(x=>x.email===email)||state.pendingImports?.find(x=>x.email===email)||{email:'',name:'',code:'',dot:'',level:'',leadEmail:'',roleId:'staff',active:true};
 const roles=state.roles.filter(r=>r.id!=='dev');
 const roleopts=roles.map(r=>`<option value="${esc(r.id)}" ${m.roleId===r.id?'selected':''}>${esc(r.label)}</option>`).join('');
 const leads=state.members.filter(x=>x.roleId==='lead'&&x.email!==email);
 modal(email?'Sửa nhân viên':'Thêm nhân viên',`<form id="memberForm"><div class="formgrid"><div class="field"><label>Email Google</label><input class="input" type="email" name="email" value="${esc(m.email)}" required ${email?'readonly':''}></div><div class="field"><label>Mã NV</label><input class="input" name="code" value="${esc(m.code)}"></div><div class="field full"><label>Họ tên</label><input class="input" name="name" required value="${esc(m.name)}"></div><div class="field"><label>Đợt</label><input class="input" name="dot" value="${esc(m.dot)}"></div><div class="field"><label>Level</label><input class="input" name="level" value="${esc(m.level)}"></div><div class="field"><label>Vai trò</label><select class="input" name="roleId">${roleopts}</select></div><div class="field"><label>Lead phụ trách</label><select class="input" name="leadEmail"><option value="">Không có</option>${leads.map(l=>`<option value="${esc(l.email)}" ${m.leadEmail===l.email?'selected':''}>${esc(l.name)} (${esc(l.email)})</option>`).join('')}</select></div><div class="field full"><label class="row"><input type="checkbox" name="active" ${m.active?'checked':''}> Tài khoản đang hoạt động</label></div></div><div class="buttons">${button('Hủy','close')}<button type="submit" class="btn primary">Lưu nhân viên</button></div></form>`);
}
function roleModal(id=''){
 const r=state.roles.find(x=>x.id===id)||{id:'',label:'',scope:'self'};
 modal(id?'Sửa vai trò':'Tạo vai trò',`<form id="roleForm"><div class="formgrid"><div class="field"><label>Mã vai trò</label><input class="input" name="id" pattern="[a-z][a-z0-9_-]{1,24}" required value="${esc(r.id)}" ${id?'readonly':''}></div><div class="field"><label>Tên hiển thị</label><input class="input" name="label" required value="${esc(r.label)}"></div><div class="field full"><label>Phạm vi dữ liệu</label><select name="scope" class="input">${['all','team','self'].map(v=>`<option value="${v}" ${v===r.scope?'selected':''}>${roleScopeLabels[v]}</option>`).join('')}</select></div><div class="field full"><label>Chức năng</label><div class="checkset">${[['viewRoster','Xem ma trận'],['setStatus','Sửa ON/OFF'],['approveOff','Duyệt OFF'],['classifyLeave','Quyết định lương']].map(([k,n])=>`<label><input type="checkbox" name="${k}" ${r[k]?'checked':''}>${n}</label>`).join('')}</div></div></div><div class="buttons">${button('Hủy','close')}<button class="btn primary" type="submit">Lưu vai trò</button></div></form>`);
}
function classifyModal(id){const r=state.requests.find(x=>x.id===id);if(!r)return;
 modal('Phân loại nghỉ',`<p class="sub">${esc(r.name)} · ${esc(r.date)} · Đơn #${r.order}</p><form id="classifyForm" data-id="${encode(id)}"><div class="formgrid"><div class="field full"><label>Loại nghỉ</label><select class="input" name="leaveType"><option value="PAID">Có lương</option><option value="UNPAID">Không lương</option></select></div></div><div class="buttons">${button('Hủy','close')}<button type="submit" class="btn primary">Lưu phân loại</button></div></form>`);
}
function decideModal(id,kind){const r=state.requests.find(x=>x.id===id);if(!r)return;
 if(kind==='REJECTED')return act(async()=>{await api('decideOff',{id,decision:'REJECTED'});await load();render();toast('Đã từ chối đơn')});
 modal('Duyệt đơn OFF',`<p class="sub">#${r.order} · ${esc(r.name)} · ${esc(r.date)}</p><div class="callout">${esc(r.reason)}</div><form id="decisionForm" data-id="${encode(id)}"><div class="formgrid"><div class="field full"><label>Phân loại phép</label>${has('classifyLeave')?`<select class="input" name="leaveType"><option value="PAID">Có lương</option><option value="UNPAID">Không lương</option></select>`:'<div class="callout">Lead duyệt OFF; Admin sẽ quyết định có lương/không lương.</div>'}</div></div><div class="buttons">${button('Hủy','close')}<button class="btn positive" type="submit">Xác nhận duyệt</button></div></form>`);
}
function exportCSV(){const data=filtered();const d=daysIn(state.month);const rows=[['Mã NV','Email','Tên','Đợt','Level',...Array.from({length:d},(_,i)=>String(i+1))],...data.map(m=>[m.code,m.email,m.name,m.dot,m.level,...Array.from({length:d},(_,i)=>getEntry(m.email,dateAt(i+1))?.status||'')])];const quote=s=>`"${String(s??'').replace(/^([=+@\-])/,'\'$1').replaceAll('"','""')}"`;const blob=new Blob(['\ufeff'+rows.map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`TimeNest_${state.month}.csv`;a.click();URL.revokeObjectURL(a.href)}
async function refresh(){await load();render()}
// Chỉ dataset được diễn giải; KHÔNG thực thi chuỗi HTML/người dùng.
document.addEventListener('click', async e=>{
 const b=e.target.closest('[data-action]');if(!b||b.disabled)return;
 const action=b.dataset.action;
 if(action==='close'){closeModal();return}
 if(action==='login')return act(async()=>{if(!auth){toast('Chưa cấu hình Firebase');return}try{await signInWithPopup(auth,new GoogleAuthProvider())}catch(err){if(['auth/popup-blocked','auth/cancelled-popup-request','auth/operation-not-supported-in-this-environment'].includes(err.code))await signInWithRedirect(auth,new GoogleAuthProvider());else throw err}});
 if(action==='logout')return act(async()=>{await signOut(auth);state.me=null;state.view='calendar';login()});
 if(action==='nav'||action==='matrix'){state.view=action==='matrix'?'matrix':b.dataset.view;render();return}
 if(action==='prevMonth'||action==='nextMonth'){const [y,m]=state.month.split('-').map(Number);const delta=action==='prevMonth'?-1:1;const next=new Date(y,m-1+delta,1);state.month=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`;return act(refresh)}
 if(action==='refresh')return act(refresh);
 if(action==='on'){if(getEntry(state.me.email,state.today)){toast('Hôm nay đã báo trạng thái');return}return act(async()=>{const x=await api('setAttendance',{status:'ON',date:state.today});await refresh();toast(x.syncing?'Đã báo ON và đồng bộ Sheet':'Đã báo ON vào Firebase')})}
 if(action==='day'){const date=b.dataset.date,entry=getEntry(state.me.email,date);if(entry){modal('Trạng thái ngày '+date,`<div class="card"><h3>${entry.status}</h3><p class="sub">Giờ ghi nhận: ${esc(entry.at||'—')}</p><p>${esc(entry.note||'')}</p></div>`)}else if(date>state.today)offModal(date);else if(date===state.today)toast('Bạn có thể báo ON bằng nút phía trên.');else toast('Ngày chưa có bản ghi.');return}
 if(action==='requestOff'){offModal();return}
 if(action==='editCell'){editStatusModal(dec(b.dataset.email),b.dataset.date);return}
 if(action==='approve'||action==='reject'){decideModal(dec(b.dataset.id),action==='approve'?'APPROVED':'REJECTED');return}
 if(action==='classify'){classifyModal(dec(b.dataset.id));return}
 if(action==='memberNew'){memberModal();return}
 if(action==='importMember'){memberModal(dec(b.dataset.email));return}
 if(action==='editMember'){memberModal(dec(b.dataset.email));return}
 if(action==='newRole'){roleModal();return}
 if(action==='editRole'){roleModal(dec(b.dataset.id));return}
 if(action==='export'){exportCSV();return}
 if(action==='retryMail')return act(async()=>{const r=await api('retryNotifications');toast(`Đã đưa ${r.queued} email vào hàng chờ, còn ${r.pending} chưa xử lý`)});
 if(action==='syncMonth')return act(async()=>{const month=$('syncMonth').value;const r=await api('resyncMonth',{month});toast(`Đã đồng bộ ${r.synced} nhân viên. Lỗi: ${r.failed.length}`);await refresh()});
});
document.addEventListener('input',e=>{if(e.target.id==='searchInput'){state.filter=e.target.value;const pos=e.target.selectionStart;render();const f=$('searchInput');f?.focus();f?.setSelectionRange(pos,pos)}});
document.addEventListener('change',e=>{const m={dotInput:'dot',levelInput:'level',statusInput:'whoStatus',filterDateInput:'filterDate'};if(m[e.target.id]){state[m[e.target.id]]=e.target.value;render()}});
document.addEventListener('submit',e=>{
 if(!['offForm','attendanceForm','memberForm','roleForm','decisionForm','classifyForm','sheetForm'].includes(e.target.id))return;
 e.preventDefault();const form=e.target,values=Object.fromEntries(new FormData(form).entries());
 act(async()=>{
  let warning='';
  if(form.id==='offForm'){const r=await api('requestOff',values);if(!r.mailQueued)warning='Đơn OFF đã lưu, email đang chờ kết nối Google Sheets / gửi lại từ Dev.';}
  if(form.id==='attendanceForm')await api('setAttendance',{...values,email:dec(form.dataset.email),date:form.dataset.date});
  if(form.id==='memberForm')await api('saveMember',{...values,active:form.elements.active.checked});
  if(form.id==='roleForm')await api('saveRole',{...values,...Object.fromEntries(['viewRoster','setStatus','approveOff','classifyLeave'].map(k=>[k,form.elements[k].checked]))});
  if(form.id==='decisionForm')await api('decideOff',{id:dec(form.dataset.id),decision:'APPROVED',leaveType:values.leaveType||'PENDING'});
  if(form.id==='classifyForm'){const r=state.requests.find(x=>x.id===dec(form.dataset.id));if(!r)throw Error('Không tìm thấy đơn');await api('classifyOff',{email:r.email,date:r.date,leaveType:values.leaveType})}
  if(form.id==='sheetForm')await api('connectSheet',values);
  closeModal();await refresh();toast(warning||'Đã lưu thành công');
 });
});
if(!cfgOk){login('Chưa kết nối Firebase. Điền public/firebase-config.js theo README.md, sau đó triển khai Firebase Hosting. Đây là ứng dụng thật, không dùng tài khoản demo giả.');}
else {
 try{
  const app=initializeApp(firebaseConfig);auth=getAuth(app);funcs=getFunctions(app,functionsRegion);
  getRedirectResult(auth).catch(e=>console.error('Google redirect',e));
  onAuthStateChanged(auth,async user=>{if(user){state.auth=user;await start()}else{state.auth=null;state.me=null;login()}});
 }catch(e){console.error(e);login('Cấu hình Firebase lỗi: '+errorMsg(e))}
}
