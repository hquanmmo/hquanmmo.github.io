import {Storage} from '../storage.js';
import {uid, esc, toast, confirmAction, normalizeUrl} from '../utils.js';

const host=()=>document.getElementById('module-bookmark');
let query='';

function getData(){return Storage.get('bookmarks');}
function save(data){Storage.set('bookmarks',data);}

function iconSrc(data,id){
  const x=data.icons.find(i=>i.id===id);
  return x?.src || '';
}

function sortByOrder(a,b){return (a.order??0)-(b.order??0);}

function renderIconPicker(data,selected=''){
  return `<option value="">Không icon</option>`+data.icons.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(i=>`<option value="${esc(i.id)}" ${i.id===selected?'selected':''}>${esc(i.name)}</option>`).join('');
}

function openFolderModal(folder=null){
  const isEdit=!!folder;
  const modalId='bookmarkFolderModal';
  document.getElementById(modalId)?.remove();
  document.body.insertAdjacentHTML('beforeend',`
  <div class="modal fade" id="${modalId}" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">${isEdit?'Sửa folder':'Thêm folder'}</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <label class="form-label">Tên folder</label>
        <input id="bmFolderName" class="form-control" value="${esc(folder?.name||'')}" autofocus>
      </div>
      <div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Hủy</button><button id="bmFolderSave" class="btn btn-primary">Lưu</button></div>
    </div></div>
  </div>`);
  const el=document.getElementById(modalId), modal=bootstrap.Modal.getOrCreateInstance(el);
  el.addEventListener('shown.bs.modal',()=>document.getElementById('bmFolderName').focus());
  document.getElementById('bmFolderSave').onclick=()=>{
    const name=document.getElementById('bmFolderName').value.trim();
    if(!name) return toast('Hãy nhập tên folder.','warning');
    const data=getData();
    if(isEdit){
      const f=data.folders.find(x=>x.id===folder.id); if(f) f.name=name;
    }else{
      data.folders.push({id:uid('fld'),name,order:(Math.max(-10,...data.folders.map(x=>x.order??0))+10)});
    }
    save(data); modal.hide(); render();
  };
  el.addEventListener('hidden.bs.modal',()=>el.remove(),{once:true});
  modal.show();
}

function openBookmarkModal(item=null, presetFolder=''){
  const data=getData(), isEdit=!!item, modalId='bookmarkItemModal';
  document.getElementById(modalId)?.remove();
  const folders=data.folders.slice().sort(sortByOrder);
  if(!folders.length) return toast('Hãy tạo folder trước.','warning');
  document.body.insertAdjacentHTML('beforeend',`
  <div class="modal fade" id="${modalId}" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">${isEdit?'Sửa bookmark':'Thêm bookmark'}</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="mb-3"><label class="form-label">Tên</label><input id="bmTitle" class="form-control" value="${esc(item?.title||'')}"></div>
        <div class="mb-3"><label class="form-label">URL</label><input id="bmUrl" class="form-control" value="${esc(item?.url||'')}" placeholder="https://..."></div>
        <div class="mb-3"><label class="form-label">Folder</label><select id="bmFolder" class="form-select">${folders.map(f=>`<option value="${f.id}" ${(item?.folderId||presetFolder||folders[0].id)===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select></div>
        <div><label class="form-label">Icon</label><select id="bmIcon" class="form-select">${renderIconPicker(data,item?.iconId||'')}</select></div>
      </div>
      <div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Hủy</button><button id="bmSave" class="btn btn-primary">Lưu</button></div>
    </div></div>
  </div>`);
  const el=document.getElementById(modalId), modal=bootstrap.Modal.getOrCreateInstance(el);
  document.getElementById('bmSave').onclick=()=>{
    const title=document.getElementById('bmTitle').value.trim(), url=normalizeUrl(document.getElementById('bmUrl').value), folderId=document.getElementById('bmFolder').value, iconId=document.getElementById('bmIcon').value;
    if(!title||!url) return toast('Tên và URL là bắt buộc.','warning');
    const d=getData();
    if(isEdit){
      const x=d.items.find(x=>x.id===item.id);
      if(x){x.title=title;x.url=url;x.folderId=folderId;x.iconId=iconId;x.updatedAt=new Date().toISOString();}
    }else{
      const siblings=d.items.filter(x=>x.folderId===folderId);
      d.items.push({id:uid('bm'),title,url,folderId,iconId,order:Math.max(-10,...siblings.map(x=>x.order??0))+10,createdAt:new Date().toISOString()});
    }
    normalizeOrders(d); save(d); modal.hide(); render();
  };
  el.addEventListener('hidden.bs.modal',()=>el.remove(),{once:true});
  modal.show();
}

function openIconModal(){
  const modalId='bookmarkIconModal'; document.getElementById(modalId)?.remove();
  document.body.insertAdjacentHTML('beforeend',`
  <div class="modal fade" id="${modalId}" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">Icon Library</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="row g-2">
          <div class="col-12"><label class="form-label">Tên icon</label><input id="iconName" class="form-control" placeholder="Google Sheet"></div>
          <div class="col-12"><label class="form-label">URL icon</label><input id="iconUrl" class="form-control" placeholder="https://...png"></div>
          <div class="col-12">
            <label class="form-label">Hoặc tải file nhỏ</label>
            <input id="iconFile" class="form-control" type="file" accept="image/*">
            <div class="form-text">File sẽ được lưu dạng Data URL trong localStorage. Nên dùng icon nhỏ để tránh đầy bộ nhớ.</div>
          </div>
        </div>
        <hr>
        <div id="iconLibraryList" class="d-flex flex-wrap gap-2"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Đóng</button><button id="iconSave" class="btn btn-primary">Thêm icon</button></div>
    </div></div>
  </div>`);
  const el=document.getElementById(modalId), modal=bootstrap.Modal.getOrCreateInstance(el);
  const renderList=()=>{
    const data=getData(), list=document.getElementById('iconLibraryList');
    list.innerHTML=data.icons.map(i=>`<div class="border rounded p-2 text-center" style="width:86px"><img src="${esc(i.src)}" alt="" style="width:28px;height:28px;object-fit:contain"><div class="small text-truncate mt-1" title="${esc(i.name)}">${esc(i.name)}</div><button class="btn btn-sm btn-link text-danger p-0 mt-1" data-icon-del="${i.id}"><i class="bi bi-trash"></i></button></div>`).join('') || `<div class="text-secondary small">Chưa có icon.</div>`;
    list.querySelectorAll('[data-icon-del]').forEach(b=>b.onclick=async()=>{
      if(!await confirmAction('Xóa icon khỏi thư viện?')) return;
      const d=getData(), id=b.dataset.iconDel; d.icons=d.icons.filter(x=>x.id!==id); d.items.forEach(x=>{if(x.iconId===id)x.iconId='';}); save(d); renderList(); render();
    });
  };
  document.getElementById('iconSave').onclick=async()=>{
    const name=document.getElementById('iconName').value.trim()||'Icon';
    const url=document.getElementById('iconUrl').value.trim(), file=document.getElementById('iconFile').files?.[0];
    let src=url;
    if(file) src=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});
    if(!src) return toast('Nhập URL hoặc chọn file icon.','warning');
    const d=getData(); d.icons.push({id:uid('ico'),name,src}); save(d); document.getElementById('iconName').value='';document.getElementById('iconUrl').value='';document.getElementById('iconFile').value=''; renderList(); render();
  };
  el.addEventListener('hidden.bs.modal',()=>el.remove(),{once:true});
  renderList(); modal.show();
}

function normalizeOrders(d){
  d.folders.sort(sortByOrder).forEach((x,i)=>x.order=(i+1)*10);
  d.folders.forEach(f=>d.items.filter(x=>x.folderId===f.id).sort(sortByOrder).forEach((x,i)=>x.order=(i+1)*10));
}

function bindDrag(){
  const root=host();
  root.querySelectorAll('[draggable="true"]').forEach(el=>{
    el.addEventListener('dragstart',e=>{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',JSON.stringify({type:el.dataset.dragType,id:el.dataset.id}));el.classList.add('dragging');});
    el.addEventListener('dragend',()=>{el.classList.remove('dragging');root.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'));});
  });
  root.querySelectorAll('[data-drop-folder]').forEach(zone=>{
    zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drop-target');});
    zone.addEventListener('dragleave',()=>zone.classList.remove('drop-target'));
    zone.addEventListener('drop',e=>{
      e.preventDefault();zone.classList.remove('drop-target');
      let p; try{p=JSON.parse(e.dataTransfer.getData('text/plain'));}catch{return;}
      const d=getData(), targetFolder=zone.dataset.dropFolder;
      if(p.type==='item'){
        const item=d.items.find(x=>x.id===p.id); if(!item)return;
        item.folderId=targetFolder;
        item.order=Math.max(-10,...d.items.filter(x=>x.folderId===targetFolder&&x.id!==item.id).map(x=>x.order??0))+10;
      }else if(p.type==='folder'){
        const a=d.folders.find(x=>x.id===p.id), b=d.folders.find(x=>x.id===targetFolder); if(!a||!b||a.id===b.id)return;
        const list=d.folders.slice().sort(sortByOrder).filter(x=>x.id!==a.id);
        const idx=list.findIndex(x=>x.id===b.id); list.splice(idx,0,a); list.forEach((x,i)=>x.order=(i+1)*10);
      }
      normalizeOrders(d);save(d);render();
    });
  });
  root.querySelectorAll('[data-drop-item]').forEach(zone=>{
    zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drop-target');});
    zone.addEventListener('dragleave',()=>zone.classList.remove('drop-target'));
    zone.addEventListener('drop',e=>{
      e.preventDefault();zone.classList.remove('drop-target');
      let p;try{p=JSON.parse(e.dataTransfer.getData('text/plain'));}catch{return;}
      if(p.type!=='item')return;
      const d=getData(), moved=d.items.find(x=>x.id===p.id), target=d.items.find(x=>x.id===zone.dataset.dropItem); if(!moved||!target||moved.id===target.id)return;
      moved.folderId=target.folderId;
      const list=d.items.filter(x=>x.folderId===target.folderId&&x.id!==moved.id).sort(sortByOrder);
      const idx=list.findIndex(x=>x.id===target.id); list.splice(idx,0,moved); list.forEach((x,i)=>x.order=(i+1)*10);
      normalizeOrders(d);save(d);render();
    });
  });
}

export function render(){
  const d=getData(), q=query.trim().toLowerCase(), folders=d.folders.slice().sort(sortByOrder);
  host().innerHTML=`
  <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
    <div><h4 class="mb-1">Dấu trang</h4><div class="text-secondary small">Kéo folder hoặc bookmark để thay đổi vị trí.</div></div>
    <div class="d-flex gap-2 flex-wrap">
      <div class="input-group input-group-sm" style="width:260px"><span class="input-group-text"><i class="bi bi-search"></i></span><input id="bmSearch" class="form-control" placeholder="Tìm bookmark..." value="${esc(query)}"></div>
      <button id="bmAddFolder" class="btn btn-sm btn-outline-primary"><i class="bi bi-folder-plus me-1"></i>Folder</button>
      <button id="bmAddItem" class="btn btn-sm btn-primary"><i class="bi bi-plus-lg me-1"></i>Bookmark</button>
      <button id="bmIcons" class="btn btn-sm btn-outline-secondary"><i class="bi bi-images me-1"></i>Icon</button>
    </div>
  </div>
  <div id="bookmarkFolders">
    ${folders.map(f=>{
      const items=d.items.filter(x=>x.folderId===f.id).filter(x=>!q||`${x.title} ${x.url}`.toLowerCase().includes(q)).sort(sortByOrder);
      return `<section class="bookmark-folder mb-3" draggable="true" data-drag-type="folder" data-id="${f.id}" data-drop-folder="${f.id}">
        <div class="d-flex align-items-center gap-2 mb-2">
          <i class="bi bi-folder2"></i><strong>${esc(f.name)}</strong><span class="badge text-bg-secondary">${items.length}</span>
          <div class="ms-auto dropdown">
            <button class="btn btn-sm btn-link text-secondary" data-bs-toggle="dropdown"><i class="bi bi-three-dots"></i></button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><button class="dropdown-item" data-folder-add="${f.id}"><i class="bi bi-plus-lg me-2"></i>Thêm bookmark</button></li>
              <li><button class="dropdown-item" data-folder-edit="${f.id}"><i class="bi bi-pencil me-2"></i>Đổi tên</button></li>
              <li><button class="dropdown-item text-danger" data-folder-del="${f.id}"><i class="bi bi-trash me-2"></i>Xóa folder</button></li>
            </ul>
          </div>
        </div>
        <div class="bookmark-grid">
          ${items.map(x=>{
            const icon=iconSrc(d,x.iconId);
            return `<div class="position-relative" draggable="true" data-drag-type="item" data-id="${x.id}" data-drop-item="${x.id}">
              <a class="bookmark-card pe-5" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" title="${esc(x.url)}">
                ${icon?`<img class="bookmark-icon" src="${esc(icon)}" alt="">`:`<span class="bookmark-icon d-grid place-items-center"><i class="bi bi-link-45deg"></i></span>`}
                <span class="text-truncate fw-semibold small">${esc(x.title)}</span>
              </a>
              <div class="dropdown position-absolute top-50 end-0 translate-middle-y me-1">
                <button class="btn btn-sm btn-link text-secondary p-1" data-bs-toggle="dropdown"><i class="bi bi-three-dots-vertical"></i></button>
                <ul class="dropdown-menu dropdown-menu-end">
                  <li><button class="dropdown-item" data-item-edit="${x.id}">Sửa</button></li>
                  <li><button class="dropdown-item text-danger" data-item-del="${x.id}">Xóa</button></li>
                </ul>
              </div>
            </div>`;
          }).join('') || `<div class="text-secondary small py-2">Thả bookmark vào đây.</div>`}
        </div>
      </section>`;
    }).join('') || `<div class="empty-state"><i class="bi bi-bookmarks fs-1 d-block mb-2"></i>Chưa có folder. Tạo folder đầu tiên để bắt đầu.</div>`}
  </div>`;
  document.getElementById('bmSearch').oninput=e=>{query=e.target.value;render();document.getElementById('bmSearch')?.focus();};
  document.getElementById('bmAddFolder').onclick=()=>openFolderModal();
  document.getElementById('bmAddItem').onclick=()=>openBookmarkModal();
  document.getElementById('bmIcons').onclick=openIconModal;
  host().querySelectorAll('[data-folder-add]').forEach(b=>b.onclick=()=>openBookmarkModal(null,b.dataset.folderAdd));
  host().querySelectorAll('[data-folder-edit]').forEach(b=>b.onclick=()=>openFolderModal(d.folders.find(x=>x.id===b.dataset.folderEdit)));
  host().querySelectorAll('[data-folder-del]').forEach(b=>b.onclick=async()=>{
    const id=b.dataset.folderDel, f=d.folders.find(x=>x.id===id); if(!f)return;
    if(!await confirmAction(`Xóa folder "${f.name}" và toàn bộ bookmark bên trong?`))return;
    const x=getData();x.folders=x.folders.filter(v=>v.id!==id);x.items=x.items.filter(v=>v.folderId!==id);save(x);render();
  });
  host().querySelectorAll('[data-item-edit]').forEach(b=>b.onclick=()=>openBookmarkModal(d.items.find(x=>x.id===b.dataset.itemEdit)));
  host().querySelectorAll('[data-item-del]').forEach(b=>b.onclick=async()=>{
    const id=b.dataset.itemDel, x=d.items.find(v=>v.id===id); if(!x)return;
    if(!await confirmAction(`Xóa bookmark "${x.title}"?`))return;
    const z=getData();z.items=z.items.filter(v=>v.id!==id);save(z);render();
  });
  bindDrag();
}

export const Bookmarks={init(){},render};
