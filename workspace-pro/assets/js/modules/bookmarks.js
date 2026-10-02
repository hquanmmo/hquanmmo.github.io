import {Storage} from '../storage.js';
import {uid, esc, toast, confirmAction, normalizeUrl} from '../utils.js';

const host=()=>document.getElementById('module-bookmark');
let query='';
let sortableInstances=[];

function getData(){return Storage.get('bookmarks');}
function save(data){Storage.set('bookmarks',data);}
function sortByOrder(a,b){return (a.order??0)-(b.order??0);}
function iconSrc(data,id){return data.icons.find(i=>i.id===id)?.src || '';}

function normalizeOrders(data){
  data.folders.sort(sortByOrder).forEach((f,i)=>f.order=(i+1)*10);
  data.folders.forEach(f=>{
    data.items
      .filter(x=>x.folderId===f.id)
      .sort(sortByOrder)
      .forEach((x,i)=>x.order=(i+1)*10);
  });
}

function renderIconPicker(data, selected=''){
  return `<option value="">Không icon</option>` + data.icons
    .slice().sort((a,b)=>a.name.localeCompare(b.name))
    .map(i=>`<option value="${esc(i.id)}" ${i.id===selected?'selected':''}>${esc(i.name)}</option>`)
    .join('');
}

function openFolderModal(folder=null){
  const isEdit=!!folder, id='bookmarkFolderModal';
  document.getElementById(id)?.remove();
  document.body.insertAdjacentHTML('beforeend',`
  <div class="modal fade" id="${id}" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered"><div class="modal-content">
      <div class="modal-header">
        <div><div class="modal-title"><i class="bi bi-folder2-open me-2"></i>${isEdit?'Sửa folder':'Tạo folder'}</div><div class="small text-secondary mt-1">Folder giúp nhóm các liên kết cùng mục đích.</div></div>
        <button class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <label class="form-label">Tên folder</label>
        <input id="bmFolderName" class="form-control" value="${esc(folder?.name||'')}" placeholder="Ví dụ: Task, Data, Lưu trữ...">
      </div>
      <div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Hủy</button><button id="bmFolderSave" class="btn btn-primary"><i class="bi bi-check2 me-1"></i>Lưu</button></div>
    </div></div>
  </div>`);
  const el=document.getElementById(id), modal=bootstrap.Modal.getOrCreateInstance(el);
  el.addEventListener('shown.bs.modal',()=>document.getElementById('bmFolderName').focus());
  document.getElementById('bmFolderSave').onclick=()=>{
    const name=document.getElementById('bmFolderName').value.trim();
    if(!name)return toast('Hãy nhập tên folder.','warning');
    const d=getData();
    if(isEdit){const x=d.folders.find(x=>x.id===folder.id);if(x)x.name=name;}
    else d.folders.push({id:uid('fld'),name,order:Math.max(-10,...d.folders.map(x=>x.order??0))+10});
    normalizeOrders(d);save(d);modal.hide();render();
  };
  el.addEventListener('hidden.bs.modal',()=>el.remove(),{once:true});
  modal.show();
}

function openBookmarkModal(item=null,presetFolder=''){
  const d=getData(),isEdit=!!item,id='bookmarkItemModal';
  const folders=d.folders.slice().sort(sortByOrder);
  if(!folders.length)return toast('Hãy tạo folder trước.','warning');
  document.getElementById(id)?.remove();
  document.body.insertAdjacentHTML('beforeend',`
  <div class="modal fade" id="${id}" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered"><div class="modal-content">
      <div class="modal-header">
        <div><div class="modal-title"><i class="bi bi-bookmark-star me-2"></i>${isEdit?'Sửa bookmark':'Thêm bookmark'}</div><div class="small text-secondary mt-1">Bấm bookmark sẽ chuyển trang ngay trong tab hiện tại.</div></div>
        <button class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <div class="mb-3"><label class="form-label">Tên hiển thị</label><div class="input-group"><span class="input-group-text"><i class="bi bi-type"></i></span><input id="bmTitle" class="form-control" value="${esc(item?.title||'')}" placeholder="Google Sheet"></div></div>
        <div class="mb-3"><label class="form-label">Đường dẫn</label><div class="input-group"><span class="input-group-text"><i class="bi bi-link-45deg"></i></span><input id="bmUrl" class="form-control" value="${esc(item?.url||'')}" placeholder="https://..."></div></div>
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">Folder</label><select id="bmFolder" class="form-select">${folders.map(f=>`<option value="${f.id}" ${(item?.folderId||presetFolder||folders[0].id)===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select></div>
          <div class="col-md-6"><label class="form-label">Icon</label><select id="bmIcon" class="form-select">${renderIconPicker(d,item?.iconId||'')}</select></div>
        </div>
      </div>
      <div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Hủy</button><button id="bmSave" class="btn btn-primary"><i class="bi bi-check2 me-1"></i>Lưu</button></div>
    </div></div>
  </div>`);
  const el=document.getElementById(id),modal=bootstrap.Modal.getOrCreateInstance(el);
  document.getElementById('bmSave').onclick=()=>{
    const title=document.getElementById('bmTitle').value.trim();
    const url=normalizeUrl(document.getElementById('bmUrl').value);
    const folderId=document.getElementById('bmFolder').value;
    const iconId=document.getElementById('bmIcon').value;
    if(!title||!url)return toast('Tên và URL là bắt buộc.','warning');
    const data=getData();
    if(isEdit){
      const x=data.items.find(x=>x.id===item.id);
      if(x){x.title=title;x.url=url;x.folderId=folderId;x.iconId=iconId;x.updatedAt=new Date().toISOString();}
    }else{
      const siblings=data.items.filter(x=>x.folderId===folderId);
      data.items.push({id:uid('bm'),title,url,folderId,iconId,order:Math.max(-10,...siblings.map(x=>x.order??0))+10,createdAt:new Date().toISOString()});
    }
    normalizeOrders(data);save(data);modal.hide();render();
  };
  el.addEventListener('hidden.bs.modal',()=>el.remove(),{once:true});
  modal.show();
}

function openIconModal(){
  const id='bookmarkIconModal';document.getElementById(id)?.remove();
  document.body.insertAdjacentHTML('beforeend',`
  <div class="modal fade" id="${id}" tabindex="-1">
    <div class="modal-dialog modal-lg modal-dialog-centered"><div class="modal-content">
      <div class="modal-header"><div><div class="modal-title"><i class="bi bi-images me-2"></i>Icon Library</div><div class="small text-secondary mt-1">Lưu icon bằng URL hoặc file ảnh nhỏ để dùng lại.</div></div><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="card p-3 mb-3 shadow-none">
          <div class="row g-2 align-items-end">
            <div class="col-md-4"><label class="form-label">Tên icon</label><input id="iconName" class="form-control form-control-sm" placeholder="Google Sheet"></div>
            <div class="col-md-5"><label class="form-label">URL icon</label><input id="iconUrl" class="form-control form-control-sm" placeholder="https://...png"></div>
            <div class="col-md-3"><label class="form-label">Hoặc file</label><input id="iconFile" class="form-control form-control-sm" type="file" accept="image/*"></div>
            <div class="col-12 d-flex justify-content-end"><button id="iconSave" class="btn btn-sm btn-primary"><i class="bi bi-plus-lg me-1"></i>Thêm icon</button></div>
          </div>
        </div>
        <div id="iconLibraryList" class="d-flex flex-wrap gap-2"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Đóng</button></div>
    </div></div>
  </div>`);
  const el=document.getElementById(id),modal=bootstrap.Modal.getOrCreateInstance(el);
  const draw=()=>{
    const d=getData(),list=document.getElementById('iconLibraryList');
    list.innerHTML=d.icons.map(i=>`<div class="icon-library-item"><img src="${esc(i.src)}" alt="" style="width:30px;height:30px;object-fit:contain"><div class="small text-truncate mt-2" title="${esc(i.name)}">${esc(i.name)}</div><button class="btn btn-sm btn-link text-danger p-0 mt-1" data-icon-del="${i.id}" title="Xóa icon"><i class="bi bi-trash3"></i></button></div>`).join('')||`<div class="text-secondary small py-3"><i class="bi bi-image me-1"></i>Chưa có icon nào.</div>`;
    list.querySelectorAll('[data-icon-del]').forEach(b=>b.onclick=async()=>{
      if(!await confirmAction('Xóa icon khỏi thư viện?'))return;
      const z=getData(),iconId=b.dataset.iconDel;z.icons=z.icons.filter(x=>x.id!==iconId);z.items.forEach(x=>{if(x.iconId===iconId)x.iconId='';});save(z);draw();render();
    });
  };
  document.getElementById('iconSave').onclick=async()=>{
    const name=document.getElementById('iconName').value.trim()||'Icon';
    const url=document.getElementById('iconUrl').value.trim();
    const file=document.getElementById('iconFile').files?.[0];
    let src=url;
    if(file)src=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
    if(!src)return toast('Nhập URL hoặc chọn file icon.','warning');
    const d=getData();d.icons.push({id:uid('ico'),name,src});save(d);draw();render();
    document.getElementById('iconName').value='';document.getElementById('iconUrl').value='';document.getElementById('iconFile').value='';
  };
  el.addEventListener('hidden.bs.modal',()=>el.remove(),{once:true});draw();modal.show();
}

function destroySortables(){sortableInstances.forEach(x=>x.destroy?.());sortableInstances=[];}

function initSortables(){
  destroySortables();
  if(typeof Sortable==='undefined'){
    toast('Không tải được thư viện kéo thả. Hãy kiểm tra kết nối mạng.','danger');
    return;
  }
  const folderHost=document.getElementById('bookmarkFolders');
  if(folderHost){
    sortableInstances.push(new Sortable(folderHost,{
      animation:170,
      draggable:'.bookmark-folder',
      handle:'.folder-drag-handle',
      ghostClass:'sortable-ghost',
      chosenClass:'sortable-chosen',
      onEnd(){
        const d=getData();
        [...folderHost.querySelectorAll('.bookmark-folder')].forEach((el,i)=>{const f=d.folders.find(x=>x.id===el.dataset.folderId);if(f)f.order=(i+1)*10;});
        normalizeOrders(d);save(d);render();
      }
    }));
  }
  host().querySelectorAll('.bookmark-grid[data-folder-id]').forEach(grid=>{
    sortableInstances.push(new Sortable(grid,{
      group:{name:'workspace-bookmarks',pull:true,put:true},
      animation:170,
      draggable:'.bookmark-tile',
      handle:'.bookmark-drag-handle',
      ghostClass:'sortable-ghost',
      chosenClass:'sortable-chosen',
      emptyInsertThreshold:22,
      onEnd(evt){
        const d=getData();
        host().querySelectorAll('.bookmark-grid[data-folder-id]').forEach(list=>{
          const folderId=list.dataset.folderId;
          [...list.querySelectorAll('.bookmark-tile')].forEach((el,i)=>{
            const item=d.items.find(x=>x.id===el.dataset.itemId);
            if(item){item.folderId=folderId;item.order=(i+1)*10;}
          });
        });
        normalizeOrders(d);save(d);render();
      }
    }));
  });
}

export function render(){
  const d=getData(),q=query.trim().toLowerCase(),folders=d.folders.slice().sort(sortByOrder);
  host().innerHTML=`
  <div class="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-3">
    <div><div class="d-flex align-items-center gap-2 mb-1"><div class="brand-logo" style="width:32px;height:32px"><i class="bi bi-bookmarks-fill"></i></div><h4 class="mb-0 fw-bold">Dấu trang</h4></div><div class="text-secondary small">Kéo bằng <i class="bi bi-grip-vertical"></i> để sắp xếp folder hoặc di chuyển bookmark giữa các folder.</div></div>
    <div class="bookmark-toolbar d-flex gap-2 flex-wrap align-items-center">
      <div class="input-group input-group-sm" style="width:min(280px,75vw)"><span class="input-group-text"><i class="bi bi-search"></i></span><input id="bmSearch" class="form-control" placeholder="Tìm bookmark..." value="${esc(query)}"></div>
      <button id="bmAddFolder" class="btn btn-sm btn-outline-primary"><i class="bi bi-folder-plus me-1"></i>Folder</button>
      <button id="bmAddItem" class="btn btn-sm btn-primary"><i class="bi bi-bookmark-plus me-1"></i>Bookmark</button>
      <button id="bmIcons" class="btn btn-sm btn-outline-secondary"><i class="bi bi-images me-1"></i>Icon</button>
    </div>
  </div>
  <div id="bookmarkFolders">
    ${folders.map(f=>{
      const allItems=d.items.filter(x=>x.folderId===f.id).sort(sortByOrder);
      const items=allItems.filter(x=>!q||`${x.title} ${x.url}`.toLowerCase().includes(q));
      return `<section class="bookmark-folder mb-3" data-folder-id="${f.id}">
        <div class="d-flex align-items-center gap-2 mb-2">
          <button class="btn btn-sm p-0 border-0 bg-transparent folder-drag-handle" title="Kéo folder"><i class="bi bi-grip-vertical"></i></button>
          <i class="bi bi-folder2 text-warning"></i><span class="folder-title">${esc(f.name)}</span><span class="folder-count">${allItems.length}</span>
          <div class="ms-auto dropdown">
            <button class="btn btn-sm btn-link text-secondary p-1" data-bs-toggle="dropdown"><i class="bi bi-three-dots"></i></button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><button class="dropdown-item" data-folder-add="${f.id}"><i class="bi bi-bookmark-plus me-2"></i>Thêm bookmark</button></li>
              <li><button class="dropdown-item" data-folder-edit="${f.id}"><i class="bi bi-pencil-square me-2"></i>Đổi tên</button></li>
              <li><button class="dropdown-item text-danger" data-folder-del="${f.id}"><i class="bi bi-trash3 me-2"></i>Xóa folder</button></li>
            </ul>
          </div>
        </div>
        <div class="bookmark-grid" data-folder-id="${f.id}">
          ${items.map(x=>{
            const icon=iconSrc(d,x.iconId);
            return `<div class="bookmark-tile" data-item-id="${x.id}">
              <a class="bookmark-card" href="${esc(x.url)}" title="${esc(x.url)}">
                ${icon?`<img class="bookmark-icon" src="${esc(icon)}" alt="">`:`<span class="bookmark-icon d-grid place-items-center"><i class="bi bi-link-45deg"></i></span>`}
                <span class="bookmark-card-title">${esc(x.title)}</span>
              </a>
              <div class="bookmark-controls">
                <button class="btn bookmark-drag-handle" title="Kéo bookmark"><i class="bi bi-grip-vertical"></i></button>
                <div class="dropdown"><button class="btn" data-bs-toggle="dropdown" title="Tùy chọn"><i class="bi bi-three-dots-vertical"></i></button><ul class="dropdown-menu dropdown-menu-end"><li><button class="dropdown-item" data-item-edit="${x.id}"><i class="bi bi-pencil me-2"></i>Sửa</button></li><li><button class="dropdown-item text-danger" data-item-del="${x.id}"><i class="bi bi-trash3 me-2"></i>Xóa</button></li></ul></div>
              </div>
            </div>`;
          }).join('') || `<div class="text-secondary small py-2 px-1"><i class="bi bi-arrow-down-square me-1"></i>${q?'Không có kết quả trong folder này.':'Kéo bookmark vào đây.'}</div>`}
        </div>
      </section>`;
    }).join('') || `<div class="empty-state"><i class="bi bi-bookmarks fs-1 d-block mb-2"></i><div class="fw-semibold text-light mb-1">Chưa có folder</div><div class="small">Tạo folder đầu tiên để bắt đầu sắp xếp bookmark.</div></div>`}
  </div>`;

  const search=document.getElementById('bmSearch');
  search.oninput=e=>{query=e.target.value;render();const s=document.getElementById('bmSearch');s?.focus();s?.setSelectionRange(query.length,query.length);};
  document.getElementById('bmAddFolder').onclick=()=>openFolderModal();
  document.getElementById('bmAddItem').onclick=()=>openBookmarkModal();
  document.getElementById('bmIcons').onclick=openIconModal;
  host().querySelectorAll('[data-folder-add]').forEach(b=>b.onclick=()=>openBookmarkModal(null,b.dataset.folderAdd));
  host().querySelectorAll('[data-folder-edit]').forEach(b=>b.onclick=()=>openFolderModal(d.folders.find(x=>x.id===b.dataset.folderEdit)));
  host().querySelectorAll('[data-folder-del]').forEach(b=>b.onclick=async()=>{
    const f=d.folders.find(x=>x.id===b.dataset.folderDel);if(!f)return;
    if(!await confirmAction(`Xóa folder "${f.name}" và toàn bộ bookmark bên trong?`))return;
    const z=getData();z.folders=z.folders.filter(x=>x.id!==f.id);z.items=z.items.filter(x=>x.folderId!==f.id);save(z);render();
  });
  host().querySelectorAll('[data-item-edit]').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();openBookmarkModal(d.items.find(x=>x.id===b.dataset.itemEdit));});
  host().querySelectorAll('[data-item-del]').forEach(b=>b.onclick=async e=>{e.preventDefault();e.stopPropagation();const item=d.items.find(x=>x.id===b.dataset.itemDel);if(!item)return;if(!await confirmAction(`Xóa bookmark "${item.title}"?`))return;const z=getData();z.items=z.items.filter(x=>x.id!==item.id);save(z);render();});
  initSortables();
}

export const Bookmarks={init(){},render};
