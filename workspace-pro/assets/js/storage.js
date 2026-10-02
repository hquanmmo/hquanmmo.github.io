const NS = 'workspacePro.v2';

const defaults = {
  bookmarks: { folders: [], items: [], icons: [] },
  todos: { tasks: [], completions: {} },
  powershell: { documents: [], runtimeValues: {} },
  settings: { lastModule: 'bookmark' }
};

function key(name){ return `${NS}.${name}`; }

export const Storage = {
  get(name){
    try{
      const raw = localStorage.getItem(key(name));
      return raw ? JSON.parse(raw) : structuredClone(defaults[name]);
    }catch{
      return structuredClone(defaults[name]);
    }
  },
  set(name, value){
    localStorage.setItem(key(name), JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('workspace:storage', {detail:{name}}));
    return value;
  },
  update(name, mutator){
    const value = this.get(name);
    const next = mutator(value) ?? value;
    return this.set(name, next);
  },
  exportAll(){
    const data = {};
    Object.keys(defaults).forEach(k => data[k] = this.get(k));
    return {app:'Workspace Pro', version:2, exportedAt:new Date().toISOString(), data};
  },
  importAll(payload){
    if(!payload?.data) throw new Error('File backup không hợp lệ.');
    Object.keys(defaults).forEach(k => {
      if(payload.data[k] !== undefined) this.set(k, payload.data[k]);
    });
  },
  clearAll(){
    Object.keys(defaults).forEach(k => localStorage.removeItem(key(k)));
    window.location.reload();
  }
};
