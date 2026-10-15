/* Personal Notes Mini App. No bot token or server credentials belong in this client. */
const tg = window.Telegram?.WebApp;
try { tg?.ready(); tg?.expand(); } catch (_) {}
const $ = (selector, root = document) => root.querySelector(selector);
const view = $('#view');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = () => crypto.randomUUID().toUpperCase();
const now = () => Date.now() / 1000 - 978307200; // Foundation Date, seconds since 2001
const date = seconds => seconds == null ? 'Дата не сохранена' : new Date((seconds + 978307200) * 1000).toLocaleString('ru-RU', {dateStyle:'medium', timeStyle:'short'});
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const empty = () => ({folders:[], notes:[]});
let data = empty(), meta = {dark:false, pin:null, failedPIN:0, blockedUntil:0}, route = {page:'folders'};
let unlocked = false, recording = null, recordChunks = [], openRow = null, saveQueue = Promise.resolve(), noticeTimer, saveTimer;

function notify(message) { const n = $('#notice'); n.textContent = message; n.classList.add('show'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => n.classList.remove('show'), 3500); }
function dbOpen() { return new Promise((resolve,reject) => { const r = indexedDB.open('personal-notes-mini',1); r.onupgradeneeded = () => r.result.createObjectStore('app'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function dbRead() { const db = await dbOpen(); return new Promise((resolve,reject) => { const t = db.transaction('app'); const r = t.objectStore('app').get('state'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); t.oncomplete = () => db.close(); }); }
async function dbWrite(value) { const db = await dbOpen(); return new Promise((resolve,reject) => { const t = db.transaction('app','readwrite'); t.objectStore('app').put(value,'state'); t.oncomplete = () => {db.close(); resolve();}; t.onerror = () => {db.close(); reject(t.error);}; }); }
function persist() { const snapshot = structuredClone({data,meta}); saveQueue = saveQueue.catch(() => {}).then(() => dbWrite(snapshot)).catch(() => notify('Не удалось сохранить. Освободите память устройства и сохраните копию.')); return saveQueue; }
function flushSave() { if(saveTimer){clearTimeout(saveTimer);saveTimer=null;persist();} }
function change(next) { flushSave(); route = next; openRow = null; if (next.page !== 'hidden' && !(['note','note-setup'].includes(next.page) && data.notes.find(n => n.id === next.id)?.hidden)) unlocked = false; render(); }
function currentNote() { return data.notes.find(n => n.id === route.id); }
function lock() { unlocked = false; if (route.page === 'hidden' || (['note','note-setup'].includes(route.page) && currentNote()?.hidden)) { route = {page:'folders'}; render(); } }
document.addEventListener('visibilitychange', () => { if (document.hidden) { flushSave(); if (recording) stopRecording(); lock(); } });
window.addEventListener('pagehide', () => {flushSave();lock();});
function theme() { document.documentElement.classList.toggle('dark', !!meta.dark); try { tg?.setHeaderColor?.(meta.dark ? '#18191d' : '#f4f5f6'); tg?.setBackgroundColor?.(meta.dark ? '#18191d' : '#f4f5f6'); } catch (_) {} }

function folderIcon() { return '<svg class="folder-mark" viewBox="0 0 40 32" aria-hidden="true"><path class="fold" d="M2 4Q2 1 5 1h10l3 4h17q3 0 3 3v4H2z"/><path d="M2 9h36v18q0 4-4 4H6q-4 0-4-4z"/></svg>'; }
function row(id, icon, name, detail, actions, destination) {
  const content = destination === 'note' ? `<span class="row-name">${esc(name)}</span>${detail}` : `${icon}<span class="row-text"><span class="row-name">${esc(name)}</span></span><span class="folder-count">${esc(detail)}</span>`;
  return `<div class="row ${destination==='note'?'note-tile':''}" data-row="${esc(id)}" style="--reveal:-${actions.length * 50 + 17}px"><div class="row-actions">${actions.map(a => `<button class="round-action ${a.danger?'danger':''}" data-action="${a.action}" data-id="${esc(id)}" aria-label="${esc(a.label)}" title="${esc(a.label)}">${a.icon}</button>`).join('')}</div><button class="row-main" data-go="${destination}" data-id="${esc(id)}">${content}</button></div>`;
}
const trashIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.5h15M9 6.5V4.7h6v1.8M7 6.5l.6 12.1c.05.8.7 1.4 1.5 1.4h5.8c.8 0 1.45-.6 1.5-1.4L17 6.5M10 10v6M14 10v6"/></svg>';
const hideIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.2 10.2 0 0 1 12 5c5.7 0 9.4 5.3 9.4 7 0 .8-.8 2.3-2.2 3.7M7.2 6.2C4.3 7.6 2.6 10.6 2.6 12c0 1.7 3.7 7 9.4 7 1.3 0 2.6-.3 3.8-.8M9.3 9.3a3.8 3.8 0 0 0 5.4 5.4"/></svg>';
const showIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.6 12c0-1.7 3.7-7 9.4-7s9.4 5.3 9.4 7-3.7 7-9.4 7-9.4-5.3-9.4-7z"/><circle cx="12" cy="12" r="3.5"/></svg>';
const deleteAction = {action:'delete', label:'Удалить', icon:trashIcon, danger:true};
function foldersHTML() {
  const folders = data.folders.map(f => row(f.id,folderIcon(), f.name, `${data.notes.filter(n => n.folderID === f.id && !n.hidden).length} заметок`, [deleteAction], 'folder')).join('');
  return `<div class="archive-bar"><button class="archive-entry" data-go="hidden"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10" width="13" height="10.5" rx="3"/><path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3"/><path d="M12 14.5v2"/></svg><span>Скрытые заметки</span></button></div><div class="section-title">Папки</div>${folders || '<div class="empty">Здесь появятся ваши папки</div>'}<div class="toolbar"><button class="primary" data-action="new-folder">＋ Создать папку</button></div>`;
}
function notePreview(n) {
  if (n.kind === 'text') return n.body.trim() ? `<span class="note-preview note-preview-text">${esc(n.body.trim().slice(0,280))}</span>` : '';
  const active = n.showsCheckboxes ? n.items.filter(item => !item.isDone) : n.items;
  const shown = active.slice(0, 6).map(item => `<span class="preview-item">${n.showsCheckboxes?'<span class="preview-box" aria-hidden="true"></span>':''}${n.showsNumbers?`<span class="preview-number">${n.items.indexOf(item)+1}.</span>`:''}<span>${esc(item.text || '…')}</span></span>`).join('');
  const remainder = active.length - 6;
  const completed = n.showsCheckboxes ? n.items.length - active.length : 0;
  return `<span class="note-preview">${shown}${remainder>0?`<span class="preview-extra">Ещё ${remainder} пунктов</span>`:''}${completed>0?`<span class="preview-extra">Выполнено: ${completed}</span>`:''}</span>`;
}
function notesHTML(folderID) {
  const hidden = folderID == null;
  const notes = data.notes.filter(n => hidden ? n.hidden : n.folderID === folderID && !n.hidden);
  return `<div class="section-title">${hidden ? 'Защищённые заметки' : 'Заметки'}</div><div class="note-grid">${notes.map(n => row(n.id, '', n.title || 'Без названия', notePreview(n), [{action:'hide', label:hidden?'Показать':'Скрыть', icon:hidden?showIcon:hideIcon}, deleteAction], 'note')).join('') || '<div class="empty">Здесь пока нет заметок</div>'}</div>${!hidden ? '<div class="toolbar"><button class="primary" data-action="new-text">＋ Текстовая заметка</button><button class="pill" data-action="new-list">☷ Список</button></div>' : ''}`;
}
function itemHTML(item,index,number,checkbox) { return `<div class="task-row ${item.isDone && checkbox?'done':''}" data-item="${esc(item.id)}">${checkbox ? `<input type="checkbox" data-check="${esc(item.id)}" ${item.isDone?'checked':''} aria-label="Отметить выполненным">` : ''}${number ? `<span class="task-number">${index+1}.</span>`:''}<input type="text" class="task-input" data-item-text="${esc(item.id)}" value="${esc(item.text)}" placeholder="Пункт списка"><button class="task-remove" data-remove-item="${esc(item.id)}" aria-label="Удалить пункт">×</button></div>`; }
function editorHTML(n, setup = false) {
  const active = n.showsCheckboxes ? n.items.filter(i => !i.isDone) : n.items;
  const done = n.showsCheckboxes ? n.items.filter(i => i.isDone) : [];
  const indices = new Map(n.items.map((item,index) => [item.id,index]));
  const listOptions = n.kind === 'list' ? `<div class="section-title">Настройки списка</div><p class="setup-hint">Выберите, как показывать пункты. Позже это можно изменить через шестерёнку.</p><div class="switch-line"><label for="checkboxes">Галочки</label><input id="checkboxes" type="checkbox" ${n.showsCheckboxes?'checked':''}></div><div class="switch-line"><label for="numbers">Нумерация</label><input id="numbers" type="checkbox" ${n.showsNumbers?'checked':''}></div>` : '';
  const options = setup ? `<div class="setup-panel">${listOptions}<div class="toolbar"><button class="quiet" data-action="calendar">Добавить в Google Календарь</button></div></div>` : '';
  const items = `<div class="section-title">Пункты</div>${active.map(i => itemHTML(i,indices.get(i.id),n.showsNumbers,n.showsCheckboxes)).join('')}<button class="quiet" data-action="add-item">＋ Пункт</button>${done.length ? `<div class="section-title">Выполнено · ${done.length}</div>${done.map(i => itemHTML(i,indices.get(i.id),n.showsNumbers,n.showsCheckboxes)).join('')}` : ''}`;
  const titleField = setup ? `<label class="field"><span>Название</span><input type="text" id="note-title" value="${esc(n.title)}" placeholder="Название заметки"></label>` : '';
  return `${options}<div class="editor-card">${titleField}${n.kind === 'text' ? `<label class="field"><span>Текст</span><textarea id="note-body" placeholder="Введите текст">${esc(n.body)}</textarea></label>` : items}</div>${setup ? '<div class="toolbar"><button class="primary" data-action="finish-setup">Готово</button></div>' : ''}<div class="note-dates"><span>Создано: ${date(n.createdAt)}</span><span>Изменено: ${date(n.updatedAt)}</span></div>`;
}
function settingsHTML() { return `<div class="panel"><div class="switch-line"><label for="theme-toggle">Тёмная тема</label><input id="theme-toggle" type="checkbox" ${meta.dark?'checked':''}></div><div class="switch-line"><span>Код скрытых заметок</span><button class="pill" data-action="pin-change">${meta.pin?'Сменить':'Создать'}</button></div></div><div class="panel"><h2>Резервная копия</h2><p class="hint">Заметки хранятся в памяти браузера Telegram на этом устройстве. Экспортируйте JSON, чтобы перенести их на другое устройство или восстановить после очистки данных.</p><div class="toolbar"><button class="primary" data-action="export">Скачать JSON</button><label class="pill">Загрузить JSON<input id="backup-file" type="file" accept="application/json,.json" hidden></label></div><p class="small">Копия содержит текст, скрытые заметки, фото и записи без шифрования. Держите её в защищённом месте.</p></div><div class="panel"><p class="small">Для Google Календаря заметка открывает форму создания события. Автоматическая синхронизация Google Drive в этой версии ещё не подключена.</p></div>`; }
function render() {
  const f = data.folders.find(x => x.id === route.id), n = currentNote();
  if ((route.page === 'folder' && !f) || (['note','note-setup'].includes(route.page) && !n) || (route.page === 'hidden' && !unlocked)) route = {page:'folders'};
  const title = route.page==='folders'?'Мои заметки':route.page==='folder'?f.name:route.page==='hidden'?'Скрытые заметки':route.page==='note'?(n.title||'Заметка'):route.page==='note-setup'?'Редактирование':'Настройки';
  $('#title').textContent = title; $('#back').hidden = route.page==='folders'; $('#settings').hidden = ['settings','note','note-setup'].includes(route.page);
  $('#note-options').hidden = route.page!=='note'; $('#done').hidden = route.page!=='note-setup';
  view.classList.toggle('note-view',['note','note-setup'].includes(route.page));
  view.innerHTML = route.page==='folders'?foldersHTML():route.page==='folder'?notesHTML(route.id):route.page==='hidden'?notesHTML(null):route.page==='note'||route.page==='note-setup'?editorHTML(n,route.page==='note-setup'):settingsHTML();
  theme(); bindSwipes();
}

function modal(title, body, actions) {
  $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = body; $('#dialog-actions').replaceChildren();
  $('#dialog').hidden = false;
  return new Promise(resolve => { let settled = false; const done = result => { if (settled) return; settled = true; $('#dialog').hidden = true; $('#dialog').onclick = null; resolve(result); };
    for (const a of actions) { const button = document.createElement('button'); button.className = a.danger?'pill danger-text':a.primary?'primary':'quiet'; button.textContent = a.label; button.onclick = async () => { if (a.value === 'ok' && a.validate && !a.validate()) return; done(a.value); }; $('#dialog-actions').append(button); }
    $('#dialog').onclick = e => { if (e.target.matches('[data-close]')) done(null); };
  });
}
async function askText(title, placeholder, initial='') { const result = await modal(title,`<input id="modal-input" type="text" maxlength="100" placeholder="${esc(placeholder)}" value="${esc(initial)}">`,[{label:'Отмена',value:null},{label:'Сохранить',value:'ok',primary:true,validate:()=>!!$('#modal-input').value.trim()}]); const value = result==='ok'?$('#modal-input').value.trim():null; return value; }
async function confirm(message) { return await modal('Подтвердите действие',`<p>${esc(message)}</p>`,[{label:'Отмена',value:null},{label:'Удалить',value:'ok',danger:true}]) === 'ok'; }

async function derivePIN(code,salt) { const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(code),'PBKDF2',false,['deriveBits']); const bits = await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},key,256); return new Uint8Array(bits); }
const hex = bytes => [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
async function setPIN() { const entry = await modal('Новый код', '<p>Придумайте шестизначный код для скрытых заметок.</p><input id="pin-first" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="6 цифр"><input id="pin-repeat" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="Повторите код" style="margin-top:9px">', [{label:'Отмена',value:null},{label:'Сохранить',value:'ok',primary:true,validate:()=>{const a=$('#pin-first').value,b=$('#pin-repeat').value;if(!/^\d{6}$/.test(a)||a!==b){notify('Введите одинаковые шестизначные коды');return false;}return true;}}]); if (entry !== 'ok') return false; const code = $('#pin-first').value; const salt=crypto.getRandomValues(new Uint8Array(16)); meta.pin={salt:hex(salt),hash:hex(await derivePIN(code,salt))}; persist(); return true; }
async function requirePIN() { if (!meta.pin) return setPIN(); if(Date.now() < (meta.blockedUntil||0)){notify('Повторите попытку через 30 секунд');return false;}const entry = await modal('Введите код', '<p>Доступ к скрытым заметкам</p><input id="pin-entry" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="6 цифр">', [{label:'Отмена',value:null},{label:'Открыть',value:'ok',primary:true}]); if(entry!=='ok')return false;const code=$('#pin-entry').value;let correct=false;if(/^\d{6}$/.test(code)){const salt=Uint8Array.from(meta.pin.salt.match(/../g).map(x=>parseInt(x,16)));correct=hex(await derivePIN(code,salt))===meta.pin.hash;}if(!correct){meta.failedPIN=(meta.failedPIN||0)+1;if(meta.failedPIN>=5){meta.blockedUntil=Date.now()+30000;meta.failedPIN=0;}persist();notify('Неверный код');return false;}meta.failedPIN=0;meta.blockedUntil=0;persist();return true; }
async function authorizeHidden() { if(unlocked)return true; const ok=await requirePIN();if(ok)unlocked=true;return ok; }

function validBackup(b) {
  if (!b || b.formatVersion !== 1 || !b.data || !Array.isArray(b.data.folders) || !Array.isArray(b.data.notes) || !Array.isArray(b.attachments)) throw Error('Неверный формат резервной копии');
  const ids=new Set(), filenames=new Set(), folderIDs=new Set();
  for(const f of b.data.folders){if(!UUID.test(f.id)||folderIDs.has(f.id)||typeof f.name!=='string')throw Error('Повреждены папки');folderIDs.add(f.id);}
  for(const n of b.data.notes){if(!UUID.test(n.id)||ids.has(n.id)||!folderIDs.has(n.folderID)||!['text','list'].includes(n.kind)||!Array.isArray(n.items)||!Array.isArray(n.media))throw Error('Повреждены заметки');ids.add(n.id);let itemIDs=new Set();for(const i of n.items){if(!UUID.test(i.id)||itemIDs.has(i.id)||typeof i.text!=='string')throw Error('Повреждён список');itemIDs.add(i.id);}for(const m of n.media){if(!UUID.test(m.id)||!['photo','audio'].includes(m.kind)||!new RegExp('^[0-9a-f-]{36}\\.(jpg|m4a|webm)$','i').test(m.filename)||!UUID.test(m.filename.split('.')[0])||filenames.has(m.filename))throw Error('Повреждены вложения');filenames.add(m.filename);}}
  const attachments=new Map();for(const a of b.attachments){if(!filenames.has(a.filename)||attachments.has(a.filename)||typeof a.contents!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.contents))throw Error('Повреждены вложения');attachments.set(a.filename,a.contents);}if(attachments.size!==filenames.size)throw Error('Не найдены вложения');return attachments;
}
function backup() { return {formatVersion:1,createdAt:now(),data:{folders:data.folders,notes:data.notes.map(n=>{const copy={...n};copy.media=(n.media||[]).map(({contents,mime,...rest})=>rest);return copy;})},attachments:data.notes.flatMap(n=>(n.media||[]).map(m=>({filename:m.filename,contents:m.contents})))}; }
function download(blob,name) { const url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000); }
async function exportBackup() { if(data.notes.some(n=>n.hidden)&&!await authorizeHidden())return;const json=JSON.stringify(backup()); download(new Blob([json],{type:'application/json'}),`PersonalNotes-${new Date().toISOString().slice(0,10)}.json`);notify('Копия создана'); }
async function importBackup(file) { if(!file)return;if(file.size>120*1024*1024){notify('Копия больше 120 МБ');return;}try{const b=JSON.parse(await file.text());const attachments=validBackup(b);if(data.notes.some(n=>n.hidden)&&!await authorizeHidden())return;const ok=await modal('Заменить заметки?', '<p>Импорт заменит все текущие папки и заметки. Сначала сохраните копию, если они нужны.</p>',[{label:'Отмена',value:null},{label:'Заменить',value:'ok',primary:true}]);if(ok!=='ok')return;const incoming={folders:b.data.folders,notes:b.data.notes.map(n=>({...n,showsCheckboxes:!!n.showsCheckboxes,showsNumbers:n.showsNumbers!==false,hidden:!!n.hidden,items:n.items.map(i=>({...i,isDone:!!i.isDone})),media:n.media.map(m=>({...m,contents:attachments.get(m.filename),mime:m.kind==='photo'?'image/jpeg':m.filename.endsWith('.webm')?'audio/webm':'audio/mp4'}))}))};if(incoming.notes.some(n=>n.hidden)&&!meta.pin&& !await setPIN())return;data=incoming;unlocked=false;route={page:'folders'};await persist();render();notify('Копия загружена');}catch(e){notify(e.message||'Не удалось загрузить копию');} }

async function addPhoto(file) { if(!file||!currentNote())return;try{const bitmap=await createImageBitmap(file),scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));if(!blob)throw Error('Не удалось обработать фото');await attach(blob,'photo','jpg','image/jpeg');}catch(e){notify(e.message);} }
function blobBase64(blob) { return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);}); }
async function attach(blob,kind,ext,mime) { if(blob.size>18*1024*1024){notify('Один файл должен быть меньше 18 МБ');return;}const n=currentNote();if(!n)return;const id=uuid();n.media.push({id:uuid(),kind,filename:`${id}.${ext}`,contents:await blobBase64(blob),mime});n.updatedAt=now();persist();render(); }
async function startRecording() { if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('Запись недоступна в этом Telegram. Попробуйте обновить приложение.');const stream=await navigator.mediaDevices.getUserMedia({audio:true});const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));try{const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});const noteID=route.id;recordChunks=[];recording=recorder;recorder.ondataavailable=e=>{if(e.data.size)recordChunks.push(e.data);};recorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());recording=null;const type=recorder.mimeType||'audio/webm', ext=type.includes('mp4')?'m4a':'webm';if(recordChunks.length&&route.page==='note'&&route.id===noteID){try{await attach(new Blob(recordChunks,{type}),'audio',ext,type);}catch(e){notify(e.message);}}render();};recorder.start();render();}catch(e){stream.getTracks().forEach(t=>t.stop());throw e;} }
function stopRecording(){if(recording?.state==='recording')recording.stop();}

async function action(name,id) {
  const n=data.notes.find(x=>x.id===id), f=data.folders.find(x=>x.id===id);
  if(name==='new-folder'){const title=await askText('Новая папка','Название папки');if(title){data.folders.push({id:uuid(),name:title,createdAt:now()});persist();render();}}
  if(name==='new-text'||name==='new-list'){const note={id:uuid(),folderID:route.id,title:'',kind:name==='new-list'?'list':'text',body:'',items:[],showsCheckboxes:name==='new-list',showsNumbers:false,hidden:false,createdAt:now(),updatedAt:now(),media:[]};data.notes.unshift(note);persist();change({page:'note-setup',id:note.id});}
  if(name==='finish-setup'&&route.page==='note-setup'&&currentNote())change({page:'note',id:route.id});
  if(name==='add-item'&&currentNote()){const item={id:uuid(),text:'',isDone:false};currentNote().items.push(item);currentNote().updatedAt=now();persist();render();$(`[data-item-text="${item.id}"]`)?.focus();}
  if(name==='hide'&&n){if(n.hidden&&!await authorizeHidden())return;if(!n.hidden&&!meta.pin&&!await setPIN())return;n.hidden=!n.hidden;n.updatedAt=now();persist();render();}
  if(name==='delete'){if(n){if(n.hidden&&!await authorizeHidden())return;if(await confirm(`Удалить «${n.title||'Без названия'}»?`)){data.notes=data.notes.filter(x=>x.id!==id);persist();render();}}else if(f){if(data.notes.some(x=>x.folderID===id&&x.hidden)&&!await authorizeHidden())return;if(await confirm(`Удалить папку «${f.name}» и все заметки внутри?`)){data.folders=data.folders.filter(x=>x.id!==id);data.notes=data.notes.filter(x=>x.folderID!==id);persist();render();}}}
  if(name==='pin-change'){if(!meta.pin||await requirePIN()){if(await setPIN())notify('Код сохранён');}}
  if(name==='export')await exportBackup();
  if(name==='record'){try{if(recording)stopRecording();else await startRecording();}catch(e){notify(e.message||'Не удалось записать голос');}}
  if(name==='calendar'&&currentNote()){const note=currentNote(),text=note.kind==='text'?note.body:note.items.map((i,j)=>`${note.showsNumbers?`${j+1}. `:''}${i.text}`).join('\n');const url=new URL('https://calendar.google.com/calendar/render');url.searchParams.set('action','TEMPLATE');url.searchParams.set('text',note.title||'Заметка');url.searchParams.set('details',text);if(tg?.openLink)tg.openLink(url.href);else window.open(url.href,'_blank','noopener');}
}

view.addEventListener('click', async e => {
  const button=e.target.closest('[data-action]');if(button){await action(button.dataset.action,button.dataset.id);return;}
  const go=e.target.closest('[data-go]');if(!go)return;
  const target=go.dataset.go;
  if(target==='folder')change({page:'folder',id:go.dataset.id});
  if(target==='note'){const n=data.notes.find(x=>x.id===go.dataset.id);if(n?.hidden&&!await authorizeHidden())return;change({page:'note',id:go.dataset.id});}
  if(target==='hidden'&&await authorizeHidden())change({page:'hidden'});
});
view.addEventListener('input',e=>{const n=currentNote();if(!n)return;if(e.target.id==='note-title')n.title=e.target.value;if(e.target.id==='note-body')n.body=e.target.value;if(e.target.dataset.itemText){const item=n.items.find(i=>i.id===e.target.dataset.itemText);if(item)item.text=e.target.value;}n.updatedAt=now();clearTimeout(saveTimer);saveTimer=setTimeout(()=>{saveTimer=null;persist();},250);});
view.addEventListener('change',async e=>{const n=currentNote();if(e.target.id==='theme-toggle'){meta.dark=e.target.checked;persist();theme();return;}if(e.target.id==='backup-file'){await importBackup(e.target.files[0]);return;}if(e.target.id==='photo-file'){await addPhoto(e.target.files[0]);return;}if(!n)return;if(e.target.id==='checkboxes')n.showsCheckboxes=e.target.checked;if(e.target.id==='numbers')n.showsNumbers=e.target.checked;if(e.target.dataset.check){const item=n.items.find(i=>i.id===e.target.dataset.check);if(item)item.isDone=e.target.checked;}n.updatedAt=now();persist();render();});
view.addEventListener('keydown',e=>{if(e.key!=='Enter'||!e.target.dataset.itemText)return;e.preventDefault();const n=currentNote();if(!n)return;const index=n.items.findIndex(i=>i.id===e.target.dataset.itemText);const item={id:uuid(),text:'',isDone:false};n.items.splice(index+1,0,item);n.updatedAt=now();persist();render();$(`[data-item-text="${item.id}"]`)?.focus();});
view.addEventListener('click',e=>{const id=e.target.dataset.removeItem,mediaID=e.target.dataset.removeMedia,n=currentNote();if(!n)return;if(id){n.items=n.items.filter(i=>i.id!==id);n.updatedAt=now();persist();render();}if(mediaID){n.media=n.media.filter(m=>m.id!==mediaID);n.updatedAt=now();persist();render();}});
$('#settings').onclick=()=>change({page:'settings'});
$('#note-options').onclick=()=>{if(route.page==='note'&&currentNote())change({page:'note-setup',id:route.id});};
$('#done').onclick=()=>{if(route.page==='note-setup'&&currentNote())change({page:'note',id:route.id});};
$('#back').onclick=()=>{if(route.page==='note-setup'){change({page:'note',id:route.id});}else if(route.page==='note'){const n=currentNote();change(n?.hidden?{page:'hidden'}:{page:'folder',id:n?.folderID});}else change({page:'folders'});};
function bindSwipes() {
  for (const row of view.querySelectorAll('.row')) {
    let start = null, suppressClick = false, clickTimer;
    const begin = (x,y) => { start = {x,y}; };
    const end = (x,y) => {
      if (!start) return;
      const dx=x-start.x, dy=y-start.y; start=null;
      if (Math.abs(dx)<32 || Math.abs(dx)<Math.abs(dy)*1.25) return;
      suppressClick=true;
      clearTimeout(clickTimer);
      clickTimer=setTimeout(()=>{suppressClick=false;},350);
      if (openRow && openRow!==row) openRow.classList.remove('open');
      row.classList.toggle('open',dx<0);
      openRow=row.classList.contains('open')?row:null;
    };
    row.addEventListener('touchstart',e=>begin(e.touches[0].clientX,e.touches[0].clientY),{passive:true});
    row.addEventListener('touchend',e=>end(e.changedTouches[0].clientX,e.changedTouches[0].clientY),{passive:true});
    row.addEventListener('touchcancel',()=>{start=null;},{passive:true});
    row.addEventListener('mousedown',e=>{if(e.button===0)begin(e.clientX,e.clientY);});
    row.addEventListener('mouseup',e=>end(e.clientX,e.clientY));
    row.addEventListener('click',e=>{
      if (suppressClick) {suppressClick=false;e.preventDefault();e.stopPropagation();return;}
      if (row.classList.contains('open') && e.target.closest('.row-main')) {
        row.classList.remove('open'); openRow=null; e.preventDefault();e.stopPropagation();
      }
    },true);
    row.addEventListener('contextmenu',e=>{e.preventDefault();if(openRow&&openRow!==row)openRow.classList.remove('open');row.classList.toggle('open');openRow=row.classList.contains('open')?row:null;});
  }
}
async function init() {try{const saved=await dbRead();if(saved?.data?.folders&&saved?.data?.notes){data=saved.data;meta=saved.meta||meta;}}catch(e){notify('Хранилище недоступно. Изменения могут не сохраниться.');}render();}
init();
