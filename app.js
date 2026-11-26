let state = { events: [] };
let currentEventId = null;
let activeTab = 'pilots';
let draftResult = null;
let toastTimer;
let authReady = false;
let authMode = 'login';
let currentUser = null;
let localMode = false;
let firebaseRuntime = null;
let cloudLoadError = false;

function persist() {
  if (localMode) {
    try {
      localStorage.setItem('kartou-v1', JSON.stringify(state));
    } catch (error) {
      console.error('Falha ao salvar os dados neste dispositivo.', error);
      notify('Não foi possível salvar. O armazenamento do dispositivo pode estar cheio.');
    }
    return;
  }
  if (!currentUser || !firebaseRuntime) return;
  const { db, firestore } = firebaseRuntime;
  firestore.setDoc(firestore.doc(db, 'users', currentUser.uid, 'kartou', 'data'), {
    events: state.events,
    updatedAt: firestore.serverTimestamp()
  }).catch(error => {
    console.error('Falha ao salvar os dados da conta.', error);
    notify('Não foi possível sincronizar agora. Confira sua conexão.');
  });
}
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function getEvent(id = currentEventId) { return state.events.find(item => item.id === id); }
function formatDate(value) { if (!value) return 'Data não definida'; const [y,m,d] = value.split('-'); return `${d}/${m}/${y}`; }
function notify(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
function setModal(content) { document.querySelector('#modalContent').innerHTML = content; document.querySelector('#modal').showModal(); }
function closeModal() { document.querySelector('#modal').close(); }
document.addEventListener('click', event => { if (event.target.closest('[data-modal-close]')) closeModal(); });
document.querySelector('#modal').addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });
function renderAuth() {
  const creating = authMode === 'signup';
  const setupMessage = !firebaseRuntime
    ? '<p class="auth-setup">O serviço de contas ainda precisa ser conectado ao projeto Firebase. Consulte <strong>FIREBASE_SETUP.md</strong> para ativar o login e a sincronização.</p>'
    : '';
  return `<section class="auth-layout"><div class="auth-copy"><div class="eyebrow">Kartou! na pista</div><h1 class="auth-title">Seus eventos.<br>Em qualquer dispositivo.</h1><p>Entre para manter eventos, pilotos, karts e resultados sincronizados na sua conta.</p></div><div class="auth-card"><div class="auth-switch"><button class="tab ${!creating?'active':''}" data-auth-mode="login">Entrar</button><button class="tab ${creating?'active':''}" data-auth-mode="signup">Criar conta</button></div><h2>${creating?'Crie sua conta':'Bem-vindo de volta'}</h2><p class="auth-subtitle">${creating?'Use seu e-mail para começar.':'Acesse seus eventos e sorteios salvos.'}</p>${setupMessage}<form id="authForm" class="form-stack"><label><span class="input-label">E-mail</span><input class="input" name="email" type="email" autocomplete="email" required placeholder="voce@email.com"></label><label><span class="input-label">Senha</span><input class="input" name="password" type="password" autocomplete="${creating?'new-password':'current-password'}" minlength="6" required placeholder="Mínimo de 6 caracteres"></label>${creating?'<label><span class="input-label">Confirmar senha</span><input class="input" name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required placeholder="Digite a senha novamente"></label>':''}<button class="btn btn-primary btn-wide" type="submit">${creating?'Criar conta':'Entrar com e-mail'}</button></form>${!creating?'<button class="link-button auth-forgot" data-auth-action="reset-password">Esqueci minha senha</button>':''}<div class="auth-divider"><span>ou</span></div><button class="btn btn-secondary btn-wide auth-google" data-auth-action="google"><span aria-hidden="true">G</span> Continuar com Google</button><p class="auth-feedback" id="authFeedback" role="status" aria-live="polite"></p>${!creating?'<div class="guest-access"><span>Prefere salvar apenas neste aparelho?</span><button class="link-button" data-auth-action="guest-confirm">Continuar sem conta</button></div>':''}</div></section>`;
}
function render() {
  const main = document.querySelector('#main');
  const badge = document.querySelector('#accountBadge');
  const resetButton = document.querySelector('#resetDemo');
  const signOutButton = document.querySelector('#signOut');
  if (!authReady) { main.innerHTML = '<section class="auth-loading">Conectando ao Kartou!…</section>'; return; }
  if (localMode) {
    badge.hidden = false; badge.innerHTML = '<i></i> Salvo neste dispositivo';
    resetButton.hidden = false; signOutButton.hidden = false;
    resetButton.title = 'Apagar os dados salvos neste dispositivo';
    currentEventId && !getEvent() ? currentEventId = null : null;
    main.innerHTML = currentEventId ? renderEvent() : renderEvents();
    return;
  }
  if (!currentUser) {
    badge.hidden = true; resetButton.hidden = true; signOutButton.hidden = true;
    main.innerHTML = renderAuth();
    return;
  }
  badge.hidden = false; badge.innerHTML = `<i></i> ${escapeHTML(currentUser.email || 'Conta conectada')}`;
  resetButton.hidden = false; signOutButton.hidden = false;
  resetButton.title = 'Apagar os dados desta conta';
  if (cloudLoadError) {
    main.innerHTML = '<section class="auth-loading"><h2>Não foi possível carregar seus dados</h2><p>Confira a conexão e as regras do Firestore antes de continuar.</p><button class="btn btn-primary" data-auth-action="retry-cloud">Tentar novamente</button> <button class="btn btn-secondary" data-auth-action="signout">Sair</button></section>';
    return;
  }
  currentEventId && !getEvent() ? currentEventId = null : null;
  main.innerHTML = currentEventId ? renderEvent() : renderEvents();
}
function setAuthFeedback(message, isError = false) {
  const feedback = document.querySelector('#authFeedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle('error', isError);
}
function authErrorMessage(error) {
  const messages = {
    'auth/email-already-in-use': 'Este e-mail já possui uma conta.',
    'auth/invalid-email': 'Informe um endereço de e-mail válido.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'Não encontramos uma conta com esse e-mail.',
    'auth/weak-password': 'Escolha uma senha mais forte.',
    'auth/popup-closed-by-user': 'A janela de login do Google foi fechada.',
    'auth/unauthorized-domain': 'Este domínio precisa ser autorizado no Firebase Authentication.',
    'auth/network-request-failed': 'Falha de conexão. Verifique sua internet e tente novamente.'
  };
  return messages[error.code] || 'Não foi possível concluir. Confira a configuração do Firebase e tente novamente.';
}
async function initializeAuth() {
  const config = window.KARTOU_FIREBASE_CONFIG;
  if (!config || !config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    authReady = true; render(); return;
  }
  try {
    const version = '13.4.0';
    const [appSdk, authSdk, firestore] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`)
    ]);
    const app = appSdk.initializeApp(config);
    const auth = authSdk.getAuth(app);
    const db = firestore.getFirestore(app);
    const googleProvider = new authSdk.GoogleAuthProvider();
    firebaseRuntime = { appSdk, authSdk, firestore, auth, db, googleProvider };
    authSdk.onAuthStateChanged(auth, async user => {
      currentUser = user;
      if (user) localMode = false;
      currentEventId = null; draftResult = null;
      if (!user) { state = { events: [] }; cloudLoadError = false; authReady = true; render(); return; }
      authReady = false; render();
      try {
        const snapshot = await firestore.getDoc(firestore.doc(db, 'users', user.uid, 'kartou', 'data'));
        const data = snapshot.exists() ? snapshot.data() : null;
        if (data && Array.isArray(data.events)) {
          state = { events: data.events };
        } else {
          const legacy = loadLegacyState();
          const migrate = legacy.events.length > 0 && window.confirm(`Encontramos ${legacy.events.length} evento(s) salvo(s) somente neste navegador. Deseja importar esses dados para a conta ${user.email || ''} e sincronizá-los entre dispositivos?`);
          state = migrate ? legacy : { events: [] };
          if (migrate) {
            await firestore.setDoc(firestore.doc(db, 'users', user.uid, 'kartou', 'data'), { events: state.events, updatedAt: firestore.serverTimestamp() });
            localStorage.removeItem('kartou-v1');
          }
        }
        cloudLoadError = false;
      } catch (error) {
        console.error('Falha ao carregar os dados da conta.', error);
        state = { events: [] }; cloudLoadError = true;
      }
      authReady = true; render();
      if (cloudLoadError) notify('Não foi possível carregar os dados. Confira as regras do Firestore.');
    });
  } catch (error) {
    console.error('Falha ao iniciar Firebase.', error);
    authReady = true; render();
  }
}
function loadLegacyState() {
  try {
    const saved = JSON.parse(localStorage.getItem('kartou-v1'));
    if (saved && Array.isArray(saved.events)) return saved;
  } catch (error) { console.warn('Não foi possível ler os dados locais antigos.', error); }
  return { events: [] };
}
async function handleAuthSubmit(form) {
  if (!firebaseRuntime) { setAuthFeedback('Conecte o projeto Firebase para ativar o login. Consulte FIREBASE_SETUP.md.', true); return; }
  const values = new FormData(form);
  const email = String(values.get('email') || '').trim();
  const password = String(values.get('password') || '');
  const button = form.querySelector('[type="submit"]');
  button.disabled = true; setAuthFeedback('Conectando…');
  try {
    if (authMode === 'signup') {
      if (password !== values.get('confirmPassword')) throw new Error('As senhas não coincidem.');
      await firebaseRuntime.authSdk.createUserWithEmailAndPassword(firebaseRuntime.auth, email, password);
    } else {
      await firebaseRuntime.authSdk.signInWithEmailAndPassword(firebaseRuntime.auth, email, password);
    }
  } catch (error) {
    setAuthFeedback(error.message.startsWith('As senhas') ? error.message : authErrorMessage(error), true);
    button.disabled = false;
  }
}
async function signInWithGoogle() {
  if (!firebaseRuntime) { setAuthFeedback('Conecte o projeto Firebase para ativar o login. Consulte FIREBASE_SETUP.md.', true); return; }
  try { await firebaseRuntime.authSdk.signInWithPopup(firebaseRuntime.auth, firebaseRuntime.googleProvider); }
  catch (error) { setAuthFeedback(authErrorMessage(error), true); }
}
function renderEvents() {
  const cards = state.events.map(event => `<article class="event-card"><div class="event-icon">🏁</div><div class="event-info" data-open="${event.id}" role="button" tabindex="0"><h3>${escapeHTML(event.name)}</h3><div class="event-meta"><span>▦ ${formatDate(event.date)}</span><span>⌖ ${escapeHTML(event.location || 'Local não informado')}</span><span>♟ ${event.pilots.length} pilotos</span></div></div><div class="event-actions"><button class="icon-btn" title="Abrir evento" data-open="${event.id}">›</button><button class="icon-btn" title="Excluir evento" data-delete-event="${event.id}">⌫</button></div></article>`).join('');
  return `<div class="page-heading"><div><div class="eyebrow">Organização de baterias</div><h1>Meus eventos</h1><p>Seus campeonatos, pilotos e sorteios em um só lugar.</p></div><button class="btn btn-primary" data-action="new-event">＋ Novo evento</button></div>${cards ? `<section class="event-list">${cards}</section>` : `<section class="empty-state"><div class="empty-flag">🏁</div><h2>Comece pelo próximo evento</h2><p>Cadastre uma bateria para organizar os pilotos e sortear os karts com transparência.</p><button class="btn btn-primary" data-action="new-event">＋ Criar meu primeiro evento</button></section>`}`;
}
function renderTabs() { return `<nav class="tabs" aria-label="Seções do evento">${[['pilots','Pilotos'],['karts','Karts'],['draw','Sorteio'],['history','Histórico']].map(([key,label]) => `<button class="tab ${activeTab===key?'active':''}" data-tab="${key}">${label}</button>`).join('')}</nav>`; }
function renderEvent() {
  const event = getEvent(); if (!event) return '';
  const body = activeTab === 'pilots' ? renderPilots(event) : activeTab === 'karts' ? renderKarts(event) : activeTab === 'draw' ? renderDraw(event) : renderHistory(event);
  return `<div class="breadcrumb" data-action="back">← Todos os eventos</div><div class="event-head"><div class="event-title-wrap"><div class="eyebrow">${escapeHTML(event.location || 'Evento de kart')}</div><h1 class="event-title">${escapeHTML(event.name)}</h1><p>${formatDate(event.date)} · ${event.pilots.length} pilotos · ${event.karts.length} karts</p></div><button class="btn btn-secondary" data-action="edit-event">✎ Editar evento</button></div>${renderTabs()}${body}`;
}
function renderPilots(event) {
 const rows=event.pilots.map((name,i)=>`<div class="list-row"><span class="row-name">${escapeHTML(name)}</span><div class="row-actions"><button class="small-btn" title="Editar piloto" data-edit-pilot="${i}">✎</button><button class="small-btn remove" title="Remover piloto" data-remove-pilot="${i}">⌫</button></div></div>`).join('');
 return `<section class="panel"><div class="panel-head"><h2 class="section-title">Pilotos <span class="count">(${event.pilots.length})</span></h2><span class="muted" style="font-size:12px">Lista da bateria</span></div><form class="toolbar" id="addPilotForm"><div class="input-row"><input class="input" name="name" placeholder="Nome do piloto" autocomplete="off" required><button class="btn btn-primary">＋ Piloto</button></div></form><div class="utility-row"><button class="btn btn-ghost" data-action="import-pilots">⇧ Importar lista de pilotos</button><span class="hint">Cole ou importe nomes separados por linha.</span></div><div class="list">${rows||'<div class="empty-list">Nenhum piloto cadastrado ainda.</div>'}</div></section>`;
}
function renderKarts(event) {
 const rows=event.karts.map((name,i)=>`<div class="list-row"><span class="row-name">${escapeHTML(name)}</span><div class="row-actions"><button class="small-btn" title="Editar kart" data-edit-kart="${i}">✎</button><button class="small-btn remove" title="Remover kart" data-remove-kart="${i}">⌫</button></div></div>`).join('');
 return `<section class="panel"><div class="panel-head"><h2 class="section-title">Karts <span class="count">(${event.karts.length})</span></h2></div><form class="toolbar" id="addKartForm"><div class="input-row"><input class="input" name="name" placeholder="Ex.: Kart 01" autocomplete="off" required><button class="btn btn-primary">＋ Kart</button></div></form><div class="utility-row"><button class="btn btn-ghost" data-action="import-karts">⇧ Importar lista de karts</button><input class="input" id="kartQuantity" type="number" min="1" max="200" value="10" aria-label="Quantidade de karts"><button class="btn btn-ghost" data-action="generate-karts">⚡ Gerar sequência</button><span class="hint">Ex.: Kart 01, Kart 02…</span></div><div class="list">${rows||'<div class="empty-list">Nenhum kart cadastrado ainda.</div>'}</div></section>`;
}
function resultRows(result) { return `<div class="draw-result list">${result.assignments.map((item,i)=>`<div class="draw-row"><span class="draw-number">${String(i+1).padStart(2,'0')}</span><span class="draw-driver">${escapeHTML(item.pilot)}</span><span class="draw-kart">${escapeHTML(item.kart)}</span></div>`).join('')}</div>`; }
function renderDraw(event) {
 const result=draftResult;
 return `<section class="panel"><div class="draw-summary"><strong>${result ? `Bateria ${event.history.length+1}` : 'Pronto para sortear'}</strong><div class="draw-stats">Pilotos: <b>${event.pilots.length}</b> · Karts disponíveis: <b>${event.karts.length}</b></div></div><button class="btn btn-primary btn-wide" data-action="draw" ${event.pilots.length===0||event.karts.length<event.pilots.length?'disabled':''}>⤨ ${result?'Sortear novamente':'Sortear karts'}</button>${event.pilots.length===0||event.karts.length<event.pilots.length?`<p class="hint" style="text-align:center;margin:14px 0 0">${event.pilots.length===0?'Adicione pilotos para liberar o sorteio.':`Cadastre ao menos ${event.pilots.length} karts para esta bateria.`}</p>`:''}</section>${result?`<section class="panel" style="margin-top:14px"><div class="panel-head"><h2 class="section-title">Resultado da bateria</h2><span class="muted" style="font-size:11px">Ainda não salvo</span></div>${resultRows(result)}<div class="result-toolbar"><button class="btn btn-primary" data-action="save-result">▣ Salvar resultado</button><button class="btn btn-secondary" data-action="pdf">▤ Exportar PDF</button><button class="btn btn-secondary" data-action="whatsapp">◉ WhatsApp</button></div></section>`:''}`;
}
function renderHistory(event) {
 const cards=[...event.history].reverse().map(result=>`<section class="panel saved-card"><div class="saved-head"><div><strong>Bateria ${result.number}</strong><div class="saved-date">${new Date(result.createdAt).toLocaleString('pt-BR')}</div></div><div class="history-actions"><button class="btn btn-secondary history-action" title="Exportar PDF" data-history-pdf="${result.id}">▤ PDF</button><button class="btn btn-secondary history-action" title="Compartilhar no WhatsApp" data-history-share="${result.id}">◉ WhatsApp</button><button class="small-btn remove" title="Excluir resultado" aria-label="Excluir resultado" data-history-delete="${result.id}">⌫</button></div></div>${resultRows(result)}</section>`).join('');
 return `<section class="panel"><div class="panel-head"><h2 class="section-title">Sorteios salvos <span class="count">(${event.history.length})</span></h2></div>${cards||'<div class="empty-list">Os sorteios salvos aparecerão aqui.</div>'}</section>`;
}
function eventForm(event=null) { setModal(`<h2 class="modal-title">${event?'Editar evento':'Novo evento'}</h2><p class="modal-desc">Informe os dados da bateria. Você pode ajustar tudo depois.</p><div class="form-stack"><label><span class="input-label">Nome do evento *</span><input class="input" name="name" required maxlength="70" placeholder="Ex.: Copa Sanja" value="${escapeHTML(event?.name||'')}"></label><div class="form-grid"><label><span class="input-label">Data</span><input class="input" name="date" type="date" value="${escapeHTML(event?.date||'')}"></label><label><span class="input-label">Pista / local</span><input class="input" name="location" maxlength="90" placeholder="Ex.: Kart Center" value="${escapeHTML(event?.location||'')}"></label></div></div><div class="modal-actions"><button class="btn btn-ghost" type="button" data-modal-close>Cancelar</button><button class="btn btn-primary" id="saveEvent">${event?'Salvar alterações':'Criar evento'}</button></div>`); document.querySelector('#saveEvent').onclick=e=>{e.preventDefault();const f=document.querySelector('#modalForm');if(!f.reportValidity())return;const data=new FormData(f);if(event){event.name=data.get('name').trim();event.date=data.get('date');event.location=data.get('location').trim();}else{const fresh={id:uid(),name:data.get('name').trim(),date:data.get('date'),location:data.get('location').trim(),pilots:[],karts:[],history:[]};state.events.unshift(fresh);currentEventId=fresh.id;activeTab='pilots';}persist();closeModal();render();}; }
function confirmDelete(title,message,onConfirm) { setModal(`<h2 class="modal-title">${title}</h2><p class="modal-desc">${message}</p><div class="modal-actions"><button class="btn btn-ghost" type="button" data-modal-close>Cancelar</button><button class="btn btn-danger" id="confirmDelete">Excluir</button></div>`);document.querySelector('#confirmDelete').onclick=e=>{e.preventDefault();onConfirm();closeModal();}; }
function importList(type) { const label=type==='pilots'?'pilotos':'karts'; setModal(`<h2 class="modal-title">Importar ${label}</h2><p class="modal-desc">Cole uma lista de ${label} — um por linha. Linhas repetidas serão ignoradas.</p><textarea class="input" name="bulk" rows="9" placeholder="${type==='pilots'?'João Silva\nPedro Santos\nLucas Oliveira':'Kart 01\nKart 02\nKart 03'}"></textarea><div class="modal-actions"><button class="btn btn-ghost" type="button" data-modal-close>Cancelar</button><button class="btn btn-primary" id="importList">Importar lista</button></div>`);document.querySelector('#importList').onclick=e=>{e.preventDefault();const field=document.querySelector('#modalForm textarea');const target=type==='pilots'?getEvent().pilots:getEvent().karts;const added=addUnique(target,field.value.split(/\r?\n/));persist();closeModal();render();notify(`${added} ${label} adicionados`);}; }
function addUnique(target,items) {const seen=new Set(target.map(v=>v.toLocaleLowerCase('pt-BR')));let added=0;for(const item of items){const value=item.trim();const key=value.toLocaleLowerCase('pt-BR');if(value&&!seen.has(key)){target.push(value);seen.add(key);added++;}}return added;}
function editEntry(type,index) { const event=getEvent();const list=type==='pilot'?event.pilots:event.karts;const label=type==='pilot'?'piloto':'kart';setModal(`<h2 class="modal-title">Editar ${label}</h2><p class="modal-desc">Atualize o nome que será exibido no sorteio.</p><label><span class="input-label">Nome</span><input class="input" name="name" value="${escapeHTML(list[index])}" required maxlength="70"></label><div class="modal-actions"><button class="btn btn-ghost" type="button" data-modal-close>Cancelar</button><button class="btn btn-primary" id="saveEntry">Salvar</button></div>`);document.querySelector('#saveEntry').onclick=e=>{e.preventDefault();const f=document.querySelector('#modalForm');if(!f.reportValidity())return;const value=new FormData(f).get('name').trim();if(list.some((x,i)=>i!==index&&x.toLocaleLowerCase('pt-BR')===value.toLocaleLowerCase('pt-BR'))){notify('Esse nome já está na lista.');return;}list[index]=value;persist();closeModal();render();}; }
function normalizeAndSave() { persist();render(); }
function performDraw() { const event=getEvent();if(event.pilots.length>event.karts.length)return;const shuffled=[...event.karts];for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}draftResult={id:uid(),number:event.history.length+1,createdAt:new Date().toISOString(),assignments:event.pilots.map((pilot,i)=>({pilot,kart:shuffled[i]}))};render(); }
function resultText(result,event) {return `🏁 ${event.name} — Bateria ${result.number}\n${result.assignments.map((item,i)=>`${i+1}. ${item.pilot} — ${item.kart}`).join('\n')}\n\nSorteio organizado com Kartou!`;}
function shareResult(result,event) {const url=`https://wa.me/?text=${encodeURIComponent(resultText(result,event))}`;window.open(url,'_blank','noopener,noreferrer');}
function exportPDF(result,event) {const rows=result.assignments.map((item,i)=>`<tr><td>${i+1}</td><td>${escapeHTML(item.pilot)}</td><td>${escapeHTML(item.kart)}</td></tr>`).join('');const doc=`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(event.name)} — Bateria ${result.number}</title><style>body{font:15px Arial;color:#111;margin:48px}h1{font-size:26px;margin-bottom:5px}p{color:#555;margin-top:0}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{text-align:left;border-bottom:1px solid #ddd;padding:12px}th{background:#f4f4f4}footer{margin-top:34px;color:#777;font-size:12px}</style></head><body><h1>${escapeHTML(event.name)} — Bateria ${result.number}</h1><p>${new Date(result.createdAt).toLocaleString('pt-BR')}</p><table><thead><tr><th>#</th><th>Piloto</th><th>Kart</th></tr></thead><tbody>${rows}</tbody></table><footer>Sorteio organizado com Kartou!</footer><script>window.onload=()=>window.print()<\/script></body></html>`;const w=window.open('','_blank');if(!w){notify('Permita pop-ups para exportar em PDF.');return;}w.document.write(doc);w.document.close();}
document.addEventListener('click',event=>{
 const target=event.target.closest('button,[data-open],[data-action],[data-tab],[data-auth-mode],[data-auth-action],[data-edit-pilot],[data-edit-kart],[data-remove-pilot],[data-remove-kart],[data-history-pdf],[data-history-share],[data-history-delete]');if(!target)return;
 if(target.dataset.authMode){authMode=target.dataset.authMode;render();return;}
 if(target.dataset.authAction==='google'){signInWithGoogle();return;}
 if(target.dataset.authAction==='guest-confirm'){setModal('<h2 class="modal-title">Continuar sem conta?</h2><p class="modal-desc">Seus eventos, pilotos, karts e resultados serão salvos somente neste dispositivo. Para acessar seus dados em outros aparelhos, crie uma conta ou entre nela.</p><div class="modal-actions"><button class="btn btn-ghost" type="button" data-modal-close>Voltar</button><button class="btn btn-primary" type="button" data-auth-action="guest-enter">Continuar sem conta</button></div>');return;}
 if(target.dataset.authAction==='guest-enter'){state=loadLegacyState();currentUser=null;localMode=true;currentEventId=null;draftResult=null;closeModal();render();return;}
 if(target.dataset.authAction==='signout'){firebaseRuntime?.authSdk.signOut(firebaseRuntime.auth);return;}
 if(target.dataset.authAction==='retry-cloud'&&currentUser){cloudLoadError=false;authReady=false;render();firebaseRuntime.firestore.getDoc(firebaseRuntime.firestore.doc(firebaseRuntime.db,'users',currentUser.uid,'kartou','data')).then(snapshot=>{const data=snapshot.exists()?snapshot.data():null;state={events:Array.isArray(data?.events)?data.events:[]};cloudLoadError=false;authReady=true;render();}).catch(error=>{console.error('Falha ao carregar os dados da conta.',error);cloudLoadError=true;authReady=true;render();});return;}
 if(target.dataset.authAction==='reset-password'){
  const email=document.querySelector('#authForm [name="email"]')?.value.trim();
  if(!email){setAuthFeedback('Digite seu e-mail para receber o link de recuperação.',true);document.querySelector('#authForm [name="email"]')?.focus();return;}
  if(!firebaseRuntime){setAuthFeedback('Conecte o projeto Firebase para ativar a recuperação de senha.',true);return;}
  firebaseRuntime.authSdk.sendPasswordResetEmail(firebaseRuntime.auth,email).then(()=>setAuthFeedback('Enviamos um link de recuperação para seu e-mail.')).catch(error=>setAuthFeedback(authErrorMessage(error),true));
  return;
 }
 if(target.dataset.open){currentEventId=target.dataset.open;draftResult=null;activeTab='pilots';render();return;}
 if(target.dataset.tab){activeTab=target.dataset.tab;if(activeTab!=='draw')draftResult=null;render();return;}
 if(target.dataset.action){const action=target.dataset.action;const eventData=getEvent();if(action==='new-event')eventForm();if(action==='edit-event')eventForm(eventData);if(action==='back'){currentEventId=null;draftResult=null;render();}if(action==='import-pilots')importList('pilots');if(action==='import-karts')importList('karts');if(action==='generate-karts'){const input=document.querySelector('#kartQuantity');const amount=Math.min(200,Math.max(1,Number(input.value)||1));const width=Math.max(2,String(amount).length);const added=addUnique(eventData.karts,Array.from({length:amount},(_,i)=>`Kart ${String(i+1).padStart(width,'0')}`));normalizeAndSave();notify(`${added} karts adicionados`);}if(action==='draw')performDraw();if(action==='save-result'&&draftResult){const saved={...draftResult,number:eventData.history.length+1};eventData.history.push(saved);draftResult=saved;persist();activeTab='history';render();notify('Resultado salvo no histórico');}if(action==='pdf'&&draftResult)exportPDF(draftResult,eventData);if(action==='whatsapp'&&draftResult)shareResult(draftResult,eventData);return;}
 if(target.dataset.editPilot!==undefined){editEntry('pilot',Number(target.dataset.editPilot));return;}if(target.dataset.editKart!==undefined){editEntry('kart',Number(target.dataset.editKart));return;}
 if(target.dataset.removePilot!==undefined){const i=Number(target.dataset.removePilot);confirmDelete('Remover piloto?',`“${escapeHTML(getEvent().pilots[i])}” será removido desta lista.`,()=>{getEvent().pilots.splice(i,1);normalizeAndSave();});return;}
 if(target.dataset.removeKart!==undefined){const i=Number(target.dataset.removeKart);confirmDelete('Remover kart?',`“${escapeHTML(getEvent().karts[i])}” será removido desta lista.`,()=>{getEvent().karts.splice(i,1);normalizeAndSave();});return;}
 if(target.dataset.deleteEvent){const item=state.events.find(x=>x.id===target.dataset.deleteEvent);confirmDelete('Excluir evento?',`“${escapeHTML(item.name)}” e seu histórico serão removidos deste navegador.`,()=>{state.events=state.events.filter(x=>x.id!==item.id);persist();render();});return;}
 if(target.dataset.historyPdf||target.dataset.historyShare||target.dataset.historyDelete){const result=getEvent().history.find(x=>x.id===target.dataset.historyPdf||x.id===target.dataset.historyShare||x.id===target.dataset.historyDelete);if(target.dataset.historyPdf)exportPDF(result,getEvent());if(target.dataset.historyShare)shareResult(result,getEvent());if(target.dataset.historyDelete)confirmDelete('Excluir resultado?',`O resultado da bateria ${result.number} será removido do histórico.`,()=>{getEvent().history=getEvent().history.filter(x=>x.id!==result.id);persist();render();});}
});
document.addEventListener('submit',event=>{const form=event.target;if(form.id==='authForm'){event.preventDefault();handleAuthSubmit(form);return;}if(form.id!=='addPilotForm'&&form.id!=='addKartForm')return;event.preventDefault();const type=form.id==='addPilotForm'?'pilots':'karts';const input=form.elements.name;const value=input.value.trim();const list=getEvent()[type];if(list.some(x=>x.toLocaleLowerCase('pt-BR')===value.toLocaleLowerCase('pt-BR'))){notify('Esse nome já está cadastrado.');return;}list.push(value);persist();render();notify(type==='pilots'?'Piloto adicionado':'Kart adicionado');});
document.querySelector('#resetDemo').addEventListener('click',()=>{const local=localMode;confirmDelete(local?'Apagar dados deste dispositivo?':'Apagar dados desta conta?',local?'Todos os eventos, pilotos, karts e históricos salvos neste dispositivo serão apagados.':'Todos os eventos, pilotos, karts e históricos salvos na sua conta serão apagados.',()=>{state.events=[];persist();currentEventId=null;draftResult=null;render();notify(local?'Dados locais apagados':'Dados da conta apagados');});});
document.querySelector('#signOut').addEventListener('click',()=>{if(localMode){localMode=false;state={events:[]};currentEventId=null;draftResult=null;render();return;}firebaseRuntime?.authSdk.signOut(firebaseRuntime.auth);});
document.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('[data-open]'))event.target.click();});
initializeAuth();
