import {Storage} from '../storage.js';
import {uid, esc, toast, confirmAction, copyText, downloadText} from '../utils.js';

const host=()=>document.getElementById('module-powershell');
let selectedId=null, search='';

function data(){return Storage.get('powershell');}
function save(d){Storage.set('powershell',d);}

function detectVars(doc){
  const names=new Set();
  doc.blocks.filter(b=>b.type==='code').forEach(b=>{
    for(const m of b.content.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g))names.add(m[1]);
  });
  const existing=new Map((doc.variables||[]).map(v=>[v.name,v]));
  doc.variables=[...names].map(name=>existing.get(name)||{name,label:name,type:'text',defaultValue:''});
  return doc;
}
function valuesFor(d,doc){
  const saved=d.runtimeValues[doc.id]||{};
  return Object.fromEntries((doc.variables||[]).map(v=>[v.name, saved[v.name] ?? v.defaultValue ?? '']));
}
function renderTemplate(text,values){return String(text||'').replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g,(_,n)=>values[n]??'');}

function openEditor(doc=null){
  const isEdit=!!doc,id='psEditorModal';document.getElementById(id)?.remove();
  const draft=structuredClone(doc||{id:uid('ps'),title:'',description:'',tags:[],blocks:[{id:uid('blk'),type:'text',content:''},{id:uid('blk'),type:'code',content:''}],variables:[],createdAt:new Date().toISOString()});
  document.body.insertAdjacentHTML('beforeend',`
  <div class="modal fade" id="${id}" tabindex="-1">
    <div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">${isEdit?'Sửa tài liệu PowerShell':'Tạo tài liệu PowerShell'}</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="row g-3 mb-3">
          <div class="col-md-7"><label class="form-label">Tiêu đề</label><input id="psTitleEdit" class="form-control" value="${esc(draft.title)}"></div>
          <div class="col-md-5"><label class="form-label">Tags (phân cách dấu phẩy)</label><input id="psTagsEdit" class="form-control" value="${esc((draft.tags||[]).join(', '))}"></div>
          <div class="col-12"><label class="form-label">Mô tả</label><textarea id="psDescEdit" class="form-control" rows="2">${esc(draft.description||'')}</textarea></div>
        </div>
        <div class="d-flex justify-content-between align-items-center mb-2"><strong>Blocks</strong><div class="btn-group btn-group-sm"><button id="psAddText" class="btn btn-outline-secondary"><i class="bi bi-text-paragraph me-1"></i>Text</button><button id="psAddCode" class="btn btn-outline-primary"><i class="bi bi-code-slash me-1"></i>Code</button></div></div>
        <div id="psBlockEditor" class="d-grid gap-2"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Hủy</button><button id="psDocSave" class="btn btn-primary">Lưu</button></div>
    </div></div>
  </div>`);
  const el=document.getElementById(id),modal=bootstrap.Modal.getOrCreateInstance(el),box=document.getElementById('psBlockEditor');
  const draw=()=>{
    box.innerHTML=draft.blocks.map((b,i)=>`<div class="card p-2">
      <div class="d-flex align-items-center mb-2"><span class="badge ${b.type==='code'?'text-bg-primary':'text-bg-secondary'}">${b.type==='code'?'CODE':'TEXT'}</span><div class="ms-auto btn-group btn-group-sm"><button class="btn btn-outline-secondary" data-up="${i}" ${i===0?'disabled':''}><i class="bi bi-arrow-up"></i></button><button class="btn btn-outline-secondary" data-down="${i}" ${i===draft.blocks.length-1?'disabled':''}><i class="bi bi-arrow-down"></i></button><button class="btn btn-outline-danger" data-del="${i}"><i class="bi bi-trash"></i></button></div></div>
      <textarea class="form-control ${b.type==='code'?'code-editor':''}" rows="${b.type==='code'?8:4}" data-block="${i}">${esc(b.content)}</textarea>
    </div>`).join('');
    box.querySelectorAll('[data-block]').forEach(x=>x.oninput=()=>draft.blocks[Number(x.dataset.block)].content=x.value);
    box.querySelectorAll('[data-del]').forEach(x=>x.onclick=()=>{draft.blocks.splice(Number(x.dataset.del),1);draw();});
    box.querySelectorAll('[data-up]').forEach(x=>x.onclick=()=>{const i=Number(x.dataset.up);[draft.blocks[i-1],draft.blocks[i]]=[draft.blocks[i],draft.blocks[i-1]];draw();});
    box.querySelectorAll('[data-down]').forEach(x=>x.onclick=()=>{const i=Number(x.dataset.down);[draft.blocks[i+1],draft.blocks[i]]=[draft.blocks[i],draft.blocks[i+1]];draw();});
  };
  document.getElementById('psAddText').onclick=()=>{draft.blocks.push({id:uid('blk'),type:'text',content:''});draw();};
  document.getElementById('psAddCode').onclick=()=>{draft.blocks.push({id:uid('blk'),type:'code',content:''});draw();};
  document.getElementById('psDocSave').onclick=()=>{
    draft.title=document.getElementById('psTitleEdit').value.trim(); if(!draft.title)return toast('Nhập tiêu đề.','warning');
    draft.description=document.getElementById('psDescEdit').value;
    draft.tags=document.getElementById('psTagsEdit').value.split(',').map(x=>x.trim()).filter(Boolean);
    draft.updatedAt=new Date().toISOString();detectVars(draft);
    const d=data();
    if(isEdit){const idx=d.documents.findIndex(x=>x.id===doc.id);d.documents[idx]=draft;}else d.documents.unshift(draft);
    save(d);selectedId=draft.id;modal.hide();render();
  };
  el.addEventListener('hidden.bs.modal',()=>el.remove(),{once:true});draw();modal.show();
}

function openVariables(doc){
  detectVars(doc);
  const id='psVarsModal';document.getElementById(id)?.remove();
  document.body.insertAdjacentHTML('beforeend',`
  <div class="modal fade" id="${id}" tabindex="-1"><div class="modal-dialog modal-lg modal-dialog-centered"><div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">Cấu hình biến</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body"><div class="d-grid gap-3">${doc.variables.map((v,i)=>`<div class="card p-3"><div class="row g-2"><div class="col-md-4"><label class="form-label">Tên</label><input class="form-control" value="${esc(v.name)}" disabled></div><div class="col-md-4"><label class="form-label">Label</label><input class="form-control" data-var-label="${i}" value="${esc(v.label||v.name)}"></div><div class="col-md-4"><label class="form-label">Kiểu input</label><select class="form-select" data-var-type="${i}"><option value="text" ${v.type!=='textarea'?'selected':''}>Một dòng</option><option value="textarea" ${v.type==='textarea'?'selected':''}>Nhiều dòng</option></select></div><div class="col-12"><label class="form-label">Giá trị mặc định</label><textarea class="form-control code-font" rows="2" data-var-default="${i}">${esc(v.defaultValue||'')}</textarea></div></div></div>`).join('')||'<div class="text-secondary">Chưa có biến dạng {{TEN_BIEN}} trong code.</div>'}</div></div>
    <div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Hủy</button><button id="psVarSave" class="btn btn-primary">Lưu</button></div>
  </div></div></div>`);
  const el=document.getElementById(id),modal=bootstrap.Modal.getOrCreateInstance(el);
  document.getElementById('psVarSave').onclick=()=>{
    doc.variables.forEach((v,i)=>{v.label=el.querySelector(`[data-var-label="${i}"]`)?.value||v.name;v.type=el.querySelector(`[data-var-type="${i}"]`)?.value||'text';v.defaultValue=el.querySelector(`[data-var-default="${i}"]`)?.value||'';});
    const d=data(),idx=d.documents.findIndex(x=>x.id===doc.id);d.documents[idx]=doc;save(d);modal.hide();render();
  };
  el.addEventListener('hidden.bs.modal',()=>el.remove(),{once:true});modal.show();
}

function docMatches(doc,q){
  if(!q)return true;const hay=[doc.title,doc.description,(doc.tags||[]).join(' '),...(doc.blocks||[]).map(b=>b.content)].join(' ').toLowerCase();return hay.includes(q.toLowerCase());
}

export function render(){
  const d=data(), docs=d.documents.filter(x=>docMatches(x,search));
  if(!selectedId || !d.documents.some(x=>x.id===selectedId))selectedId=d.documents[0]?.id||null;
  const doc=d.documents.find(x=>x.id===selectedId)||null;
  host().innerHTML=`
  <div class="ps-layout">
    <aside class="ps-sidebar">
      <div class="d-flex justify-content-between align-items-center mb-2"><strong>PowerShell</strong><button id="psNew" class="btn btn-sm btn-primary"><i class="bi bi-plus-lg"></i></button></div>
      <div class="input-group input-group-sm mb-3"><span class="input-group-text"><i class="bi bi-search"></i></span><input id="psSearch" class="form-control" value="${esc(search)}" placeholder="Tìm code..."></div>
      <div class="d-grid gap-1">${docs.map(x=>`<div class="ps-doc-item ${x.id===selectedId?'active':''}" data-ps-doc="${x.id}"><div class="fw-semibold text-truncate">${esc(x.title)}</div><div class="small text-secondary text-truncate">${esc((x.tags||[]).join(' · '))}</div></div>`).join('')||'<div class="small text-secondary p-2">Chưa có tài liệu.</div>'}</div>
    </aside>
    <div class="ps-main">${doc?renderDoc(d,doc):`<div class="empty-state"><i class="bi bi-terminal fs-1 d-block mb-2"></i>Tạo tài liệu PowerShell đầu tiên.</div>`}</div>
  </div>`;
  document.getElementById('psNew').onclick=()=>openEditor();
  document.getElementById('psSearch').oninput=e=>{search=e.target.value;render();document.getElementById('psSearch')?.focus();};
  host().querySelectorAll('[data-ps-doc]').forEach(x=>x.onclick=()=>{selectedId=x.dataset.psDoc;render();});
  if(doc)bindDocActions(d,doc);
}

function renderDoc(d,doc){
  detectVars(doc); const vals=valuesFor(d,doc);
  return `<div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
    <div><h4 class="mb-1">${esc(doc.title)}</h4><div class="text-secondary small">${esc(doc.description||'')}</div><div class="mt-2">${(doc.tags||[]).map(t=>`<span class="badge text-bg-secondary me-1">${esc(t)}</span>`).join('')}</div></div>
    <div class="btn-group btn-group-sm">
      <button class="btn btn-outline-secondary" id="psCopyAll"><i class="bi bi-copy me-1"></i>Copy all code</button>
      <button class="btn btn-outline-secondary" id="psDownload"><i class="bi bi-download me-1"></i>.ps1</button>
      <button class="btn btn-outline-secondary" id="psVars"><i class="bi bi-braces me-1"></i>Biến</button>
      <button class="btn btn-outline-primary" id="psEdit"><i class="bi bi-pencil"></i></button>
      <button class="btn btn-outline-danger" id="psDelete"><i class="bi bi-trash"></i></button>
    </div>
  </div>
  <div class="d-grid gap-3 mb-4">
    ${(doc.blocks||[]).map((b,i)=>b.type==='text'
      ? `<div class="ps-text-block">${esc(b.content).replace(/\n/g,'<br>')}</div>`
      : `<div class="ps-code-block"><div class="ps-code-head d-flex justify-content-between align-items-center"><span class="small text-secondary">PowerShell</span><button class="btn btn-sm btn-outline-light py-0" data-copy-block="${i}"><i class="bi bi-copy me-1"></i>Copy</button></div><pre class="ps-code-body"><code>${esc(renderTemplate(b.content,vals))}</code></pre></div>`
    ).join('')}
  </div>
  ${doc.variables?.length?`<div class="card p-3"><div class="section-title mb-3">Variables</div><div class="ps-var-grid">${doc.variables.map(v=>`<div><label class="form-label">${esc(v.label||v.name)} <code>{{${esc(v.name)}}}</code></label>${v.type==='textarea'?`<textarea class="form-control code-font" rows="4" data-runtime-var="${esc(v.name)}">${esc(vals[v.name]||'')}</textarea>`:`<input class="form-control code-font" data-runtime-var="${esc(v.name)}" value="${esc(vals[v.name]||'')}">`}</div>`).join('')}</div></div>`:''}`;
}

function bindDocActions(d,doc){
  const persistRuntime=()=>{
    const z=data();z.runtimeValues[doc.id]=z.runtimeValues[doc.id]||{};
    host().querySelectorAll('[data-runtime-var]').forEach(x=>z.runtimeValues[doc.id][x.dataset.runtimeVar]=x.value);
    save(z);
  };
  host().querySelectorAll('[data-runtime-var]').forEach(x=>x.oninput=()=>{persistRuntime();render();const target=host().querySelector(`[data-runtime-var="${CSS.escape(x.dataset.runtimeVar)}"]`);target?.focus();});
  const renderedBlocks=()=>{
    const z=data(),vals=valuesFor(z,doc);return doc.blocks.filter(b=>b.type==='code').map(b=>renderTemplate(b.content,vals));
  };
  host().querySelectorAll('[data-copy-block]').forEach(btn=>btn.onclick=async()=>{const i=Number(btn.dataset.copyBlock),vals=valuesFor(data(),doc);await copyText(renderTemplate(doc.blocks[i].content,vals));toast('Đã copy code.','success');});
  document.getElementById('psCopyAll').onclick=async()=>{await copyText(renderedBlocks().join('\n\n'));toast('Đã copy toàn bộ code.','success');};
  document.getElementById('psDownload').onclick=()=>downloadText(`${doc.title.replace(/[^\w\-]+/g,'_')||'script'}.ps1`,renderedBlocks().join('\n\n'));
  document.getElementById('psVars').onclick=()=>openVariables(structuredClone(doc));
  document.getElementById('psEdit').onclick=()=>openEditor(doc);
  document.getElementById('psDelete').onclick=async()=>{if(!await confirmAction(`Xóa "${doc.title}"?`))return;const z=data();z.documents=z.documents.filter(x=>x.id!==doc.id);delete z.runtimeValues[doc.id];save(z);selectedId=z.documents[0]?.id||null;render();};
}

export const PowerShell={init(){},render};
