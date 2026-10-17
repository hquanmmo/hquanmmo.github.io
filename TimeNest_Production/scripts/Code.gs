/**
 * TimeNest — standalone Apps Script, được tạo và chạy DƯỚI EMAIL ADMIN.
 * Không chia sẻ project Apps Script cho nhân viên.
 * Trong Project Settings → Script properties, thêm:
 *   FUNCTION_SERVICE_ACCOUNT = email runtime service account của Cloud Functions
 *   SYNC_WEBHOOK_URL = URL sheetWebhook (Firebase Console → Functions)
 *   SYNC_TOKEN = giá trị bí mật giống firebase functions:secrets:set SYNC_TOKEN
 *   SPREADSHEET_ID = (được tự động tạo bởi initTimeNest, không cần nhập)
 */
const HEADERS = ['STT','Mã NV','Email','Tên','Đợt','Level','Nghỉ có lương','Nghỉ không lương','Số ngày làm việc',...Array.from({length:31},(_,i)=>String(i+1))];
const STAFF_HEADERS = ['Mã NV','Email','Tên','Đợt','Level','Ghi chú'];
const MAIL_HEADERS = ['ID','Email nhận','Tiêu đề','Nội dung','Trạng thái'];
const PROPS = () => PropertiesService.getScriptProperties();
function initTimeNest(){
 const p=PROPS(), existing=p.getProperty('SPREADSHEET_ID');
 let ss;
 if(existing) ss=SpreadsheetApp.openById(existing);
 else {
  ss=SpreadsheetApp.create('TimeNest - Chấm công & Xin OFF');
  p.setProperty('SPREADSHEET_ID',ss.getId());
 }
 ensureTab_(ss,'EMAIL_QUEUE',MAIL_HEADERS);
 ensureTab_(ss,'NHAN_SU',STAFF_HEADERS);
 let d=new Date(),month=Utilities.formatDate(d,'Asia/Ho_Chi_Minh','yyyy_MM');
 ensureTab_(ss,'CC_'+month,HEADERS);
 const defaultTab=ss.getSheetByName('Sheet1');if(defaultTab&&ss.getSheets().length>1)ss.deleteSheet(defaultTab);
 const sa=p.getProperty('FUNCTION_SERVICE_ACCOUNT');
 if(sa)DriveApp.getFileById(ss.getId()).addEditor(sa);
 ScriptApp.getProjectTriggers().filter(t=>['sheetEdited','sendPendingEmails'].includes(t.getHandlerFunction())).forEach(t=>ScriptApp.deleteTrigger(t));
 ScriptApp.newTrigger('sheetEdited').forSpreadsheet(ss.getId()).onEdit().create();
 ScriptApp.newTrigger('sendPendingEmails').timeBased().everyMinutes(1).create();
 Logger.log('TIME NEST SHEET URL: '+ss.getUrl());
 Logger.log('SPREADSHEET_ID: '+ss.getId());
 return ss.getUrl();
}
function ensureTab_(ss,name,headers){
 let sh=ss.getSheetByName(name)||ss.insertSheet(name);
 sh.getRange(1,1,1,headers.length).setValues([headers]);
 sh.getRange(1,1,1,headers.length).setBackground('#142b4e').setFontColor('#ffffff').setFontWeight('bold');
 sh.setFrozenRows(1);
 if(name.startsWith('CC_'))sh.setFrozenColumns(6);
 return sh;
}
function sheetEdited(e){
 if(!e||!e.range)return;
 const p=PROPS(),url=p.getProperty('SYNC_WEBHOOK_URL'),secret=p.getProperty('SYNC_TOKEN'),ss=e.source;
 if(!url||!secret)throw Error('Cấu hình SYNC_WEBHOOK_URL và SYNC_TOKEN trước.');
 if(ss.getId()!==p.getProperty('SPREADSHEET_ID'))return;
 const sheet=e.range.getSheet(),title=sheet.getName(),row=e.range.getRow(),col=e.range.getColumn();
 if(row===1)return;
 if(title==='NHAN_SU'){
  const meta=[];
  const raw=sheet.getRange(row,1,e.range.getNumRows(),6).getValues();
  raw.forEach(r=>{const mail=String(r[1]||'').trim().toLowerCase();if(mail.includes('@'))meta.push({email:mail,code:String(r[0]||''),name:String(r[2]||''),dot:String(r[3]||''),level:String(r[4]||'')})});
  if(meta.length)postSync_(url,secret,ss.getId(),[],meta);
  return;
 }
 if(!/^CC_\d{4}_\d{2}$/.test(title))return;
 if(e.range.getNumRows()*e.range.getNumColumns()>300)throw Error('Chỉ hỗ trợ tối đa 300 ô/lần chỉnh sửa.');
 const month=title.slice(3).replace('_','-');
 const vals=sheet.getRange(row,1,e.range.getNumRows(),40).getValues();
 const edits=[],meta=[];
 for(let i=0;i<vals.length;i++){
  const v=vals[i],mail=String(v[2]||'').trim().toLowerCase();
  if(!mail.includes('@'))continue;
  const index=row+i;
  if(col<=6){
   meta.push({email:mail,code:String(v[1]||''),name:String(v[3]||''),dot:String(v[4]||''),level:String(v[5]||'')});
  }
  for(let j=Math.max(10,col);j<=Math.min(40,col+e.range.getNumColumns()-1);j++){
   const day=j-9,status=String(v[j-1]||'').trim().toUpperCase();
   const date=month+'-'+('0'+day).slice(-2);
   if(!/^(ON|OFF|)$/.test(status))continue;
   const cell=sheet.getRange(index,j);
   if(status==='ON'&&!cell.getNote())cell.setNote('Báo ON lúc '+Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','dd/MM/yyyy HH:mm:ss'));
   edits.push({email:mail,date,status,note:cell.getNote()});
  }
 }
 if(!edits.length&&!meta.length)return;
 postSync_(url,secret,ss.getId(),edits,meta);
}
function postSync_(url,secret,id,edits,meta){
 const result=UrlFetchApp.fetch(url,{
  method:'post',contentType:'application/json',payload:JSON.stringify({spreadsheetId:id,edits,meta}),
  headers:{'X-Sync-Token':secret},muteHttpExceptions:true
 });
 if(result.getResponseCode()!==200)throw Error('Đồng bộ thất bại: '+result.getResponseCode()+' '+result.getContentText().slice(0,250));
}
// Chạy tối đa mỗi phút, gửi từ Gmail của người tạo trigger (Admin).
// Không xử lý URL/HTML tùy ý; chỉ email thuần từ hàng chờ Cloud Functions đã tạo.
function sendPendingEmails(){
 const ss=SpreadsheetApp.openById(PROPS().getProperty('SPREADSHEET_ID'));
 const sh=ss.getSheetByName('EMAIL_QUEUE');if(!sh||sh.getLastRow()<2)return;
 const rows=sh.getRange(2,1,sh.getLastRow()-1,5).getValues();
 for(let i=0;i<rows.length;i++){
  const [id,to,subject,body,status]=rows[i];
  if(status!=='PENDING'||!to)continue;
  // Ghi trạng thái trước gửi để không gửi trùng khi trigger bị chạy lại.
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
  try{
   const cell=sh.getRange(i+2,5);if(cell.getValue()!=='PENDING')continue;
   cell.setValue('PROCESSING');SpreadsheetApp.flush();
   try{MailApp.sendEmail(String(to),String(subject),String(body));cell.setValue('SENT');}
   catch(e){cell.setValue('ERROR');cell.setNote(String(e));}
  }finally{lock.releaseLock();}
 }
}
// Chạy thủ công nếu một email đang ERROR sau khi đã sửa nguyên nhân.
function retryFailedEmails(){
 const sh=SpreadsheetApp.openById(PROPS().getProperty('SPREADSHEET_ID')).getSheetByName('EMAIL_QUEUE');
 for(let r=2;r<=sh.getLastRow();r++)if(sh.getRange(r,5).getValue()==='ERROR')sh.getRange(r,5).setValue('PENDING');
}
