import {Storage} from '../storage.js';
import {uid, esc, toast, confirmAction, copyText, downloadText} from '../utils.js';

const host=()=>document.getElementById('module-powershell');
let selectedId=null, search='';

function data(){return Storage.get('powershell');}
function save(d){Storage.set('powershell',d);}

function detectVars(doc){
  const names=new Set();
  (doc.blocks||[]).filter(b=>b.type==='code').forEach(b=>{
    for(const m of String(b.content||'').matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g))names.add(m[1]);
  });
  const existing=new Map((doc.variables||[]).map(v=>[v.name,v]));
  doc.variables=[...names].map(name=>existing.get(name)||{name,label:name,type:'text',defaultValue:''});
  return doc;
}
function valuesFor(d,doc){
  const saved=d.runtimeValues[doc.id]||{};
  return Object.fromEntries((doc.variables||[]).map(v=>[v.name,saved[v.name]??v.defaultValue??'']));
}
function renderTemplate(text,values){return String(text||'').replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g,(_,n)=>values[n]??'');}
function docMatches(doc,q){
  if(!q)return true;
  const hay=[doc.title,doc.description,(doc.tags||[]).join(' '),...(doc.blocks||[]).map(b=>b.content)].join(' ').toLowerCase();
  return hay.includes(q.toLowerCase());
}

function openEditor(doc=null){
  const isEdit=!!doc,id='psEditorModal';document.getElementById(id)?.remove();
  const draft=structuredClone(doc||{id:uid('ps'),title:'',description:'',tags:[],blocks:[{id:uid('blk'),type:'text',content:''},{id:uid('blk'),type:'code',content:''}],variables:[],createdAt:new Date().toISOString()});
  document.body.insertAdjacentHTML('beforeend',`
  <div class="modal fade" id="${id}" tabindex="-1">
    <div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content">
      <div class="modal-header"><div><div class="modal-title"><i class="bi bi-terminal me-2"></i>${isEdit?'Sửa tài liệu PowerShell':'Tạo tài liệu PowerShell'}</div><div class="small text-secondary mt-1">Text dùng làm hướng dẫn; nút Copy chỉ sao chép các block Code.</div></div><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="row g-3 mb-3">
          <div class="col-md-7"><label class="form-label">Tiêu đề</label><input id="psTitleEdit" class="form-control" value="${esc(draft.title)}" placeholder="Ví dụ: Backup Chrome Profile"></div>
          <div class="col-md-5"><label class="form-label">Tags</label><input id="psTagsEdit" class="form-control" value="${esc((draft.tags||[]).join(', '))}" placeholder="backup, chrome, windows"></div>
          <div class="col-12"><label class="form-label">Mô tả ngắn</label><textarea id="psDescEdit" class="form-control" rows="2">${esc(draft.description||'')}</textarea></div>
        </div>
        <div class="d-flex justify-content-between align-items-center mb-2"><span class="section-title">Nội dung</span><div class="btn-group btn-group-sm"><button id="psAddText" class="btn btn-outline-secondary"><i class="bi bi-text-paragraph me-1"></i>Text</button><button id="psAddCode" class="btn btn-outline-primary"><i class="bi bi-code-slash me-1"></i>Code</button></div></div>
        <div id="psBlockEditor" class="d-grid gap-2"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Hủy</button><button id="psDocSave" class="btn btn-primary"><i class="bi bi-check2 me-1"></i>Lưu</button></div>
    </div></div>
  </div>`);
  const el=document.getElementById(id),modal=bootstrap.Modal.getOrCreateInstance(el),box=document.getElementById('psBlockEditor');
  const draw=()=>{
    box.innerHTML=draft.blocks.map((b,i)=>`<div class="card p-2 shadow-none">
      <div class="d-flex align-items-center mb-2"><span class="badge ${b.type==='code'?'text-bg-primary':'text-bg-secondary'}"><i class="bi ${b.type==='code'?'bi-code-slash':'bi-text-paragraph'} me-1"></i>${b.type==='code'?'CODE':'TEXT'}</span><div class="ms-auto btn-group btn-group-sm"><button class="btn btn-outline-secondary" data-up="${i}" ${i===0?'disabled':''}><i class="bi bi-arrow-up"></i></button><button class="btn btn-outline-secondary" data-down="${i}" ${i===draft.blocks.length-1?'disabled':''}><i class="bi bi-arrow-down"></i></button><button class="btn btn-outline-danger" data-del="${i}"><i class="bi bi-trash3"></i></button></div></div>
      <textarea class="form-control ${b.type==='code'?'code-editor':''}" rows="${b.type==='code'?8:4}" data-block="${i}" placeholder="${b.type==='code'?'PowerShell code. Có thể dùng {{TEN_BIEN}}...':'Nội dung hướng dẫn...'}">${esc(b.content)}</textarea>
    </div>`).join('');
    box.querySelectorAll('[data-block]').forEach(x=>x.oninput=()=>draft.blocks[Number(x.dataset.block)].content=x.value);
    box.querySelectorAll('[data-del]').forEach(x=>x.onclick=()=>{draft.blocks.splice(Number(x.dataset.del),1);draw();});
    box.querySelectorAll('[data-up]').forEach(x=>x.onclick=()=>{const i=Number(x.dataset.up);[draft.blocks[i-1],draft.blocks[i]]=[draft.blocks[i],draft.blocks[i-1]];draw();});
    box.querySelectorAll('[data-down]').forEach(x=>x.onclick=()=>{const i=Number(x.dataset.down);[draft.blocks[i+1],draft.blocks[i]]=[draft.blocks[i],draft.blocks[i+1]];draw();});
  };
  document.getElementById('psAddText').onclick=()=>{draft.blocks.push({id:uid('blk'),type:'text',content:''});draw();};
  document.getElementById('psAddCode').onclick=()=>{draft.blocks.push({id:uid('blk'),type:'code',content:''});draw();};
  document.getElementById('psDocSave').onclick=()=>{
    draft.title=document.getElementById('psTitleEdit').value.trim();if(!draft.title)return toast('Nhập tiêu đề.','warning');
    draft.description=document.getElementById('psDescEdit').value;
    draft.tags=document.getElementById('psTagsEdit').value.split(',').map(x=>x.trim()).filter(Boolean);
    draft.updatedAt=new Date().toISOString();detectVars(draft);
    const d=data();
    if(isEdit){const idx=d.documents.findIndex(x=>x.id===doc.id);d.documents[idx]=draft;}else d.documents.unshift(draft);
    save(d);selectedId=draft.id;modal.hide();render();
  };
  el.addEventListener('hidden.bs.modal',()=>el.remove(),{once:true});draw();modal.show();
}

function runtimeValuesFromDom(d,doc){
  const values=valuesFor(d,doc);
  host().querySelectorAll('[data-runtime-var]').forEach(el=>values[el.dataset.runtimeVar]=el.value);
  return values;
}
function persistRuntime(doc){
  const d=data();d.runtimeValues[doc.id]=d.runtimeValues[doc.id]||{};
  host().querySelectorAll('[data-runtime-var]').forEach(el=>d.runtimeValues[doc.id][el.dataset.runtimeVar]=el.value);
  save(d);
}
function persistVariableType(doc,name,type){
  const d=data(),target=d.documents.find(x=>x.id===doc.id);if(!target)return;
  detectVars(target);const v=target.variables.find(x=>x.name===name);if(v)v.type=type;
  save(d);doc.variables=target.variables;
}
function refreshCodePreviews(doc){
  const d=data(),values=runtimeValuesFromDom(d,doc);
  host().querySelectorAll('[data-code-preview]').forEach(el=>{
    const idx=Number(el.dataset.codePreview),block=doc.blocks[idx];if(block)el.textContent=renderTemplate(block.content,values);
  });
}

function renderDoc(d,doc){
  detectVars(doc);const vals=valuesFor(d,doc);
  return `<div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-4">
    <div class="min-w-0"><div class="d-flex align-items-center gap-2 mb-1"><i class="bi bi-terminal-fill text-primary"></i><h4 class="mb-0 fw-bold text-truncate">${esc(doc.title)}</h4></div><div class="text-secondary small">${esc(doc.description||'')}</div><div class="mt-2">${(doc.tags||[]).map(t=>`<span class="badge rounded-pill text-bg-secondary me-1"><i class="bi bi-hash"></i>${esc(t)}</span>`).join('')}</div></div>
    <div class="btn-group btn-group-sm">
      <button class="btn btn-outline-secondary" id="psCopyAll" title="Copy tất cả code"><i class="bi bi-copy me-1"></i>Copy all</button>
      <button class="btn btn-outline-secondary" id="psDownload" title="Tải file .ps1"><i class="bi bi-download me-1"></i>.ps1</button>
      <button class="btn btn-outline-primary" id="psEdit" title="Sửa tài liệu"><i class="bi bi-pencil-square"></i></button>
      <button class="btn btn-outline-danger" id="psDelete" title="Xóa"><i class="bi bi-trash3"></i></button>
    </div>
  </div>

  <div class="d-grid gap-3">
    ${(doc.blocks||[]).map((b,i)=>b.type==='text'
      ? `<div class="ps-text-block">${esc(b.content).replace(/\n/g,'<br>')}</div>`
      : `<div class="ps-code-block"><div class="ps-code-head d-flex justify-content-between align-items-center"><span class="small text-secondary"><i class="bi bi-terminal me-1"></i>PowerShell</span><button class="btn btn-sm btn-outline-light py-0 px-2" data-copy-block="${i}"><i class="bi bi-copy me-1"></i>Copy</button></div><pre class="ps-code-body"><code data-code-preview="${i}">${esc(renderTemplate(b.content,vals))}</code></pre></div>`
    ).join('')}
  </div>

  ${doc.variables?.length?`<div class="ps-vars-panel"><div class="d-flex align-items-center gap-2 mb-2"><i class="bi bi-braces text-primary"></i><span class="section-title mb-0">Variables</span><span class="small text-secondary">Giá trị chỉ thay khi preview/copy, template gốc không đổi.</span></div><div class="ps-vars-list">
    ${doc.variables.map(v=>`<div class="ps-var-row" data-var-row="${esc(v.name)}">
      <div class="ps-var-name"><span class="text-truncate" title="${esc(v.label||v.name)}">${esc(v.label||v.name)}</span><span class="ps-var-chip" title="{{${esc(v.name)}}}">{{${esc(v.name)}}}</span></div>
      <select class="form-select form-select-sm" data-var-type="${esc(v.name)}" aria-label="Kiểu input cho ${esc(v.name)}"><option value="text" ${v.type!=='textarea'?'selected':''}>1 dòng</option><option value="textarea" ${v.type==='textarea'?'selected':''}>Nhiều dòng</option></select>
      <div class="ps-var-input">${v.type==='textarea'?`<textarea class="form-control form-control-sm code-font" rows="3" data-runtime-var="${esc(v.name)}" placeholder="Nhập nhiều dòng...">${esc(vals[v.name]||'')}</textarea>`:`<input class="form-control form-control-sm code-font" data-runtime-var="${esc(v.name)}" value="${esc(vals[v.name]||'')}" placeholder="Nhập giá trị...">`}</div>
    </div>`).join('')}
  </div></div>`:''}`;
}

function bindDocActions(doc){
  host().querySelectorAll('[data-runtime-var]').forEach(el=>{
    el.addEventListener('input',()=>{persistRuntime(doc);refreshCodePreviews(doc);});
  });
  host().querySelectorAll('[data-var-type]').forEach(sel=>{
    sel.addEventListener('change',()=>{
      persistRuntime(doc);persistVariableType(doc,sel.dataset.varType,sel.value);render();
      setTimeout(()=>host().querySelector(`[data-runtime-var="${CSS.escape(sel.dataset.varType)}"]`)?.focus(),0);
    });
  });
  const renderedBlocks=()=>{
    const d=data(),values=runtimeValuesFromDom(d,doc);
    return doc.blocks.filter(b=>b.type==='code').map(b=>renderTemplate(b.content,values));
  };
  host().querySelectorAll('[data-copy-block]').forEach(btn=>btn.onclick=async()=>{
    const idx=Number(btn.dataset.copyBlock),values=runtimeValuesFromDom(data(),doc);
    await copyText(renderTemplate(doc.blocks[idx].content,values));toast('Đã copy code.','success');
  });
  document.getElementById('psCopyAll').onclick=async()=>{await copyText(renderedBlocks().join('\n\n'));toast('Đã copy toàn bộ code.','success');};
  document.getElementById('psDownload').onclick=()=>downloadText(`${doc.title.replace(/[^\w\-]+/g,'_')||'script'}.ps1`,renderedBlocks().join('\n\n'));
  document.getElementById('psEdit').onclick=()=>openEditor(doc);
  document.getElementById('psDelete').onclick=async()=>{
    if(!await confirmAction(`Xóa "${doc.title}"?`))return;
    const d=data();d.documents=d.documents.filter(x=>x.id!==doc.id);delete d.runtimeValues[doc.id];save(d);selectedId=d.documents[0]?.id||null;render();
  };
}

export function render(){
  const d=data(),docs=d.documents.filter(x=>docMatches(x,search));
  if(!selectedId||!d.documents.some(x=>x.id===selectedId))selectedId=d.documents[0]?.id||null;
  const doc=d.documents.find(x=>x.id===selectedId)||null;
  host().innerHTML=`
  <div class="ps-layout">
    <aside class="ps-sidebar">
      <div class="d-flex justify-content-between align-items-center mb-3"><div><div class="fw-bold"><i class="bi bi-terminal-fill me-2 text-primary"></i>PowerShell</div><div class="small text-secondary mt-1">Code library</div></div><button id="psNew" class="btn btn-sm btn-primary" title="Tạo mới"><i class="bi bi-plus-lg"></i></button></div>
      <div class="input-group input-group-sm mb-3"><span class="input-group-text"><i class="bi bi-search"></i></span><input id="psSearch" class="form-control" value="${esc(search)}" placeholder="Tìm title, tag, code..."></div>
      <div class="d-grid gap-1">${docs.map(x=>`<div class="ps-doc-item ${x.id===selectedId?'active':''}" data-ps-doc="${x.id}"><div class="d-flex align-items-center gap-2"><i class="bi bi-file-earmark-code text-secondary"></i><div class="min-w-0"><div class="fw-semibold text-truncate">${esc(x.title)}</div><div class="small text-secondary text-truncate">${esc((x.tags||[]).join(' · '))}</div></div></div></div>`).join('')||'<div class="small text-secondary p-2"><i class="bi bi-inbox me-1"></i>Chưa có tài liệu.</div>'}</div>
    </aside>
    <div class="ps-main">${doc?renderDoc(d,doc):`<div class="empty-state"><i class="bi bi-terminal fs-1 d-block mb-2"></i><div class="fw-semibold text-light mb-1">PowerShell Library</div><div class="small">Tạo tài liệu đầu tiên để lưu hướng dẫn và code.</div></div>`}</div>
  </div>`;
  document.getElementById('psNew').onclick=()=>openEditor();
  const searchBox=document.getElementById('psSearch');searchBox.oninput=e=>{search=e.target.value;render();const s=document.getElementById('psSearch');s?.focus();s?.setSelectionRange(search.length,search.length);};
  host().querySelectorAll('[data-ps-doc]').forEach(x=>x.onclick=()=>{selectedId=x.dataset.psDoc;render();});
  if(doc)bindDocActions(doc);
}

export const PowerShell={init(){},render};
