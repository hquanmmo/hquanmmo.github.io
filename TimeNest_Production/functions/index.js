'use strict';
const {onCall, onRequest, HttpsError} = require('firebase-functions/v2/https');
const {defineString, defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');
const {google} = require('googleapis');
const crypto = require('crypto');
admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const REGION = 'asia-southeast1';
const DEV_EMAIL = defineString('DEV_EMAIL');
const SYNC_TOKEN = defineSecret('SYNC_TOKEN');
const tz = 'Asia/Ho_Chi_Minh';
const clean = v => String(v ?? '').trim();
const emailOf = v => clean(v).toLowerCase();
const isEmail = s => /^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(s) && s.length < 190;
const error = (msg, code='failed-precondition') => {throw new HttpsError(code,msg);};
const dateNow = () => Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
const today = () => {let p=dateNow();return `${p.year}-${p.month}-${p.day}`;};
const checkDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d+'T12:00:00Z')) && new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const docAttend = (mail,date) => db.doc(`attendance/${date}_${mail}`);
const monthOf = d => d.slice(0,7);
const roleSeeds = {
  dev:{label:'Dev',scope:'all',viewRoster:true,setStatus:true,approveOff:true,classifyLeave:true},
  admin:{label:'Admin',scope:'all',viewRoster:true,setStatus:true,approveOff:true,classifyLeave:true},
  lead:{label:'Lead',scope:'team',viewRoster:true,setStatus:true,approveOff:true,classifyLeave:false},
  assign:{label:'Assign',scope:'all',viewRoster:true,setStatus:false,approveOff:false,classifyLeave:false},
  staff:{label:'Nhân viên',scope:'self',viewRoster:false,setStatus:false,approveOff:false,classifyLeave:false}
};
const allowedRoles = ['all','team','self'];
const publicMember = (m) => ({email:m.email,name:m.name||'',code:m.code||'',dot:m.dot||'',level:m.level||'',roleId:m.roleId||'staff',leadEmail:m.leadEmail||'',active:m.active!==false,createdAt:m.createdAt||''});
const stamp = () => admin.firestore.Timestamp.now();
const toISO = v => v && v.toDate ? v.toDate().toISOString() : (typeof v==='string' ? v : '');
const normalizeOutput = (v) => JSON.parse(JSON.stringify(v,(_,x)=>x&&x.toDate?x.toDate().toISOString():x));
function authorizedToken(req){
  if(!req.auth || !req.auth.token || !req.auth.token.email_verified || req.auth.token.firebase?.sign_in_provider!=='google.com') error('Cần đăng nhập tài khoản Google đã xác minh.','unauthenticated');
  const mail=emailOf(req.auth.token.email);
  if(!isEmail(mail))error('Email không hợp lệ.','unauthenticated');
  return mail;
}
async function actor(req){
 const mail=authorizedToken(req), snap=await db.doc(`members/${mail}`).get();
 if(!snap.exists || snap.data().active===false)error('Tài khoản chưa được Dev cấp quyền.','permission-denied');
 const m={...snap.data(),email:mail};
 const r=await db.doc(`roles/${m.roleId}`).get();
 if(!r.exists)error('Vai trò chưa được cấu hình.','permission-denied');
 return {mail,profile:m,role:r.data(),dev:m.roleId==='dev' && mail===emailOf(DEV_EMAIL.value())};
}
const has = (a,perm) => a.dev || (perm==='classifyLeave' ? a.profile.roleId==='admin' && !!a.role[perm] : !!a.role[perm]);
function inScope(a,member){
 if(a.dev || a.profile.roleId==='admin')return true;
 // Lead KHÔNG THỂ xem/sửa nhân viên Lead khác, dù cấu hình vai trò bị sửa nhầm.
 if(a.profile.roleId==='lead')return emailOf(member.leadEmail)===a.mail || emailOf(member.email)===a.mail;
 if(a.role.scope==='all' && (has(a,'viewRoster')||has(a,'setStatus')||has(a,'approveOff')||has(a,'classifyLeave')))return true;
 if(a.role.scope==='team')return emailOf(member.leadEmail)===a.mail || emailOf(member.email)===a.mail;
 return emailOf(member.email)===a.mail;
}
async function targetMember(email){
 const mail=emailOf(email), snap=await db.doc(`members/${mail}`).get();
 if(!snap.exists || snap.data().active===false)error('Không tìm thấy nhân viên đang hoạt động.','not-found');
 return {...snap.data(),email:mail};
}
function requireTarget(a,m,permission){
 if(!has(a,permission) || !inScope(a,m))error('Bạn không có quyền thao tác với nhân viên này.','permission-denied');
}
const callable = fn => onCall({region:REGION, timeoutSeconds:120, maxInstances:20, enforceAppCheck:false}, fn);

// Chỉ email DEV_EMAIL có thể khởi tạo. Không nhận role từ trình duyệt.
exports.openSession = callable(async req => {
 const mail=authorizedToken(req), ref=db.doc(`members/${mail}`);
 const existing=await ref.get();
 if(!existing.exists && mail===emailOf(DEV_EMAIL.value())){
  await db.runTransaction(async tx => {
   let [one, user] = await Promise.all([tx.get(db.doc('system/owner')),tx.get(ref)]);
   if(!one.exists && !user.exists){
    for(const [id,r] of Object.entries(roleSeeds))tx.set(db.doc(`roles/${id}`),r);
    tx.set(ref,{email:mail,name:clean(req.auth.token.name)||'Developer',roleId:'dev',leadEmail:'',code:'DEV',dot:'',level:'',active:true,createdAt:new Date().toISOString()});
    tx.set(db.doc('system/owner'),{email:mail,createdAt:new Date().toISOString()});
   }
  });
 }
 const a=await actor(req);
 return {profile:publicMember(a.profile),role:a.role,dev:a.dev};
});

exports.dashboard = callable(async req => {
 const a=await actor(req), month=clean(req.data?.month)||monthOf(today());
 if(!/^\d{4}-\d{2}$/.test(month)||!checkDate(month+'-01'))error('Tháng không hợp lệ.');
 const all=(await db.collection('members').limit(800).get()).docs.map(d=>publicMember(d.data()));
 const visible=all.filter(m=>(a.dev||m.active)&&inScope(a,m));
 const allowed=new Set(visible.map(m=>m.email));
 const logs=(await db.collection('attendance').where('month','==',month).limit(12000).get()).docs.map(d=>d.data()).filter(d=>allowed.has(d.email));
 const off=(await db.collection('offRequests').orderBy('createdAt','desc').limit(1500).get()).docs.map(d=>({id:d.id,...d.data()})).filter(d=>d.email===a.mail || (has(a,'approveOff') && allowed.has(d.email)));
 const roles=a.dev?(await db.collection('roles').get()).docs.map(d=>({id:d.id,...d.data()})):[];
 const integration= a.dev ? (await db.doc('system/integration').get()).data()||{} : {};
 const pendingImports=a.dev?(await db.collection('pendingImports').limit(300).get()).docs.map(d=>d.data()):[];
 return {me:publicMember(a.profile),role:a.role,dev:a.dev,members:visible,attendance:logs.map(x=>({...x,at:toISO(x.at),updatedAt:toISO(x.updatedAt)})),requests:off.map(x=>({...x,createdAt:toISO(x.createdAt),updatedAt:toISO(x.updatedAt)})),roles,pendingImports,integration:{spreadsheetId:integration.spreadsheetId||''},today:today(),month};
});

exports.saveRole = callable(async req=>{
 const a=await actor(req); if(!a.dev)error('Chỉ Dev tạo/sửa quyền.','permission-denied');
 const d=req.data||{}, id=clean(d.id).toLowerCase();
 if(!/^[a-z][a-z0-9_-]{1,24}$/.test(id)||id==='dev')error('Tên vai trò không hợp lệ hoặc được bảo vệ.');
 const scope=clean(d.scope); if(!allowedRoles.includes(scope))error('Phạm vi không hợp lệ.');
 const role={label:clean(d.label).slice(0,60)||id,scope,viewRoster:!!d.viewRoster,setStatus:!!d.setStatus,approveOff:!!d.approveOff,classifyLeave:!!d.classifyLeave};
 // Không cấp quyền lập tài khoản/phân quyền cho vai trò tùy biến; chỉ Dev được quyền này.
 await db.doc(`roles/${id}`).set(role);
 await audit(a.mail,'saveRole',id,role);
 return {ok:true};
});
exports.saveMember = callable(async req=>{
 const a=await actor(req); if(!a.dev)error('Chỉ Dev có thể tạo tài khoản, gán vai trò và nhóm Lead.','permission-denied');
 const d=req.data||{}, mail=emailOf(d.email), roleId=clean(d.roleId).toLowerCase(), leadEmail=emailOf(d.leadEmail);
 if(!isEmail(mail)||mail===emailOf(DEV_EMAIL.value()))error('Email không hợp lệ hoặc được bảo vệ.');
 if(roleId==='dev'||!(await db.doc(`roles/${roleId}`).get()).exists)error('Vai trò không hợp lệ.');
 if(leadEmail){const lead=await db.doc(`members/${leadEmail}`).get();if(!lead.exists||lead.data().active===false||lead.data().roleId!=='lead')error('Email Lead phải thuộc người có vai trò Lead đang hoạt động.');}
 const old=(await db.doc(`members/${mail}`).get()).data();
 const m={email:mail,name:clean(d.name).slice(0,100)||mail.split('@')[0],code:clean(d.code).slice(0,36),dot:clean(d.dot).slice(0,50),level:clean(d.level).slice(0,40),roleId,leadEmail,active:d.active!==false,createdAt:old?.createdAt||new Date().toISOString()};
 await db.doc(`members/${mail}`).set(m);
 await db.doc(`pendingImports/${mail}`).delete().catch(()=>{});
 await audit(a.mail,'saveMember',mail,{roleId,leadEmail,active:m.active});
 await mirrorStaff(m).catch(e=>console.error('Staff sheet sync pending',e.message));
 return {ok:true};
});

async function audit(actorMail,action,target,details={}){
 return db.collection('audit').add({actor:actorMail,action,target,details,createdAt:stamp()});
}
async function putAttendance({email,date,status,source,actorMail,note='',leaveType='PENDING',selfOnce=false}){
 const ref=docAttend(email,date), when=stamp();
 await db.runTransaction(async tx=>{
  const cur=await tx.get(ref);
  if(selfOnce && cur.exists)error('Bạn đã báo ON/OFF cho ngày này, không thể báo lại.');
  const v={email,date,month:monthOf(date),status,source,actorMail,at:when,updatedAt:when,note:clean(note).slice(0,250),leaveType:status==='OFF'?leaveType:'',};
  tx.set(ref,v);
 });
 await audit(actorMail,'attendance',`${email}:${date}`,{status,source,leaveType});
 return await mirrorAttendance(email,date);
}
exports.setAttendance = callable(async req=>{
 const a=await actor(req), d=req.data||{}, date=clean(d.date),status=clean(d.status).toUpperCase();
 if(!checkDate(date)||!['ON','OFF'].includes(status))error('Ngày/trạng thái không hợp lệ.');
 const email=emailOf(d.email||a.mail), m=await targetMember(email);
 const ownON=email===a.mail && status==='ON' && date===today();
 if(ownON){
  const syncing=await putAttendance({email,date,status,source:'APP_ON',actorMail:a.mail,selfOnce:true});
  return {ok:true,syncing};
 }
 requireTarget(a,m,'setStatus');
 const pay=clean(d.leaveType).toUpperCase();
 const leaveType=status==='OFF'&&has(a,'classifyLeave')&&['PAID','UNPAID'].includes(pay)?pay:'PENDING';
 const syncing=await putAttendance({email,date,status,source:'MANAGER',actorMail:a.mail,note:clean(d.note),leaveType});
 return {ok:true,syncing};
});
exports.requestOff = callable(async req=>{
 const a=await actor(req), date=clean(req.data?.date),reason=clean(req.data?.reason).slice(0,800);
 if(!checkDate(date)||date<=today())error('OFF phải được gửi trước ngày làm việc.');
 if(date>new Date(Date.now()+366*86400000).toISOString().slice(0,10))error('Chỉ đăng ký trong vòng 1 năm.');
 if(!reason)error('Vui lòng điền lý do OFF.');
 const ref=db.doc(`offRequests/${date}_${a.mail}`), count=db.doc('counters/offSerial');
 const record=await db.runTransaction(async tx=>{
  const [old,counter]=await Promise.all([tx.get(ref),tx.get(count)]);
  if(old.exists)error('Bạn đã gửi đơn OFF ngày này.');
  const order=(counter.data()?.value||0)+1;
  const row={email:a.mail,name:a.profile.name,date,reason,order,status:'PENDING',leadEmail:a.profile.leadEmail||'',leaveType:'PENDING',createdAt:stamp(),updatedAt:stamp()};
  tx.set(ref,row);tx.set(count,{value:order});return {...row,id:ref.id};
 });
 await audit(a.mail,'requestOff',ref.id,{order:record.order});
 const mailed=await queueNotice('NEW',record);
 return {ok:true,order:record.order,mailQueued:mailed};
});
exports.decideOff = callable(async req=>{
 const a=await actor(req), id=clean(req.data?.id),decision=clean(req.data?.decision).toUpperCase(),leaveType=clean(req.data?.leaveType).toUpperCase();
 if(!/^\d{4}-\d{2}-\d{2}_.+@.+$/.test(id)||!['APPROVED','REJECTED'].includes(decision))error('Đơn/trạng thái không hợp lệ.');
 const ref=db.doc(`offRequests/${id}`), orig=await ref.get();
 if(!orig.exists)error('Đơn không tồn tại.');
 const r=orig.data(),m=await targetMember(r.email);requireTarget(a,m,'approveOff');
 if(r.status!=='PENDING')error('Đơn đã được xử lý.');
 const classified=has(a,'classifyLeave')&&['PAID','UNPAID'].includes(leaveType)?leaveType:'PENDING';
 await db.runTransaction(async tx=>{
  const doc=await tx.get(ref);if(!doc.exists||doc.data().status!=='PENDING')error('Đơn đã được xử lý.');
  tx.update(ref,{status:decision,leaveType:decision==='APPROVED'?classified:'',approver:a.mail,updatedAt:stamp()});
  if(decision==='APPROVED')tx.set(docAttend(r.email,r.date),{email:r.email,date:r.date,month:monthOf(r.date),status:'OFF',leaveType:classified,source:'OFF_APPROVAL',actorMail:a.mail,at:stamp(),updatedAt:stamp(),note:r.reason});
 });
 await audit(a.mail,'decideOff',id,{decision,classified});
 if(decision==='APPROVED')await mirrorAttendance(r.email,r.date);
 await queueNotice(decision,{...r,id,approver:a.mail,leaveType:classified});
 return {ok:true};
});
exports.classifyOff = callable(async req=>{
 const a=await actor(req);if(!has(a,'classifyLeave'))error('Chỉ Admin/Dev có quyền phân loại lương.','permission-denied');
 const email=emailOf(req.data?.email),date=clean(req.data?.date),type=clean(req.data?.leaveType).toUpperCase();
 if(!checkDate(date)||!['PAID','UNPAID'].includes(type))error('Dữ liệu không hợp lệ.');
 const m=await targetMember(email); requireTarget(a,m,'classifyLeave');
 const ref=docAttend(email,date), snap=await ref.get();
 if(!snap.exists||snap.data().status!=='OFF')error('Ngày này chưa OFF.');
 await ref.update({leaveType:type,updatedAt:stamp(),actorMail:a.mail});
 const offReq=db.doc(`offRequests/${date}_${email}`);
 if((await offReq.get()).exists)await offReq.update({leaveType:type});
 await audit(a.mail,'classifyOff',`${email}:${date}`,{type});
 const syncing=await mirrorAttendance(email,date);return {ok:true,syncing};
});

exports.connectSheet = callable(async req=>{
 const a=await actor(req);if(!a.dev)error('Chỉ Dev kết nối Sheet.','permission-denied');
 const spreadsheetId=clean(req.data?.spreadsheetId);
 if(!/^[A-Za-z0-9_-]{20,160}$/.test(spreadsheetId))error('Spreadsheet ID không hợp lệ.');
 const sh=await sheetsClient();
 try {await sh.spreadsheets.get({spreadsheetId,fields:'spreadsheetId,properties.title'});} catch(e){error('Không truy cập được Sheet. Hãy chia sẻ Sheet cho service account của Cloud Functions.');}
 await db.doc('system/integration').set({spreadsheetId,updatedBy:a.mail,updatedAt:stamp()});
 await audit(a.mail,'connectSheet',spreadsheetId);return {ok:true};
});
exports.resyncMonth = callable(async req=>{
 const a=await actor(req);if(!a.dev)error('Chỉ Dev đồng bộ toàn bộ tháng.','permission-denied');
 const month=clean(req.data?.month);if(!/^\d{4}-\d{2}$/.test(month)||!checkDate(month+'-01'))error('Tháng không hợp lệ.');
 const docs=(await db.collection('members').limit(600).get()).docs;
 let synced=0,failed=[];
 for(const d of docs){try{await mirrorStaff(d.data());const r=await mirrorRow(d.id,month);if(r) synced++;}catch(e){failed.push(`${d.id}: ${e.message}`);}}
 return {synced,failed:failed.slice(0,15)};
});

async function sheetsClient(){return google.sheets({version:'v4',auth:new google.auth.GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets']})});}
async function integrationId(){return (await db.doc('system/integration').get()).data()?.spreadsheetId||'';}
const sheetTitle=m=>`CC_${m.replace('-','_')}`;
const q=s=>"'"+s.replace(/'/g,"''")+"'";
const columnNames=['STT','Mã NV','Email','Tên','Đợt','Level','Nghỉ có lương','Nghỉ không lương','Số ngày làm việc',...Array.from({length:31},(_,i)=>String(i+1))];
async function ensureMonth(sh,spreadsheetId,month){
 const title=sheetTitle(month),get=await sh.spreadsheets.get({spreadsheetId,fields:'sheets(properties(sheetId,title))'});
 let p=get.data.sheets?.find(s=>s.properties.title===title)?.properties;
 if(!p){
  try{const res=await sh.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[{addSheet:{properties:{title,gridProperties:{rowCount:1500,columnCount:40,frozenRowCount:1,frozenColumnCount:6}}}}]}});p=res.data.replies[0].addSheet.properties;}
  catch(e){const again=await sh.spreadsheets.get({spreadsheetId,fields:'sheets(properties(sheetId,title))'});p=again.data.sheets?.find(s=>s.properties.title===title)?.properties;if(!p)throw e;}
  await sh.spreadsheets.values.update({spreadsheetId,range:`${q(title)}!A1:AN1`,valueInputOption:'RAW',requestBody:{values:[columnNames]}});
 }
 return p;
}
async function mirrorStaff(m){
 const id=await integrationId();if(!id)return false;
 const sh=await sheetsClient(), range="'NHAN_SU'!B2:B";
 const out=await sh.spreadsheets.values.get({spreadsheetId:id,range});
 const rows=out.data.values||[],ix=rows.findIndex(r=>emailOf(r[0])===m.email);
 const row=ix>=0?ix+2:rows.length+2;
 const values=[[m.code||'',m.email,m.name||'',m.dot||'',m.level||'','Role và Lead chỉ sửa qua Dev']];
 await sh.spreadsheets.values.update({spreadsheetId:id,range:`'NHAN_SU'!A${row}:F${row}`,valueInputOption:'RAW',requestBody:{values}});
 return true;
}
async function rowIndex(sh,id,title,email){
 const key=`${title}_${email}`,ref=db.doc(`sheetRows/${key}`), known=(await ref.get()).data();if(known)return known.rowIndex;
 const v=await sh.spreadsheets.values.get({spreadsheetId:id,range:`${q(title)}!C2:C1500`});
 const arr=v.data.values||[];const idx=arr.findIndex(row=>emailOf(row[0])===email);
 const counter=db.doc(`counters/${title}`);
 return await db.runTransaction(async tx=>{
  const [found,cn]=await Promise.all([tx.get(ref),tx.get(counter)]);
  if(found.exists)return found.data().rowIndex;
  const row=idx>=0?idx+1:Math.max(cn.data()?.next||1,arr.length+1);
  tx.set(ref,{rowIndex:row,email,title});
  tx.set(counter,{next:Math.max(cn.data()?.next||1,row+1)});
  return row;
 });
}
async function mirrorAttendance(email,date){
 try{return await mirrorRow(email,monthOf(date));}
 catch(e){console.error('Sheet sync pending',email,date,e.message);await db.collection('syncErrors').add({email,date,message:e.message,at:stamp()});return false;}
}
async function mirrorRow(email,month){
 const id=await integrationId();if(!id)return false;
 const memberSnap=await db.doc(`members/${email}`).get();if(!memberSnap.exists)return false;
 const m=memberSnap.data(), sh=await sheetsClient(), sheet=await ensureMonth(sh,id,month),title=sheetTitle(month);
 const row=await rowIndex(sh,id,title,email);
 const entries=(await db.collection('attendance').where('month','==',month).where('email','==',email).get()).docs.map(x=>x.data());
 let paid=0,unpaid=0,ons=0;
 const days=Array.from({length:31},()=>null);
 for(const x of entries){const day=Number(x.date.slice(8))-1;if(day<0||day>=31)continue;days[day]=x;if(x.status==='ON')ons++;if(x.status==='OFF'&&x.leaveType==='PAID')paid++;if(x.status==='OFF'&&x.leaveType==='UNPAID')unpaid++;}
 const cells=[{numberValue:row},{stringValue:m.code||''},{stringValue:email},{stringValue:m.name||''},{stringValue:m.dot||''},{stringValue:m.level||''},{numberValue:paid},{numberValue:unpaid},{numberValue:ons}].map(userEnteredValue=>({userEnteredValue}));
 days.forEach(x=>{
  if(!x){cells.push({userEnteredValue:{stringValue:''},note:''});return;}
  const time=toISO(x.at);let human=time?new Date(time).toLocaleString('vi-VN',{timeZone:tz,hour12:false}):'';
  let note=x.status==='ON'?`Báo ON lúc ${human}`:`OFF • ${x.leaveType||'PENDING'}`;
  if(x.actorMail&&x.actorMail!==email)note+=`\nCập nhật bởi: ${x.actorMail}`;
  if(x.note)note+=`\n${x.note}`;
  cells.push({userEnteredValue:{stringValue:x.status||''},note});
 });
 await sh.spreadsheets.batchUpdate({spreadsheetId:id,requestBody:{requests:[{updateCells:{start:{sheetId:sheet.sheetId,rowIndex:row,columnIndex:0},rows:[{values:cells}],fields:'userEnteredValue,note'}}]}});
 return true;
}
async function queueNotice(kind,record){
 const noticeId=`${kind}_${record.id}`;
 const noticeRef=db.doc(`notificationQueue/${noticeId}`);
 const existing=await noticeRef.get();
 if(existing.exists && existing.data().status==='QUEUED')return true;
 await noticeRef.set({kind,record,status:'PENDING',createdAt:stamp()});
 const id=await integrationId();if(!id)return false;
 try{
  const all=(await db.collection('members').where('roleId','in',['admin','dev']).get()).docs.map(d=>d.id);
  const to=[...new Set([...all,record.leadEmail||'',record.email].filter(isEmail))];
  const subject=`[TimeNest] ${kind==='NEW'?'Đơn OFF mới #'+record.order:kind==='APPROVED'?'Đơn OFF đã duyệt':'Đơn OFF bị từ chối'} • ${record.name||record.email}`;
  const body=`Nhân viên: ${record.name||''} (${record.email})\nNgày OFF: ${record.date}\nThứ tự đơn: #${record.order||''}\nLý do: ${record.reason||''}\nTrạng thái: ${kind}\nNgười xử lý: ${record.approver||''}\nLoại phép: ${record.leaveType||'Chưa phân loại'}\nVui lòng xem TimeNest để xử lý.`;
  const sh=await sheetsClient();
  const current=await sh.spreadsheets.values.get({spreadsheetId:id,range:"'EMAIL_QUEUE'!A2:A"});
  const already=(current.data.values||[]).some(x=>x[0]===noticeId);
  if(!already)await sh.spreadsheets.values.append({spreadsheetId:id,range:"'EMAIL_QUEUE'!A:E",valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',requestBody:{values:[[noticeId,to.join(','),subject,body,'PENDING']]}});
  await noticeRef.update({status:'QUEUED',queuedAt:stamp()});
  return true;
 }catch(e){console.error('Email queue error',e.message);await db.collection('syncErrors').add({kind:'EMAIL',recordId:record.id,message:e.message,at:stamp()});return false;}
}

exports.retryNotifications = callable(async req=>{
 const a=await actor(req);if(!a.dev)error('Chỉ Dev được gửi lại hàng đợi.','permission-denied');
 const queue=(await db.collection('notificationQueue').where('status','==','PENDING').limit(100).get()).docs;
 let queued=0;
 for(const d of queue){if(await queueNotice(d.data().kind,d.data().record))queued++;}
 return {queued,pending:queue.length-queued};
});

// Endpoint dành RIÊNG cho standalone Apps Script do Admin sở hữu.
exports.sheetWebhook = onRequest({region:REGION,secrets:[SYNC_TOKEN],maxInstances:3},async(req,res)=>{
 try{
  if(req.method!=='POST')return res.status(405).send('Method');
  const expected=Buffer.from(SYNC_TOKEN.value()||''), supplied=Buffer.from(String(req.get('x-sync-token')||''));
  if(expected.length<32||expected.length!==supplied.length||!crypto.timingSafeEqual(expected,supplied))return res.status(401).send('Unauthorized');
  const source=await integrationId();
  if(!source || req.body?.spreadsheetId!==source)return res.status(403).send('Spreadsheet mismatch');
  const edits=Array.isArray(req.body.edits)?req.body.edits:[];
  const meta=Array.isArray(req.body.meta)?req.body.meta:[];
  if(edits.length+meta.length>350)return res.status(413).send('Too many cells');
  let applied=0, skipped=0;
  for(const x of edits){
   const email=emailOf(x.email),date=clean(x.date),status=clean(x.status).toUpperCase();
   if(!isEmail(email)||!checkDate(date)||!['ON','OFF',''].includes(status)){skipped++;continue;}
   const member=await db.doc(`members/${email}`).get();if(!member.exists){skipped++;continue;}
   const ref=docAttend(email,date),now=stamp();
   if(!status)await ref.delete();
   else {
    const old=await ref.get();
    if(old.exists && old.data().status===status){skipped++;continue;}
    await ref.set({email,date,month:monthOf(date),status,leaveType:status==='OFF'?'PENDING':'',source:'GOOGLE_SHEET',actorMail:'admin-sheet',at:now,updatedAt:now,note:clean(x.note).slice(0,250)});
   }
   await audit('admin-sheet','sheetEdit',`${email}:${date}`,{status});applied++;
  }
  for(const x of meta){
   const mail=emailOf(x.email);if(!isEmail(mail)){skipped++;continue;}const snap=await db.doc(`members/${mail}`).get();if(!snap.exists){await db.doc(`pendingImports/${mail}`).set({email:mail,name:clean(x.name).slice(0,100),code:clean(x.code).slice(0,36),dot:clean(x.dot).slice(0,50),level:clean(x.level).slice(0,40),createdAt:new Date().toISOString()});skipped++;continue;}
   const data={name:clean(x.name).slice(0,100)||snap.data().name,code:clean(x.code).slice(0,36),dot:clean(x.dot).slice(0,50),level:clean(x.level).slice(0,40)};
   await snap.ref.update(data);applied++;
  }
  return res.json({ok:true,applied,skipped});
 }catch(e){console.error('webhook',e);return res.status(500).send('Error');}
});
