export const uid = (prefix='id') => `${prefix}_${crypto.randomUUID?.() || (Date.now().toString(36)+Math.random().toString(36).slice(2))}`;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
export const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
export const ymd = d => {
  const x = new Date(d);
  const y=x.getFullYear(), m=String(x.getMonth()+1).padStart(2,'0'), day=String(x.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};
export const parseLocalDateTime = (date, time='00:00') => new Date(`${date}T${time || '00:00'}:00`);
export const downloadText = (filename, text, mime='text/plain') => {
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:mime}));
  a.download=filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),500);
};
export async function copyText(text){
  try{ await navigator.clipboard.writeText(text); }
  catch{
    const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
  }
}
export function toast(message, type='secondary'){
  const host=document.getElementById('toastContainer');
  const el=document.createElement('div');
  el.className=`toast align-items-center text-bg-${type} border-0`;
  el.innerHTML=`<div class="d-flex"><div class="toast-body">${esc(message)}</div><button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  host.appendChild(el);
  const t=bootstrap.Toast.getOrCreateInstance(el,{delay:2500}); t.show();
  el.addEventListener('hidden.bs.toast',()=>el.remove());
}
export function confirmAction(message, okLabel='Xóa'){
  return new Promise(resolve=>{
    const modalEl=document.getElementById('confirmModal');
    const btn=document.getElementById('confirmOk');
    document.getElementById('confirmMessage').textContent=message;
    btn.textContent=okLabel;
    const modal=bootstrap.Modal.getOrCreateInstance(modalEl);
    const cleanup=(v)=>{btn.onclick=null; modalEl.removeEventListener('hidden.bs.modal', onHide); resolve(v);};
    const onHide=()=>cleanup(false);
    modalEl.addEventListener('hidden.bs.modal',onHide,{once:true});
    btn.onclick=()=>{modalEl.removeEventListener('hidden.bs.modal',onHide);modal.hide();cleanup(true);};
    modal.show();
  });
}
export const normalizeUrl = value => {
  const s=String(value||'').trim();
  if(!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
};
