import {Storage} from './storage.js';
import {downloadText, toast, confirmAction} from './utils.js';
import {Bookmarks} from './modules/bookmarks.js';
import {Todos} from './modules/todos.js';
import {PowerShell} from './modules/powershell.js';
import {TwoFA} from './modules/twofa.js';

const modules = {bookmark:Bookmarks,todo:Todos,powershell:PowerShell,twofa:TwoFA};
let active = null;

function openModule(id){
  if(!modules[id]) return;
  document.querySelectorAll('.module-view').forEach(x=>x.classList.toggle('active',x.id===`module-${id}`));
  document.querySelectorAll('#mainNav .nav-link').forEach(x=>x.classList.toggle('active',x.dataset.module===id));
  active=id;
  Storage.update('settings',s=>{s.lastModule=id;return s;});
  modules[id].render();
}

function initNav(){
  document.querySelectorAll('#mainNav .nav-link').forEach(btn=>btn.addEventListener('click',()=>openModule(btn.dataset.module)));
}

function initBackup(){
  document.getElementById('exportDataBtn').onclick=()=>{
    downloadText(`workspace-pro-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(Storage.exportAll(),null,2), 'application/json');
    toast('Đã tạo file backup.','success');
  };
  document.getElementById('importDataInput').onchange=async e=>{
    const file=e.target.files?.[0]; if(!file) return;
    try{
      const data=JSON.parse(await file.text());
      Storage.importAll(data);
      toast('Đã nhập backup. Trang sẽ tải lại.','success');
      setTimeout(()=>location.reload(),500);
    }catch(err){toast(err.message||'Không đọc được backup.','danger');}
  };
  document.getElementById('clearAllDataBtn').onclick=async()=>{
    if(await confirmAction('Xóa toàn bộ Bookmark, Todo và PowerShell đang lưu trong trình duyệt?','Xóa tất cả')){
      Storage.clearAll();
    }
  };
}

function initReminders(){
  const wrap=document.getElementById('globalReminderWrap');
  const title=document.getElementById('globalReminderTitle');
  const meta=document.getElementById('globalReminderMeta');
  const done=document.getElementById('globalReminderDone');
  const open=document.getElementById('globalReminderOpen');

  const refresh=()=>{
    const due=Todos.getDueReminders();
    if(!due.length){wrap.classList.add('d-none');return;}
    wrap.classList.remove('d-none');
    const first=due[0];
    title.textContent=first.task.title;
    meta.textContent=[first.label, due.length>1?`+${due.length-1} việc khác`:null].filter(Boolean).join(' · ');
    done.onclick=()=>{Todos.completeOccurrence(first.task.id, first.occurrenceKey);refresh();if(active==='todo')Todos.render();};
    open.onclick=()=>openModule('todo');
  };
  refresh();
  setInterval(refresh,30000);
  window.addEventListener('workspace:todo-changed',refresh);
}

Object.values(modules).forEach(m=>m.init?.());
initNav();
initBackup();
initReminders();

const settings=Storage.get('settings');
openModule(modules[settings.lastModule] ? settings.lastModule : 'bookmark');
