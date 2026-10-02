import {Storage} from '../storage.js';
import {uid, esc, toast, confirmAction, ymd, parseLocalDateTime} from '../utils.js';

const host=()=>document.getElementById('module-todo');
let filter='today';

function data(){return Storage.get('todos');}
function save(d){Storage.set('todos',d);window.dispatchEvent(new Event('workspace:todo-changed'));}

const DOW=['CN','T2','T3','T4','T5','T6','T7'];

function completionKey(task,date){return `${task.id}@${date}`;}
function isCompleted(d,task,date){return !!d.completions[completionKey(task,date)];}

function dueDateFor(task, base=new Date()){
  const s=task.schedule||{}, today=ymd(base), time=s.time||'09:00';
  if(s.type==='once') return s.date ? parseLocalDateTime(s.date,time) : null;
  if(s.type==='daily') return parseLocalDateTime(today,time);
  if(s.type==='weekdays'){
    const jsDay=base.getDay();
    return (s.days||[]).includes(jsDay) ? parseLocalDateTime(today,time) : null;
  }
  if(s.type==='weekly'){
    const jsDay=base.getDay(), target=Number(s.weekday??1);
    if(jsDay!==target) return null;
    const start=new Date(`${s.startDate||today}T00:00:00`);
    const cur=new Date(`${today}T00:00:00`);
    const weeks=Math.floor((cur-start)/(7*86400000));
    if(weeks<0 || weeks%(Number(s.interval)||1)!==0) return null;
    return parseLocalDateTime(today,time);
  }
  if(s.type==='monthly'){
    const target=Math.min(Number(s.dayOfMonth)||1,new Date(base.getFullYear(),base.getMonth()+1,0).getDate());
    if(base.getDate()!==target)return null;
    return parseLocalDateTime(today,time);
  }
  return null;
}

function occurrenceForToday(task,now=new Date()){
  const due=dueDateFor(task,now); if(!due) return null;
  return {date:ymd(due), due};
}

export function getDueReminders(now=new Date()){
  const d=data(), out=[];
  d.tasks.filter(t=>!t.archived).forEach(task=>{
    if(task.schedule?.type==='once'){
      const due=dueDateFor(task,now); if(!due)return;
      const date=ymd(due), key=completionKey(task,date);
      if(due<=now && !d.completions[key]) out.push({task,occurrenceKey:key,label:`${date} ${task.schedule.time||''}`});
    }else{
      const occ=occurrenceForToday(task,now); if(!occ)return;
      const key=completionKey(task,occ.date);
      if(occ.due<=now && !d.completions[key]) out.push({task,occurrenceKey:key,label:`Hôm nay ${task.schedule.time||''}`});
    }
  });
  return out.sort((a,b)=>a.label.localeCompare(b.label));
}

export function completeOccurrence(taskId,key){
  const d=data(); d.completions[key]=new Date().toISOString(); save(d);
}

function describeSchedule(t){
  const s=t.schedule||{};
  if(s.type==='once') return `${s.date||''} ${s.time||''}`.trim();
  if(s.type==='daily') return `Hàng ngày · ${s.time||''}`;
  if(s.type==='weekdays') return `${(s.days||[]).map(x=>DOW[x]).join(', ')} · ${s.time||''}`;
  if(s.type==='weekly') return `Mỗi ${s.interval||1} tuần · ${DOW[s.weekday??1]} · ${s.time||''}`;
  if(s.type==='monthly') return `Ngày ${s.dayOfMonth||1} hàng tháng · ${s.time||''}`;
  return '';
}

function openTaskModal(task=null){
  const isEdit=!!task, id='todoModal';document.getElementById(id)?.remove();
  const s=task?.schedule||{type:'once',date:ymd(new Date()),time:'09:00',days:[1,2,3,4,5],interval:1,weekday:1,dayOfMonth:1,startDate:ymd(new Date())};
  document.body.insertAdjacentHTML('beforeend',`
  <div class="modal fade" id="${id}" tabindex="-1">
   <div class="modal-dialog modal-dialog-centered modal-lg"><div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">${isEdit?'Sửa Todo':'Thêm Todo'}</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <div class="row g-3">
        <div class="col-12"><label class="form-label">Tiêu đề</label><input id="tdTitle" class="form-control" value="${esc(task?.title||'')}"></div>
        <div class="col-md-8"><label class="form-label">Lịch</label><select id="tdType" class="form-select">
          ${[['once','Một lần'],['daily','Hàng ngày'],['weekdays','Ngày trong tuần'],['weekly','Hàng tuần / mỗi N tuần'],['monthly','Hàng tháng']].map(([v,l])=>`<option value="${v}" ${s.type===v?'selected':''}>${l}</option>`).join('')}
        </select></div>
        <div class="col-md-4"><label class="form-label">Giờ</label><input id="tdTime" type="time" class="form-control" value="${esc(s.time||'09:00')}"></div>
        <div class="col-12" id="tdScheduleOptions"></div>
        <div class="col-md-6"><label class="form-label">Ưu tiên</label><select id="tdPriority" class="form-select">
          ${['low','normal','high'].map(v=>`<option value="${v}" ${(task?.priority||'normal')===v?'selected':''}>${v==='low'?'Thấp':v==='high'?'Cao':'Bình thường'}</option>`).join('')}
        </select></div>
        <div class="col-12"><label class="form-label">Ghi chú</label><textarea id="tdNote" class="form-control" rows="3">${esc(task?.note||'')}</textarea></div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Hủy</button><button id="tdSave" class="btn btn-primary">Lưu</button></div>
   </div></div>
  </div>`);
  const el=document.getElementById(id), modal=bootstrap.Modal.getOrCreateInstance(el), type=document.getElementById('tdType');
  const renderOptions=()=>{
    const v=type.value, box=document.getElementById('tdScheduleOptions');
    if(v==='once') box.innerHTML=`<label class="form-label">Ngày</label><input id="tdDate" type="date" class="form-control" value="${esc(s.date||ymd(new Date()))}">`;
    if(v==='daily') box.innerHTML=`<div class="small text-secondary">Todo xuất hiện mỗi ngày vào giờ đã chọn.</div>`;
    if(v==='weekdays') box.innerHTML=`<label class="form-label d-block">Ngày trong tuần</label><div class="d-flex flex-wrap gap-2">${[0,1,2,3,4,5,6].map(day=>`<label class="btn btn-sm btn-outline-primary"><input class="form-check-input me-1" type="checkbox" name="tdDays" value="${day}" ${(s.days||[]).includes(day)?'checked':''}>${DOW[day]}</label>`).join('')}</div>`;
    if(v==='weekly') box.innerHTML=`<div class="row g-2"><div class="col-md-4"><label class="form-label">Mỗi N tuần</label><input id="tdInterval" type="number" min="1" class="form-control" value="${s.interval||1}"></div><div class="col-md-4"><label class="form-label">Thứ</label><select id="tdWeekday" class="form-select">${[0,1,2,3,4,5,6].map(d=>`<option value="${d}" ${Number(s.weekday??1)===d?'selected':''}>${DOW[d]}</option>`).join('')}</select></div><div class="col-md-4"><label class="form-label">Bắt đầu</label><input id="tdStartDate" type="date" class="form-control" value="${esc(s.startDate||ymd(new Date()))}"></div></div>`;
    if(v==='monthly') box.innerHTML=`<label class="form-label">Ngày trong tháng</label><input id="tdMonthDay" type="number" min="1" max="31" class="form-control" value="${s.dayOfMonth||1}">`;
  };
  type.onchange=renderOptions;renderOptions();
  document.getElementById('tdSave').onclick=()=>{
    const title=document.getElementById('tdTitle').value.trim();if(!title)return toast('Nhập tiêu đề Todo.','warning');
    const st={type:type.value,time:document.getElementById('tdTime').value||'09:00'};
    if(st.type==='once')st.date=document.getElementById('tdDate').value;
    if(st.type==='weekdays')st.days=[...document.querySelectorAll('[name="tdDays"]:checked')].map(x=>Number(x.value));
    if(st.type==='weekly'){st.interval=Math.max(1,Number(document.getElementById('tdInterval').value)||1);st.weekday=Number(document.getElementById('tdWeekday').value);st.startDate=document.getElementById('tdStartDate').value||ymd(new Date());}
    if(st.type==='monthly')st.dayOfMonth=Math.min(31,Math.max(1,Number(document.getElementById('tdMonthDay').value)||1));
    const d=data();
    if(isEdit){const x=d.tasks.find(x=>x.id===task.id);Object.assign(x,{title,priority:document.getElementById('tdPriority').value,note:document.getElementById('tdNote').value,schedule:st,updatedAt:new Date().toISOString()});}
    else d.tasks.push({id:uid('todo'),title,priority:document.getElementById('tdPriority').value,note:document.getElementById('tdNote').value,schedule:st,createdAt:new Date().toISOString()});
    save(d);modal.hide();render();
  };
  el.addEventListener('hidden.bs.modal',()=>el.remove(),{once:true});modal.show();
}

function visibleTasks(d){
  const now=new Date(), today=ymd(now);
  return d.tasks.filter(t=>{
    if(filter==='all')return true;
    if(filter==='today'){
      if(t.schedule?.type==='once')return t.schedule.date===today;
      return !!occurrenceForToday(t,now);
    }
    if(filter==='completed'){
      if(t.schedule?.type==='once')return isCompleted(d,t,t.schedule.date);
      const occ=occurrenceForToday(t,now); return occ ? isCompleted(d,t,occ.date) : false;
    }
    return true;
  });
}

export function render(){
  const d=data(), list=visibleTasks(d), today=ymd(new Date());
  host().innerHTML=`
  <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
    <div><h4 class="mb-1">Việc cần làm</h4><div class="small text-secondary">Todo đến giờ sẽ hiện ở phía trên thanh điều hướng.</div></div>
    <button id="tdAdd" class="btn btn-primary btn-sm"><i class="bi bi-plus-lg me-1"></i>Thêm Todo</button>
  </div>
  <div class="btn-group btn-group-sm mb-3">
    ${[['today','Hôm nay'],['all','Tất cả'],['completed','Đã xong']].map(([v,l])=>`<button class="btn ${filter===v?'btn-light':'btn-outline-secondary'}" data-td-filter="${v}">${l}</button>`).join('')}
  </div>
  <div class="d-grid gap-2">
    ${list.map(t=>{
      const occ=t.schedule.type==='once'?{date:t.schedule.date,due:dueDateFor(t)}:occurrenceForToday(t);
      const date=occ?.date||'', done=date?isCompleted(d,t,date):false, key=date?completionKey(t,date):'';
      return `<article class="todo-item ${done?'done':''}">
        <div class="d-flex gap-2 align-items-start">
          <button class="btn btn-sm ${done?'btn-success':'btn-outline-secondary'}" ${!date?'disabled':''} data-td-complete="${esc(key)}" data-task="${t.id}" title="Hoàn thành lần này"><i class="bi ${done?'bi-check2':'bi-circle'}"></i></button>
          <div class="flex-grow-1 min-w-0">
            <div class="d-flex gap-2 align-items-center"><strong class="text-truncate">${esc(t.title)}</strong>${t.priority==='high'?'<span class="badge text-bg-danger">Cao</span>':t.priority==='low'?'<span class="badge text-bg-secondary">Thấp</span>':''}</div>
            <div class="small text-secondary mt-1">${esc(describeSchedule(t))}</div>
            ${t.note?`<div class="small mt-2">${esc(t.note)}</div>`:''}
          </div>
          <div class="dropdown"><button class="btn btn-sm btn-link text-secondary" data-bs-toggle="dropdown"><i class="bi bi-three-dots"></i></button><ul class="dropdown-menu dropdown-menu-end"><li><button class="dropdown-item" data-td-edit="${t.id}">Sửa</button></li><li><button class="dropdown-item text-danger" data-td-del="${t.id}">Xóa</button></li></ul></div>
        </div>
      </article>`;
    }).join('') || `<div class="empty-state"><i class="bi bi-check2-square fs-1 d-block mb-2"></i>Không có Todo trong bộ lọc này.</div>`}
  </div>`;
  document.getElementById('tdAdd').onclick=()=>openTaskModal();
  host().querySelectorAll('[data-td-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.tdFilter;render();});
  host().querySelectorAll('[data-td-edit]').forEach(b=>b.onclick=()=>openTaskModal(d.tasks.find(x=>x.id===b.dataset.tdEdit)));
  host().querySelectorAll('[data-td-del]').forEach(b=>b.onclick=async()=>{
    const t=d.tasks.find(x=>x.id===b.dataset.tdDel);if(!t)return;
    if(!await confirmAction(`Xóa Todo "${t.title}"?`))return;
    const z=data();z.tasks=z.tasks.filter(x=>x.id!==t.id);Object.keys(z.completions).filter(k=>k.startsWith(`${t.id}@`)).forEach(k=>delete z.completions[k]);save(z);render();
  });
  host().querySelectorAll('[data-td-complete]').forEach(b=>b.onclick=()=>{
    const key=b.dataset.tdComplete;if(!key)return;const z=data();
    if(z.completions[key])delete z.completions[key];else z.completions[key]=new Date().toISOString();
    save(z);render();
  });
}

export const Todos={init(){},render,getDueReminders,completeOccurrence};
