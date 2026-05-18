// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
let GROQ_KEY='', USER={name:'',level:'intermediate',goal:'fluent daily conversation',nativeLang:'',interests:['daily life & culture'],topic:'free conversation'};


// ── Global crash protection ──
window.onerror = function(msg, src, line, col, err) {
  console.error('[ARIA] Uncaught error:', msg, 'at', src+':'+line);
  return false; // don't suppress
};
window.addEventListener('unhandledrejection', function(e) {
  console.error('[ARIA] Unhandled promise rejection:', e.reason);
  e.preventDefault();
});

// Safe DOM getter — never throws
function $id(id){return document.getElementById(id);}
function setText(id,val){const el=$id(id);if(el)el.textContent=val;}
function setStyle(id,prop,val){const el=$id(id);if(el)el.style[prop]=val;}
let SESSION={turns:0,fixes:0,words:0,history:[],feedbackLog:[],fluencyHistory:[],vocabTaught:[],corrections:[]};
let MEMORY={weakAreas:{grammar:3,pronunciation:2,vocabulary:1},totalSessions:0,totalTurns:0,ariaObservations:[]};
let QUIZ_STATE={questions:[],current:0,score:0,answered:false,status:'idle',id:null,startedAt:null};
let ACTIVE_ACTIVITY={type:null,status:'idle',snapshot:null,updatedAt:0};
let activeCall={id:null,mode:null,status:'idle',startedAt:null,connectedAt:null,endedAt:null,reason:null};
const CALL_STORAGE_KEY='aria_active_call';
const ACTIVITY_STORAGE_KEY='aria_active_activity';
const OBSERVABILITY={errors:[],latencies:[],lastRealtimeState:'idle'};

// Mic state: idle | listening | thinking | speaking | muted | stopped
let appState='stopped', isMuted=false;
let mediaStream=null, audioContext=null, analyser=null;
let silenceTimer=null, speechStarted=false, speechStartTime=0;
let lastSpeechDurationMs=0;
let audioChunks=[], mediaRecorder=null, vadActive=false;
let ttsQueue=[], ttsBusy=false;
let vadRafHandle=null;

function escapeHTML(str){if(str===null||str===undefined)return '';return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
function sanitizeHTML(html){
  const tpl=document.createElement('template');
  tpl.innerHTML=String(html||'');
  tpl.content.querySelectorAll('script,iframe,object,embed,link[rel="import"]').forEach(n=>n.remove());
  tpl.content.querySelectorAll('*').forEach(node=>{
    [...node.attributes].forEach(attr=>{
      const name=attr.name.toLowerCase(), val=attr.value||'';
      if(name.startsWith('on')||/javascript:/i.test(val))node.removeAttribute(attr.name);
    });
  });
  return tpl.innerHTML;
}
function setHTML(id,val){const el=$id(id);if(el)el.innerHTML=sanitizeHTML(val);}
function safeSetInnerHTML(el,val){if(el)el.innerHTML=sanitizeHTML(val);}

function reportError(scope,error,extra){
  const item={scope,message:error?.message||String(error||'Unknown error'),extra:extra||null,at:new Date().toISOString()};
  OBSERVABILITY.errors.unshift(item);
  if(OBSERVABILITY.errors.length>30)OBSERVABILITY.errors.pop();
  console.warn('[ARIA]',scope,item.message,extra||'');
}

function updateActiveCall(patch){
  activeCall={...activeCall,...patch};
  if(activeCall.status==='active'||activeCall.status==='connecting'||activeCall.status==='connected'){
    activeCall.updatedAt=Date.now();
    try{localStorage.setItem(CALL_STORAGE_KEY,JSON.stringify(activeCall));}catch(e){}
  }else{
    try{localStorage.removeItem(CALL_STORAGE_KEY);}catch(e){}
  }
  renderCallState();
}

function renderCallState(){
  const hasLiveCall=!!(activeCall.id&&(activeCall.status==='active'||activeCall.status==='connecting'||activeCall.status==='connected')&&localStream);
  document.querySelectorAll('.call-end-btn').forEach(btn=>btn.classList.toggle('visible',hasLiveCall));
  const status=$id('peerStatus');
  if(status&&activeCall.reason&&!hasLiveCall)status.textContent=activeCall.reason;
}

function restoreCallState(){
  try{
    const saved=safeJSONParse(localStorage.getItem(CALL_STORAGE_KEY),null);
    if(saved&&saved.id){
      activeCall={...activeCall,...saved,status:'ended',reason:'Previous call ended when this page refreshed.'};
      localStorage.removeItem(CALL_STORAGE_KEY);
    }
  }catch(e){}
  renderCallState();
}

function cleanupMediaStream(stream){
  if(!stream)return;
  try{stream.getTracks().forEach(track=>{try{track.stop();}catch(e){}});}catch(e){}
}

function persistActivity(){
  ACTIVE_ACTIVITY.updatedAt=Date.now();
  try{localStorage.setItem(ACTIVITY_STORAGE_KEY,JSON.stringify(ACTIVE_ACTIVITY));}catch(e){}
  renderActivityBar();
}

function startActivity(type,snapshot){
  ACTIVE_ACTIVITY={type,status:'active',snapshot:snapshot||null,updatedAt:Date.now()};
  persistActivity();
}

function snapshotCurrentActivity(){
  if(ACTIVE_ACTIVITY.type==='grammar')return {quiz:QUIZ_STATE};
  if(ACTIVE_ACTIVITY.type==='speed')return {speed:speedState};
  if(ACTIVE_ACTIVITY.type==='fill')return {fill:fillState};
  if(ACTIVE_ACTIVITY.type==='idiom')return {idiom:idiomChalState};
  if(ACTIVE_ACTIVITY.type==='compete')return {competeRoom,currentCompeteMode};
  return ACTIVE_ACTIVITY.snapshot;
}

function renderActivityBar(){
  const bar=$id('quizActivityBar');
  if(!bar)return;
  const active=ACTIVE_ACTIVITY.status==='active'||ACTIVE_ACTIVITY.status==='paused';
  bar.style.display=active?'flex':'none';
  setText('quizActivityLabel',(ACTIVE_ACTIVITY.status==='paused'?'Paused ':'Active ')+(ACTIVE_ACTIVITY.type||'activity'));
  const resume=$id('resumeActivityBtn');
  if(resume)resume.style.display=ACTIVE_ACTIVITY.status==='paused'?'inline-flex':'none';
}

function requestActivityCancel(type){
  if(type&&(!ACTIVE_ACTIVITY.type||ACTIVE_ACTIVITY.status==='idle'))ACTIVE_ACTIVITY={type,status:'active',snapshot:null,updatedAt:Date.now()};
  ACTIVE_ACTIVITY.snapshot=snapshotCurrentActivity();
  const modal=$id('activityCancelModal');
  if(modal)modal.classList.add('show');
}
function closeActivityCancel(){const modal=$id('activityCancelModal');if(modal)modal.classList.remove('show');}
function pauseActivity(){
  ACTIVE_ACTIVITY.snapshot=snapshotCurrentActivity();
  ACTIVE_ACTIVITY.status='paused';
  persistActivity();
  closeActivityCancel();
  hideActiveChallengeSurfaces();
  setText('quizSub','Progress saved. Resume when you are ready.');
}
function cancelActivityConfirmed(){
  const type=ACTIVE_ACTIVITY.type;
  cleanupActivity(type||'all');
  ACTIVE_ACTIVITY={type:null,status:'idle',snapshot:null,updatedAt:Date.now()};
  try{localStorage.removeItem(ACTIVITY_STORAGE_KEY);}catch(e){}
  closeActivityCancel();
  renderActivityBar();
  setText('quizSub','Choose a challenge mode to begin.');
}
function resumeActivity(){
  if(ACTIVE_ACTIVITY.status!=='paused')return;
  const type=ACTIVE_ACTIVITY.type, snap=ACTIVE_ACTIVITY.snapshot||{};
  ACTIVE_ACTIVITY.status='active';
  persistActivity();
  if(type==='grammar'&&snap.quiz){QUIZ_STATE=snap.quiz;goScreen('screenQuiz');renderQuizQuestion();}
  else if(type==='speed')startSpeedChallenge(snap.speed);
  else if(type==='fill')startFillBlank(snap.fill);
  else if(type==='idiom')startIdiomChallenge(snap.idiom);
}
function hideActiveChallengeSurfaces(){
  ['speedChallenge','fillBlank','idiomChallenge'].forEach(id=>{const el=$id(id);if(el)el.classList.remove('active');});
  const qb=$id('quizBody');if(qb)qb.innerHTML='';
  const qr=$id('quizResult');if(qr)qr.classList.remove('show');
}
function cleanupActivity(type){
  if(type==='speed'||type==='all'){clearInterval(speedState.timer);clearTimeout(speedState.ariaTimer);speedState.timer=null;speedState.ariaTimer=null;}
  if(type==='compete'||type==='all'){clearTimerKey('room-poll');clearTimerKey('compete-friend-answer');clearTimerKey('compete-next-question');roomPollTimer=null;}
  if(type==='grammar'||type==='all')QUIZ_STATE={questions:[],current:0,score:0,answered:false,status:'idle',id:null,startedAt:null};
  hideActiveChallengeSurfaces();
}

function recordLearningSignal(kind,payload){
  const signal={kind,payload,at:new Date().toISOString(),userId:USER.userId||USER.name||'local'};
  try{
    const key='aria_learning_signals_'+(USER.name||'guest');
    const signals=safeJSONParse(localStorage.getItem(key),[]);
    signals.unshift(signal);
    localStorage.setItem(key,JSON.stringify(signals.slice(0,100)));
  }catch(e){}
  syncSupabaseSignal(signal);
}

async function syncSupabaseSignal(signal){
  try{
    if(!window.supabase||!window.ARIA_SUPABASE)return;
    const client=window.supabase.createClient(window.ARIA_SUPABASE.url,window.ARIA_SUPABASE.anonKey);
    await client.from('aria_learning_signals').insert(signal);
  }catch(e){reportError('supabase-sync',e,{kind:signal.kind});}
}

// ══════════════════════════════════════════════
// ONBOARDING & NAVIGATION
// ══════════════════════════════════════════════
function setLevel(el,v){
  // Works for both .seg/.seg-opt (profile) and .al-seg/.al-seg-opt (login)
  const parent=el.closest('.seg,.al-seg');
  if(parent) parent.querySelectorAll('.seg-opt,.al-seg-opt').forEach(b=>b.classList.remove('on'));
  el.classList.add('on');
  USER.level=v;
}
function setGoal(el,v){el.closest('.seg').querySelectorAll('.seg-opt').forEach(b=>b.classList.remove('on'));el.classList.add('on');USER.goal=v}
function setTopic(el,v){el.closest('.seg').querySelectorAll('.seg-opt').forEach(b=>b.classList.remove('on'));el.classList.add('on');USER.topic=v}
function togInterest(el,v){el.classList.toggle('on');const idx=USER.interests.indexOf(v);if(idx>-1)USER.interests.splice(idx,1);else USER.interests.push(v)}
function toggleQuickInterest(el,v){
  const val=(v||'').replace(/&amp;/g,'&');
  el.classList.toggle('on');
  const idx=USER.interests.indexOf(val);
  if(idx>-1) USER.interests.splice(idx,1);
  else USER.interests.push(val);
}

function handleLaunch(btn){
  if(btn.disabled)return;
  btn.disabled=true;
  btn.textContent='Setting up...';
  launchSession().finally(()=>{
    btn.disabled=false;
    btn.textContent='Start Learning with ARIA →';
  });
}
async function launchSession(){
  const gkEl=$id('groqKey'); GROQ_KEY=gkEl?gkEl.value.trim():'';
  if(!GROQ_KEY||GROQ_KEY.length<20){
    alert('ARIA backend AI proxy is not available yet. Please start the backend and try again.');
    if(gkEl)gkEl.focus(); return;
  }
  const nameEl=$id('userName');
  const name = nameEl?nameEl.value.trim():'';
  if(!name){
    alert('Please enter your name!');
    if(nameEl)nameEl.focus(); return;
  }
  USER.name = name;
  USER.email = (document.getElementById('userEmail')?.value||'').trim().toLowerCase();
  USER.userId = USER.email || ('user_'+name.toLowerCase().replace(/\s+/g,'_'));
  USER.nativeLang = document.getElementById('nativeLang').value.trim();
  // Keep interests default if none selected
  // Sync interests from login chips
  const qiBtns = document.querySelectorAll('#loginInterests .al-chip.on, #loginInterests .int-chip.on');
  if(qiBtns.length) {
    USER.interests = [];
    qiBtns.forEach(b => {
      const oc = b.getAttribute('onclick') || '';
      const m = oc.match(/toggleQuickInterest\(this,'([^']+)'\)/);
      if(m) USER.interests.push(m[1].replace(/&amp;/g,'&'));
    });
  }
  if(!USER.interests.length) USER.interests = ['daily life'];
  SESSION={turns:0,fixes:0,words:0,history:[],feedbackLog:[],fluencyHistory:[],vocabTaught:[],corrections:[]};
  loadMemory(); loadVocabStore(); loadXP();
  try{
    localStorage.setItem('aria_groq_key', GROQ_KEY);
    localStorage.setItem('aria_user', JSON.stringify(USER));
    if(USER.userId) localStorage.setItem('aria_active_user', USER.userId);
  }catch(e){}
  document.body.classList.add('logged-in');
  const nav=$id('mainNav');if(nav)nav.style.display='flex';
  try{updateGreeting();}catch(e){console.warn('updateGreeting',e);}
  try{updateDash();}catch(e){console.warn('updateDash',e);}
  try{renderResources();}catch(e){console.warn('renderResources',e);}
  try{updateDebateDashStat();}catch(e){}
  goScreen('screenDash');
}

function goScreen(id){
  // Stop any ongoing speech when switching screens
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  ttsQueue=[];ttsBusy=false;
  document.querySelectorAll('.screen').forEach(s=>{s.classList.remove('active');s.style.display='none'});
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.toggle('active',t.dataset.screen===id));
  const el=document.getElementById(id);
  if(!el){ console.warn('goScreen: screen not found:', id); return; }
  const flexScreens={'screenCoach':'column','screenOnboard':'row','screenDash':'block'};
  if(id in flexScreens && flexScreens[id]!=='block'){
    el.style.display='flex';
    if(flexScreens[id]==='column') el.style.flexDirection='column';
  } else {
    el.style.display='block';
  }
  el.classList.add('active');
  if(id==='screenProfile')renderProfile();
  if(id==='screenQuiz'){
    renderActivityBar();
    if(QUIZ_STATE.questions.length===0&&QUIZ_STATE.status==='idle'&&ACTIVE_ACTIVITY.status!=='paused')generateQuiz();
  }
  if(id==='screenResources')renderResources();
  if(id==='screenDebate'){updateDebateDashStat();regTimeout('debate-interest-suggest',suggestDebateTopicByInterests,200);}
  if(id==='screenCompete')renderCompeteHistory();
}

function goCoach(){
  goScreen('screenCoach');
  document.getElementById('coachBadge').style.display='inline';
  document.getElementById('liveDot').classList.add('on');
  if(appState==='stopped'||(!mediaStream&&appState!=='listening'&&appState!=='thinking')){
    // Reset coach UI for new session
    SESSION={turns:0,fixes:0,words:0,history:[],feedbackLog:[],fluencyHistory:[],vocabTaught:[],corrections:[]};
    setHTML('corrList','<div class="empty-note">No corrections yet</div>');
    setHTML('vocabList','<div class="empty-note">New words appear here</div>');
    setHTML('convLog','<div class="empty-note">Start talking!</div>');
    setHTML('sparkline','');
    setText('fluencyN','—');setStyle('fluencyFill','width','0%');setText('fluencyLbl','Waiting...');
    const rc=$id('replyCard');if(rc)rc.classList.remove('on');
    const cn=$id('confNote');if(cn)cn.classList.remove('on');
    setText('stTurns','0');setText('stFixes','0');setText('stWords','0');setText('vBadge','0');
    initMic();
  }
}

function goHome(){goScreen('screenDash')}

