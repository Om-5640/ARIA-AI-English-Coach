// ══════════════════════════════════════════════
// DEVICE + INIT
// ══════════════════════════════════════════════
let IS_MOBILE = false;

function setDevice(type) {
  IS_MOBILE = (type === 'mobile');
  localStorage.setItem('aria_device', type);
  if (IS_MOBILE) document.body.classList.add('is-mobile');
  else document.body.classList.remove('is-mobile');
  document.getElementById('screenDevice').style.display = 'none';
  checkSavedSession();
}
function skipDevicePicker(){
  // Auto-detect device
  const saved = localStorage.getItem('aria_device');
  if(saved){ setDevice(saved); return; }
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  setDevice(mobile?'mobile':'desktop');
}

function checkSavedSession() {
  try {
    const savedUser = localStorage.getItem('aria_user');
    const savedKey = localStorage.getItem('aria_groq_key');
    if (savedUser && savedKey) {
      const u = JSON.parse(savedUser);
      if (u.name && u.name !== 'Friend') {
        GROQ_KEY = savedKey;
        USER = { ...USER, ...u };
        loadMemory(); loadVocabStore(); loadXP();
        document.body.classList.add('logged-in');
        try{updateDebateDashStat();}catch(e){}
        const nav2=$id('mainNav');if(nav2)nav2.style.display='flex';
        try{updateGreeting();}catch(e){}
        try{updateDash();}catch(e){}
        try{renderResources();}catch(e){}
        goScreen('screenDash');
        return;
      }
    }
  } catch(e) {}
  // No saved session — show login
  const onbEl = $id('screenOnboard');
  if(onbEl){ onbEl.style.display='flex'; onbEl.classList.add('active'); }
  prefillOnboard();
}

function prefillOnboard() {
  try {
    const savedKey = localStorage.getItem('aria_groq_key');
    const savedUser = localStorage.getItem('aria_user');
    const gk=$id('groqKey');if(gk&&savedKey){gk.value=savedKey;scheduleKeyCheck();}
    if (savedUser) {
      const u = JSON.parse(savedUser)||{};
      const un=$id('userName');if(un&&u.name)un.value=u.name;
      const nl=$id('nativeLang');if(nl&&u.nativeLang)nl.value=u.nativeLang;
      const em=$id('userEmail');if(em&&u.email)em.value=u.email;
      if(u.level){
        USER.level=u.level;
        document.querySelectorAll('#loginLevelSeg .al-seg-opt').forEach(b=>{
          const oc=b.getAttribute('onclick')||'';
          b.classList.toggle('on',oc.includes("'"+u.level+"'"));
        });
      }
      if(u.interests&&u.interests.length){
        document.querySelectorAll('#loginInterests .al-chip').forEach(chip=>{
          const oc=chip.getAttribute('onclick')||'';
          const m=oc.match(/toggleQuickInterest\(this,'([^']+)'\)/);
          if(m){
            const val=m[1].replace(/&amp;/g,'&');
            const match=u.interests.some(i=>i.toLowerCase().includes(val.split('&')[0].trim().toLowerCase()));
            chip.classList.toggle('on',match);
          }
        });
      }
    }
  } catch(e){console.warn('prefillOnboard:',e);}
}

// On page load: check device preference
window.addEventListener('DOMContentLoaded', function() {
  // ── Single authoritative init ──
  // 1. Load TTS voices
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
  // 2. Auto-detect device (no UI picker)
  const savedDevice = localStorage.getItem('aria_device');
  const isMobileUA = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const device = savedDevice || (isMobileUA ? 'mobile' : 'desktop');
  localStorage.setItem('aria_device', device);
  IS_MOBILE = (device === 'mobile');
  if (IS_MOBILE) document.body.classList.add('is-mobile');
  restoreCallState();
  try{
    const savedActivity=safeJSONParse(localStorage.getItem(ACTIVITY_STORAGE_KEY),null);
    if(savedActivity&&savedActivity.type){
      ACTIVE_ACTIVITY={...savedActivity,status:'paused'};
      renderActivityBar();
    }
  }catch(e){}
  // 3. Start live background
  initLiveBackground();
  // 4. Check if user is already logged in, else show login
  checkSavedSession();
});

window.addEventListener('pagehide', function(){
  try{endPeerCall('Call ended because the page was closed.');}catch(e){}
  if(ACTIVE_ACTIVITY.status==='active'){
    ACTIVE_ACTIVITY.snapshot=snapshotCurrentActivity();
    ACTIVE_ACTIVITY.status='paused';
    persistActivity();
  }
});

// ── AudioContext recovery — resume after browser auto-suspension ──
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState==='visible'&&audioContext&&audioContext.state==='suspended'){
    audioContext.resume().catch(()=>{});
  }
});
// Resume on user interaction (iOS requires gesture)
document.addEventListener('click', function(){
  if(audioContext&&audioContext.state==='suspended')audioContext.resume().catch(()=>{});
},{once:false,passive:true});

// ── Mobile visualViewport — compensate for software keyboard ──
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', function(){
    const mob=document.getElementById('mobNav');
    if(mob&&document.body.classList.contains('is-mobile')){
      const offset=Math.max(0,window.innerHeight-window.visualViewport.height);
      mob.style.transform=offset>100?`translateY(-${offset}px)`:'';
    }
  });
}

// ── API Key validator ──
let keyCheckTimer = null;
function scheduleKeyCheck() {
  clearTimeout(keyCheckTimer);
  keyCheckTimer = setTimeout(validateGroqKey, 800);
}

async function validateGroqKey() {
  const key = document.getElementById('groqKey').value.trim();
  const statusEl = document.getElementById('keyStatus');
  const statusText = document.getElementById('keyStatusText');
  if (!key || key.length < 20) { statusEl.style.display = 'none'; return; }
  statusEl.style.display = 'flex';
  statusEl.className = 'key-status checking';
  statusText.textContent = 'Checking API key...';
  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 })
    });
    if (res.ok) {
      statusEl.className = 'key-status valid';
      statusText.textContent = '✓ API key is valid and working!';
    } else {
      const err = await res.json();
      statusEl.className = 'key-status invalid';
      statusText.textContent = '✗ Invalid key: ' + (err?.error?.message || 'Check your key');
    }
  } catch(e) {
    statusEl.className = 'key-status invalid';
    statusText.textContent = '✗ Network error — check connection';
  }
}

// ── Logout ──
function logoutUser() {
  if (!confirm('Log out? Your progress is saved and you can log back in anytime.')) return;
  // Stop mic if active
  cleanupSpeechSystems({keepState:true});
  endPeerCall('Logged out');
  // Clear session state
  GROQ_KEY = '';
  USER = { name: '', level: 'intermediate', goal: 'fluent daily conversation', nativeLang: '', interests: ['daily life & culture'], topic: 'free conversation' };
  SESSION = { turns: 0, fixes: 0, words: 0, history: [], feedbackLog: [], fluencyHistory: [], vocabTaught: [], corrections: [] };
  appState = 'stopped';
  // Clean up all timers via centralized registry
  clearAllTimers();
  clearTimerKey('room-poll'); roomPollTimer=null;
  silenceTimer=null;
  ttsQueue=[];ttsBusy=false;
  // Remove logged-in state
  document.body.classList.remove('logged-in');
  const nav = document.getElementById('mainNav');
  if(nav) nav.style.display = 'none';
  const mobNav = document.getElementById('mobNav');
  if(mobNav) mobNav.style.display = 'none';
  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
  // Show login
  goScreen('screenOnboard');
  prefillOnboard();
}

// goScreen is patched in the main script block above

function setMobTab(btn) {
  document.querySelectorAll('.mob-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
}

// ══════════════════════════════════════════════
// COMPETE WITH FRIENDS — production backend entrypoints
// Full implementation is loaded from src/production-overrides.js.
// These shims prevent the legacy browser-storage multiplayer path from running.
// ══════════════════════════════════════════════
let currentCompeteMode = 'quiz';
let competeRoom = { code: '', players: [], gameActive: false, myScore: 0, friendScore: 0, questionIdx: 0, questions: [] };
let competeChannel = null;
let roomPollTimer = null;
function _aria(){return window.ARIA_PRODUCTION&&window.ARIA_PRODUCTION.fn;}
function _notReady(){showToast('Realtime backend is still loading — try again in a moment.','warn');}
function startCompeteRoom(mode){var f=_aria();if(f&&f.startCompeteRoom)return f.startCompeteRoom(mode);_notReady();}
function showJoinRoom(){document.getElementById('competeModeGrid').style.display='none';document.getElementById('createRoomPanel').classList.remove('active');document.getElementById('joinRoomPanel').classList.add('active');}
function joinRoom(){var f=_aria();if(f&&f.joinRoom)return f.joinRoom();_notReady();}
function initRealtimeRoom(){/* production realtime is initialized by production-overrides.js */}
function publishRoomUpdate(){/* disabled: room state is authoritative on the backend */}
function startRoomPolling(){/* disabled: no polling architecture in production */}
function sendCompeteMsg(){var f=_aria();if(f&&f.sendCompeteMsg)return f.sendCompeteMsg();}
function addCompeteMsg(type,text){const chat=document.getElementById('competeChat');if(!chat)return;const div=document.createElement('div');div.className='cc-msg '+type;div.textContent=text;chat.appendChild(div);chat.scrollTop=chat.scrollHeight;}
function copyRoomCode(){const code=document.getElementById('roomCodeDisplay').textContent;if(!code||code==='——')return;navigator.clipboard?.writeText(code).then(()=>showToast('Room code copied!','success',2500)).catch(()=>showToast('Room code: '+code,'info',8000));}
function startCompeteGame(){var f=_aria();if(f&&f.startCompeteGame)return f.startCompeteGame();}
function launchCompeteGame(){/* server snapshot renderer handles launch */}
function renderCompeteQuestion(){/* server snapshot renderer handles questions */}
function answerCompeteQ(idx){var f=_aria();if(f&&f.answerCompeteQ)return f.answerCompeteQ(idx);}
function showCompeteResult(){/* server snapshot renderer handles results */}
function cancelJoinRoom(){const jp=document.getElementById('joinRoomPanel');const mg=document.getElementById('competeModeGrid');if(jp)jp.classList.remove('active');if(mg)mg.style.display='';}
function closeCompeteRoom(){var f=_aria();if(f&&f.closeCompeteRoom)return f.closeCompeteRoom();}
function renderCompeteHistory(){
  try{
    const hist=JSON.parse(localStorage.getItem('aria_compete_hist_'+USER.name)||'[]');
    const tbody=document.getElementById('competeHistoryBody');
    if(!tbody)return;
    if(!hist.length){tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text3);font-style:italic;padding:20px">No compete history yet — play your first match!</td></tr>';return;}
    const modeLabels={quiz:'⚡ Quiz Race',debate:'⚖️ Debate Battle',vocab:'📚 Vocab Showdown'};
    tbody.innerHTML=hist.slice(0,10).map((h,i)=>`<tr><td class="lb-rank">${i+1}</td><td><span class="lb-badge">${modeLabels[h.mode]||h.mode}</span></td><td class="lb-score">${escapeHTML(h.result||'played')} (${escapeHTML(h.score||0)}–${escapeHTML(h.friendScore||0)})</td><td style="color:var(--orange);font-weight:700">+${escapeHTML(h.xp||0)} XP</td><td style="color:var(--text3);font-size:12px">${escapeHTML(h.date||'')}</td></tr>`).join('');
  }catch(e){}
}

// ══════════════════════════════════════════════
// SAVE GROQ KEY + USER on launch
// ══════════════════════════════════════════════
// launchSession handles save directly (see main launchSession above)


// ══════════════════════════════════════════════
// PROFILE TABS
// ══════════════════════════════════════════════
function switchProfileTab(btn, paneId){
  document.querySelectorAll('#profileTabBar .tab-btn').forEach(b=>b.classList.remove('on'));
  document.querySelectorAll('#screenProfile .tab-pane').forEach(p=>p.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById(paneId).classList.add('on');
  if(paneId==='ptProgress')renderProgressTab();
  if(paneId==='ptVocab'){loadVocabStore();renderVocabStore();}
  if(paneId==='ptMemory')renderMemoryTab();
}

function setLevelProfile(el,v){
  el.closest('.seg').querySelectorAll('.seg-opt').forEach(b=>b.classList.remove('on'));
  el.classList.add('on'); USER.level=v;
}

// ══════════════════════════════════════════════
// CEFR LEVEL COMPUTATION (real, data-driven)
// ══════════════════════════════════════════════
const CEFR_LEVELS = [
  {code:'A1',name:'Beginner',desc:'Basic phrases and introductions'},
  {code:'A2',name:'Elementary',desc:'Simple sentences about familiar topics'},
  {code:'B1',name:'Intermediate',desc:'Can handle most travel situations'},
  {code:'B2',name:'Upper-Int.',desc:'Complex topics with fluency'},
  {code:'C1',name:'Advanced',desc:'Fluent and spontaneous expression'},
  {code:'C2',name:'Mastery',desc:'Understands almost everything heard or read'},
];

function computeCEFRLevel(){
  const sessions = MEMORY.totalSessions||0;
  const avgFluency = MEMORY.fluencyTrend&&MEMORY.fluencyTrend.length
    ? MEMORY.fluencyTrend.reduce((a,b)=>a+b,0)/MEMORY.fluencyTrend.length : 0;
  const totalErrors = Object.values(MEMORY.weakAreas||{}).reduce((a,b)=>a+b,0);
  const errorRate = MEMORY.totalTurns>0 ? totalErrors/MEMORY.totalTurns : 1;
  const vocabSize = VOCAB_STORE.length;

  // Score 0-100 from multiple signals
  let score = 0;
  score += Math.min(avgFluency * 8, 40); // fluency score (0-40)
  score += Math.min(sessions * 3, 20);   // experience (0-20)
  score += Math.min(vocabSize * 0.5, 20);// vocab (0-20)
  score += Math.max(0, 20 - errorRate * 15); // accuracy (0-20)

  // Map to CEFR
  if(score >= 85) return 5;
  if(score >= 68) return 4;
  if(score >= 48) return 3;
  if(score >= 28) return 2;
  if(score >= 12) return 1;
  return 0;
}

function renderProgressTab(){
  // CEFR grid
  const levelIdx = computeCEFRLevel();
  const grid = document.getElementById('cefrGrid');
  if(!grid) return;
  grid.innerHTML = CEFR_LEVELS.map((l,i)=>`
    <div class="cefr-cell ${i<levelIdx?'achieved':i===levelIdx?'active':'inactive'}">
      <div class="cefr-code">${l.code}${i<levelIdx?' ✓':i===levelIdx?' ◉':''}</div>
      <div class="cefr-name">${l.name}</div>
    </div>`).join('');
  const cur = CEFR_LEVELS[levelIdx];
  document.getElementById('computedLevelName').textContent = cur.code+' — '+cur.name;
  document.getElementById('computedLevelDesc').textContent = cur.desc;
  const sessions=MEMORY.totalSessions||0, turns=MEMORY.totalTurns||0;
  document.getElementById('levelBasis').textContent =
    `Based on ${sessions} session${sessions!==1?'s':''}, ${turns} turns, avg fluency ${
      MEMORY.fluencyTrend&&MEMORY.fluencyTrend.length
        ?(MEMORY.fluencyTrend.reduce((a,b)=>a+b,0)/MEMORY.fluencyTrend.length).toFixed(1):0
    }/10, ${VOCAB_STORE.length} words learned`;

  // Session history
  const shEl = document.getElementById('profileSessionHistory');
  try{
    const sessions_arr = JSON.parse(localStorage.getItem('aria_sessions_'+USER.name)||'[]');
    if(sessions_arr.length){
      shEl.innerHTML = sessions_arr.map((s,i)=>`
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--orange-pale);color:var(--orange);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${sessions_arr.length-i}</div>
          <div style="flex:1">
            <div style="font-size:13.5px;font-weight:600">${escapeHTML(s.topic)} · Avg ${escapeHTML(s.avg)}/10</div>
            <div style="font-size:11.5px;color:var(--text2)">${escapeHTML(s.date)} · ${escapeHTML(s.turns)} turns · ${escapeHTML(s.fixes)} corrections · ${escapeHTML(s.words)} words${s.topWord?' · Best word: '+escapeHTML(s.topWord):''}</div>
          </div>
          <div style="font-family:'Instrument Serif',serif;font-size:24px;color:var(--orange)">${s.avg}</div>
        </div>`).join('');
    } else {
      shEl.innerHTML = '<div class="empty-note">No sessions yet</div>';
    }
  }catch(e){ shEl.innerHTML='<div class="empty-note">No sessions yet</div>'; }

  // Focus areas
  const faEl = document.getElementById('profileFocusAreas');
  const areas = Object.entries(MEMORY.weakAreas||{}).filter(([k,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if(areas.length){
    faEl.innerHTML = areas.map(([k,v])=>{
      const pct = Math.min(100,Math.round(v*6));
      const cls = pct>60?'high':pct>30?'mid':'good';
      return `<div class="fa-row"><div class="fa-label">${escapeHTML(k.charAt(0).toUpperCase()+k.slice(1))}</div>
        <div class="fa-track"><div class="fa-fill ${cls}" style="width:${pct}%"></div></div>
        <div class="fa-pct">${pct}%</div></div>`;
    }).join('');
  } else {
    faEl.innerHTML = '<div class="empty-note">No data yet — complete a session</div>';
  }

  // Achievements
  renderAchievements();
}

// ══════════════════════════════════════════════
// ACHIEVEMENTS
// ══════════════════════════════════════════════
const ACHIEVEMENTS = [
  {id:'first_session',icon:'🎙️',name:'First Words',desc:'Complete your first session',check:()=>(MEMORY.totalSessions||0)>=1},
  {id:'five_sessions',icon:'🔥',name:'On Fire',desc:'5 sessions completed',check:()=>(MEMORY.totalSessions||0)>=5},
  {id:'ten_sessions',icon:'💎',name:'Dedicated',desc:'10 sessions completed',check:()=>(MEMORY.totalSessions||0)>=10},
  {id:'vocab_10',icon:'📚',name:'Word Collector',desc:'Save 10 vocabulary words',check:()=>VOCAB_STORE.length>=10},
  {id:'vocab_50',icon:'📖',name:'Bibliophile',desc:'Save 50 vocabulary words',check:()=>VOCAB_STORE.length>=50},
  {id:'fluency_7',icon:'⭐',name:'Fluent',desc:'Avg fluency score above 7',check:()=>{const t=MEMORY.fluencyTrend||[];return t.length>3&&t.reduce((a,b)=>a+b,0)/t.length>=7}},
  {id:'fluency_9',icon:'🏆',name:'Near Native',desc:'Avg fluency score above 9',check:()=>{const t=MEMORY.fluencyTrend||[];return t.length>5&&t.reduce((a,b)=>a+b,0)/t.length>=9}},
  {id:'streak_3',icon:'📅',name:'Consistent',desc:'3-day practice streak',check:()=>(XP.streak||0)>=3},
  {id:'streak_7',icon:'🌟',name:'Week Warrior',desc:'7-day practice streak',check:()=>(XP.streak||0)>=7},
  {id:'quiz_perfect',icon:'🎯',name:'Quiz Master',desc:'Score 100% on a quiz',check:()=>!!localStorage.getItem('aria_quiz_perfect_'+USER.name)},
  {id:'speed_win',icon:'⚡',name:'Speed Demon',desc:'Beat ARIA in Speed Challenge',check:()=>!!localStorage.getItem('aria_speed_win_'+USER.name)},
  {id:'xp_100',icon:'💫',name:'XP Hunter',desc:'Earn 100 XP',check:()=>(XP.points||0)>=100},
  {id:'xp_500',icon:'🚀',name:'XP Legend',desc:'Earn 500 XP',check:()=>(XP.points||0)>=500},
  {id:'debate_done',icon:'⚖️',name:'Debater',desc:'Complete a full debate',check:()=>!!localStorage.getItem('aria_debate_done_'+USER.name)},
];

function renderAchievements(){
  const grid = document.getElementById('achievementsGrid');
  if(!grid)return;
  grid.innerHTML = ACHIEVEMENTS.map(a=>{
    const earned = a.check();
    return `<div class="ach-badge ${earned?'earned':''}" title="${a.desc}">
      <div class="ach-icon">${a.icon}</div>
      <div class="ach-name">${a.name}</div>
      <div class="ach-desc">${a.desc}</div>
      ${earned?'<div style="font-size:9.5px;color:var(--green);font-weight:700;margin-top:4px">✓ EARNED</div>':''}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
// NATIVE LANGUAGE INTERFERENCE PATTERNS
// ══════════════════════════════════════════════
const INTERFERENCE_DB = {
  hindi:     [{e:"Dropping articles",t:"Hindi has no a/the — say 'the car' not 'car'"},{e:"Progressive tense overuse",t:"Use simple present for habits: 'I go' not 'I am going'"},{e:"Subject-verb agreement",t:"'She go' → 'She goes' — always add -s for 3rd person"},{e:"Word order in questions",t:"'Where you are going?' → 'Where are you going?'"}],
  gujarati:  [{e:"Article omission",t:"Gujarati lacks articles — practice 'a book', 'the teacher'"},{e:"Plural confusion",t:"'Two book' → 'Two books' — always pluralise after numbers"},{e:"Tense consistency",t:"Gujarati verbs do not change for past as strictly — watch 'went' not 'go'"}],
  tamil:     [{e:"SOV to SVO switch",t:"Tamil is SOV; English is SVO — 'I rice eat' → 'I eat rice'"},{e:"Plural overextension",t:"'Childrens','informations' — these words are already irregular/uncountable"},{e:"Isn't it overuse",t:"Use varied tags: aren't they, didn't she — not always isn't it"}],
  telugu:    [{e:"Gender-neutral he/she",t:"Telugu has no gender pronouns — carefully distinguish he/she"},{e:"Verb-final structure",t:"'Book I reading am' → 'I am reading the book'"},{e:"Retroflex sounds",t:"d and t sound retroflex in Telugu — use lighter dental English sounds"}],
  bengali:   [{e:"Verb endings",t:"'He eat' → 'He eats' — 3rd person needs -s"},{e:"Definite article",t:"Bengali uses post-positions — practice 'the' before specific nouns"},{e:"Double negatives",t:"'I don't know nothing' → 'I don't know anything'"}],
  marathi:   [{e:"Article usage",t:"Marathi lacks articles — a/an for first mention, the for known things"},{e:"Do-support in questions",t:"'You like this?' → 'Do you like this?'"},{e:"Preposition mapping",t:"'I am going to market' vs 'I am going to the market'"}],
  punjabi:   [{e:"L/R distinction",t:"Punjabi blends L and R — practice minimal pairs like lake/rake"},{e:"Verb-tense sequence",t:"Sequence of tenses in complex sentences needs practice"},{e:"Article placement",t:"'A good man' not 'Good a man' — article always before adjective+noun"}],
  arabic:    [{e:"Definite article overuse",t:"'The' is not used before uncountable nouns: 'information' not 'the information'"},{e:"Plural formation",t:"English has irregular plurals: child/children, person/people"},{e:"P vs B sounds",t:"Arabic lacks /p/ — practise 'park' vs 'bark', 'pet' vs 'bet'"}],
  chinese:   [{e:"Tense marking",t:"Chinese verbs don't change form — always mark tense: 'I went' not 'I go yesterday'"},{e:"Articles a/an/the",t:"Chinese has no articles — every noun needs one or zero for uncountable"},{e:"Subject required",t:"'Is raining' → 'It is raining' — English always needs a subject"}],
  japanese:  [{e:"Omitted subjects",t:"Japanese often drops subject — English requires it every time"},{e:"L/R distinction",t:"Japanese doesn't distinguish — practise river/liver, rice/lice"},{e:"Polite over-hedging",t:"Direct statements are fine in English — less need for I think maybe perhaps"}],
  default:   [{e:"Article usage (a, an, the)",t:"Most languages lack English articles — this is usually the top challenge"},{e:"Verb tense consistency",t:"Keep the same tense within a sentence or paragraph"},{e:"Question word order",t:"'Where are you going?' not 'Where you are going?'"}],
};


function getInterferencePatterns(){
  const lang = (USER.nativeLang||'').toLowerCase().trim();
  if(!lang) return INTERFERENCE_DB.default;
  for(const key of Object.keys(INTERFERENCE_DB)){
    if(lang.includes(key)||key.includes(lang.split(' ')[0]))
      return INTERFERENCE_DB[key];
  }
  return INTERFERENCE_DB.default;
}

function renderMemoryTab(){
  // Interference map
  const imEl = document.getElementById('interferenceMap');
  const nld = document.getElementById('nativeLangDisplay');
  if(nld) nld.textContent = USER.nativeLang||'your language';
  if(imEl){
    const patterns = getInterferencePatterns();
    imEl.innerHTML = patterns.map(p=>`
      <div class="int-item">
        <div class="int-error">⚠️ ${p.e}</div>
        <div class="int-tip">💡 ${p.t}</div>
      </div>`).join('');
  }
  // Memory observations
  const mc = document.getElementById('ariaMemoryDisplay');
  if(!mc) return;
  const topW = Object.entries(MEMORY.weakAreas||{}).filter(([k,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const weakHtml = topW.length
    ? '<div style="margin-bottom:14px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);font-weight:700;margin-bottom:8px">Top Error Patterns</div>'
      +topW.map(([k,v])=>`<span class="focus-tag ${v>5?'high':v>2?'mid':'good'}" style="margin:2px 4px;display:inline-block">${escapeHTML(k)} (${Math.round(v)})</span>`).join('')
      +'</div>'
    : '';
  const avgFluency = MEMORY.fluencyTrend&&MEMORY.fluencyTrend.length
    ? (MEMORY.fluencyTrend.reduce((a,b)=>a+b,0)/MEMORY.fluencyTrend.length).toFixed(1) : '—';
  const obsHtml = MEMORY.ariaObservations.length
    ? '<div style="margin-top:12px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);font-weight:700;margin-bottom:8px">ARIA Session Observations</div>'
      + MEMORY.ariaObservations.slice(-8).reverse().map(o=>`<div style="padding:8px 12px;background:var(--cream);border-radius:9px;font-size:12.5px;color:var(--text2);margin-bottom:6px;border-left:3px solid var(--accent2,var(--orange-pale2))">💡 ${escapeHTML(o)}</div>`).join('')
      +'</div>'
    : '';
  mc.innerHTML = weakHtml
    + `<div style="font-size:13px;color:var(--text2);margin-bottom:8px">Avg fluency score: <strong style="color:var(--orange)">${avgFluency}/10</strong> · Sessions: <strong>${MEMORY.totalSessions||0}</strong> · Total turns: <strong>${MEMORY.totalTurns||0}</strong></div>`
    + (obsHtml || '<div class="empty-note">Complete sessions to build ARIA memory of you</div>');
}

// ══════════════════════════════════════════════
// RESOURCES SYSTEM
// ══════════════════════════════════════════════


// ══════════════════════════════════════════════
// IMPROVED VOCAB STORE RENDER (with search + filter)
// ══════════════════════════════════════════════
function renderVocabStore(){
  const el = document.getElementById('savedVocabList');
  if(!el) return;
  loadVocabStore();
  const searchEl = document.getElementById('vocabSearch');
  const filterEl = document.getElementById('vocabFilter');
  const search = (searchEl?searchEl.value:'').toLowerCase();
  const filter = filterEl?filterEl.value:'all';
  let items = VOCAB_STORE;
  if(filter!=='all') items = items.filter(v=>v.source===filter);
  if(search) items = items.filter(v=>(v.word||'').toLowerCase().includes(search)||(v.def||'').toLowerCase().includes(search));
  const count = document.getElementById('savedVocabCount');
  if(count) count.textContent = VOCAB_STORE.length+' word'+(VOCAB_STORE.length!==1?'s':'');
  if(!items.length){
    el.innerHTML = search||filter!=='all'
      ? '<div class="empty-note">No words match your search</div>'
      : '<div class="empty-note">No saved words yet — save words from sessions or Word of the Day</div>';
    return;
  }
  el.innerHTML = items.map((v,i)=>{
    const realIdx=VOCAB_STORE.indexOf(v);
    return `<div class="vocab-bank-item">
      <div style="flex:1;min-width:0">
        <div class="vbi-word">${escapeHTML(v.word)} <span class="vbi-type">(${escapeHTML(v.type||'')})</span></div>
        <div class="vbi-def">${escapeHTML(v.def||v.definition||'')}</div>
        ${v.example?`<div class="vbi-ex">"${escapeHTML(v.example)}"</div>`:''}
        <div class="vbi-meta">${escapeHTML(v.source||'Session')} · ${escapeHTML(v.date||'')}</div>
      </div>
      <button class="vbi-del" onclick="removeVocabEntry(${realIdx})" title="Remove">✕</button>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
// ENHANCED SYSTEM PROMPT — native language patterns
// ══════════════════════════════════════════════
function getNativeLanguageTips(){
  const patterns = getInterferencePatterns();
  return patterns.slice(0,3).map(p=>p.e).join(', ');
}

// ══════════════════════════════════════════════
// LIVE ANIMATED BACKGROUND
// ══════════════════════════════════════════════
let _bgRaf=null, _bgResizeHandler=null;
function initLiveBackground(){
  const canvas = document.getElementById('bgCanvas');
  if(!canvas) return;
  // Reduced motion — skip canvas entirely
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    canvas.style.display='none'; return;
  }
  // Low-end device fallback — skip on slow connections
  if(navigator.connection&&navigator.connection.saveData){
    canvas.style.display='none'; return;
  }
  const ctx = canvas.getContext('2d');
  let W, H, particles=[], raf;

  function resize(){
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  _bgResizeHandler=resize;
  resize();
  window.addEventListener('resize', resize);

  // Create particles
  for(let i=0;i<(IS_MOBILE?25:45);i++){
    particles.push({
      x: Math.random()*W, y: Math.random()*H,
      r: Math.random()*2.5+0.5,
      dx: (Math.random()-.5)*0.4,
      dy: (Math.random()-.5)*0.4,
      opacity: Math.random()*0.5+0.1,
      hue: Math.random()>0.5?22:35 // orange or amber
    });
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    // Draw connections
    for(let i=0;i<particles.length;i++){
      for(let j=i+1;j<particles.length;j++){
        const dx=particles[i].x-particles[j].x, dy=particles[i].y-particles[j].y;
        const dist=Math.sqrt(dx*dx+dy*dy);
        if(dist<130){
          ctx.beginPath();
          ctx.moveTo(particles[i].x,particles[i].y);
          ctx.lineTo(particles[j].x,particles[j].y);
          ctx.strokeStyle=`rgba(232,98,26,${0.06*(1-dist/130)})`;
          ctx.lineWidth=0.8;
          ctx.stroke();
        }
      }
    }
    // Draw particles
    particles.forEach(p=>{
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`hsla(${p.hue},80%,60%,${p.opacity})`;
      ctx.fill();
      p.x+=p.dx; p.y+=p.dy;
      if(p.x<0||p.x>W) p.dx*=-1;
      if(p.y<0||p.y>H) p.dy*=-1;
    });
    raf = requestAnimationFrame(draw);
    _bgRaf = raf;
  }
  draw();
}

// ══════════════════════════════════════════════
// INIT background on load
// ══════════════════════════════════════════════
// initLiveBackground called from main DOMContentLoaded


// ══════════════════════════════════════════════
// MEMORY MANAGEMENT
// ══════════════════════════════════════════════
function deleteAllData(){
  if(!confirm('Delete ALL ARIA data permanently?\n\nThis will remove your name, email, Groq API key, profile, ARIA memory, vocabulary bank, XP, streaks, sessions, quizzes, certificates, compete/debate history, rooms, and saved settings.\n\nThis cannot be undone.'))return;
  try{
    Object.keys(localStorage).filter(k=>k.startsWith('aria_')).forEach(k=>localStorage.removeItem(k));
  }catch(e){}
  cleanupSpeechSystems({keepState:true});
  try{endPeerCall('All data deleted');}catch(e){}
  GROQ_KEY='';
  USER={name:'',level:'intermediate',goal:'fluent daily conversation',nativeLang:'',interests:['daily life & culture'],topic:'free conversation'};
  MEMORY={weakAreas:{grammar:3,pronunciation:2,vocabulary:1},totalSessions:0,totalTurns:0,ariaObservations:[]};
  SESSION={turns:0,fixes:0,words:0,history:[],feedbackLog:[],fluencyHistory:[],vocabTaught:[],corrections:[]};
  VOCAB_STORE=[];XP={points:0,level:1,streak:0,lastSession:'',streakDays:[]};
  document.body.classList.remove('logged-in');
  const nav=$id('mainNav');if(nav)nav.style.display='none';
  document.querySelectorAll('.screen').forEach(s=>{s.classList.remove('active');s.style.display='none';});
  const onb=$id('screenOnboard');if(onb){onb.style.display='flex';onb.classList.add('active');}
  ['userName','userEmail','groqKey','nativeLang'].forEach(id=>{const el=$id(id);if(el)el.value='';});
}
function clearARIAMemory(){
  if(!confirm('Clear ARIA Memory permanently?\n\nThis will remove ARIA observations, weak-area patterns, fluency trends, emotional learning signals, and personalization memory.\n\nYour name, API key, XP, sessions, and vocabulary bank will stay.\n\nThis cannot be undone.'))return;
  MEMORY.ariaObservations=[];
  MEMORY.weakAreas={grammar:0,pronunciation:0,vocabulary:0};
  MEMORY.fluencyTrend=[];
  MEMORY.emotionalSignals=[];
  saveMemory();
  renderProfile();
}

function clearVocabBank(){
  if(!confirm('Clear Vocab Bank permanently?\n\nThis will remove every saved vocabulary word, definition, example, and vocabulary-bank entry.\n\nYour name, API key, ARIA memory, XP, and sessions will stay.\n\nThis cannot be undone.'))return;
  VOCAB_STORE=[];
  try{localStorage.removeItem('aria_vocab_'+USER.name);}catch(e){}
  renderVocabStore();
}

// ══════════════════════════════════════════════
// CERTIFICATION SYSTEM
// ══════════════════════════════════════════════
const CERT_REQUIREMENTS=[
  {code:'A1',sessions:2,turns:20,fluency:4.5,vocab:8,streak:1,debates:0,perfectQuiz:false},
  {code:'A2',sessions:4,turns:45,fluency:5.5,vocab:18,streak:2,debates:0,perfectQuiz:false},
  {code:'B1',sessions:8,turns:90,fluency:6.5,vocab:35,streak:3,debates:1,perfectQuiz:false},
  {code:'B2',sessions:14,turns:160,fluency:7.4,vocab:65,streak:5,debates:2,perfectQuiz:true},
  {code:'C1',sessions:24,turns:300,fluency:8.3,vocab:110,streak:7,debates:4,perfectQuiz:true},
  {code:'C2',sessions:40,turns:520,fluency:9.1,vocab:180,streak:14,debates:8,perfectQuiz:true}
];

function getCertificationMetrics(){
  const fluency=MEMORY.fluencyTrend&&MEMORY.fluencyTrend.length
    ? MEMORY.fluencyTrend.reduce((a,b)=>a+b,0)/MEMORY.fluencyTrend.length : 0;
  let debateCount=0;
  try{debateCount=JSON.parse(localStorage.getItem('aria_debates_'+USER.name)||'[]').length;}catch(e){}
  return {sessions:MEMORY.totalSessions||0,turns:MEMORY.totalTurns||0,fluency,vocab:VOCAB_STORE.length,streak:XP.streak||0,debates:debateCount,perfectQuiz:!!localStorage.getItem('aria_quiz_perfect_'+USER.name)};
}

function getEligibleCertificateLevel(){
  const computed=computeCEFRLevel ? computeCEFRLevel() : 0;
  const m=getCertificationMetrics();
  let eligible=-1;
  CERT_REQUIREMENTS.forEach((r,i)=>{
    const ok=i<=computed&&m.sessions>=r.sessions&&m.turns>=r.turns&&m.fluency>=r.fluency&&m.vocab>=r.vocab&&m.streak>=r.streak&&m.debates>=r.debates&&(!r.perfectQuiz||m.perfectQuiz);
    if(ok)eligible=i;
  });
  return eligible;
}

function makeCertificateId(levelCode){
  const seed=((USER.email||USER.name||'learner')+levelCode+Date.now()).replace(/[^a-z0-9]/gi,'').toUpperCase();
  return 'ARIA-'+levelCode+'-'+seed.slice(0,6)+'-'+Math.random().toString(36).slice(2,8).toUpperCase();
}

function saveCertificateRecord(record){
  try{
    const key='aria_certificates_'+USER.name;
    const hist=safeJSONParse(localStorage.getItem(key),[]);
    hist.unshift(record);
    localStorage.setItem(key,JSON.stringify(hist.slice(0,20)));
  }catch(e){}
  recordLearningSignal('certificate_issued',record);
}

function generateCertificate(){
  const levelIdx = getEligibleCertificateLevel();
  if(levelIdx<0){
    const m=getCertificationMetrics();
    const r=CERT_REQUIREMENTS[0];
    showToast(`Certification locked — need ${r.sessions} sessions, ${r.turns} turns, ${r.fluency}/10 fluency, ${r.vocab} saved words. Current: ${m.sessions}/${r.sessions} sessions.`, 'warn', 7000);
    return;
  }
  const CEFR = ['A1','A2','B1','B2','C1','C2'];
  const cefrCode = CEFR[levelIdx];
  const cefrNames = ['Beginner','Elementary','Intermediate','Upper-Intermediate','Advanced','Mastery'];
  const cefrName = cefrNames[levelIdx];
  const avgFluency = MEMORY.fluencyTrend&&MEMORY.fluencyTrend.length
    ? (MEMORY.fluencyTrend.reduce((a,b)=>a+b,0)/MEMORY.fluencyTrend.length).toFixed(1) : '—';
  const date = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const sessions = MEMORY.totalSessions||0;
  const certId=makeCertificateId(cefrCode);
  const metrics=getCertificationMetrics();
  const learnerName=escapeHTML(USER.name||'Learner');
  const certHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Lato:wght@300;400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#fff;width:1122px;height:794px;display:flex;align-items:center;justify-content:center;font-family:'Lato',sans-serif}
.cert{width:1020px;height:720px;border:3px solid #c8a96e;outline:8px solid #f5ead8;outline-offset:6px;padding:56px 72px;text-align:center;position:relative;background:linear-gradient(135deg,#fffdf8 0%,#fdf8f0 100%)}
.cert::before{content:'';position:absolute;inset:24px;border:1px solid rgba(200,169,110,0.3);pointer-events:none}
.logo{font-family:'Playfair Display',serif;font-size:28px;color:#e8621a;letter-spacing:.15em;text-transform:uppercase;margin-bottom:6px}
.tagline{font-size:11px;color:#b8906a;letter-spacing:.2em;text-transform:uppercase;margin-bottom:40px}
.cert-title{font-size:13px;color:#7a5540;letter-spacing:.25em;text-transform:uppercase;margin-bottom:16px}
.certifies{font-family:'Playfair Display',serif;font-size:18px;color:#2d1a0e;font-style:italic;margin-bottom:20px}
.name{font-family:'Playfair Display',serif;font-size:52px;color:#e8621a;border-bottom:2px solid #e8621a;display:inline-block;padding:0 40px 8px;margin-bottom:24px;min-width:400px}
.cefr-badge{display:inline-flex;align-items:center;gap:16px;background:linear-gradient(135deg,#fde8d8,#fbd5b8);border:2px solid #e8621a;border-radius:16px;padding:14px 32px;margin-bottom:24px}
.cefr-code{font-family:'Playfair Display',serif;font-size:42px;color:#e8621a;line-height:1}
.cefr-info{text-align:left}
.cefr-level{font-size:20px;font-weight:700;color:#2d1a0e}
.cefr-desc{font-size:12px;color:#7a5540;margin-top:2px}
.stats{display:flex;justify-content:center;gap:48px;margin-bottom:32px}
.stat{text-align:center}
.stat-n{font-family:'Playfair Display',serif;font-size:32px;color:#e8621a}
.stat-l{font-size:11px;color:#7a5540;text-transform:uppercase;letter-spacing:.1em;margin-top:3px}
.achieved{font-size:13px;color:#7a5540;font-style:italic;margin-bottom:32px}
.footer{display:flex;justify-content:space-between;align-items:flex-end;padding-top:24px;border-top:1px solid rgba(200,169,110,0.4)}
.sig{text-align:center}
.sig-name{font-family:'Playfair Display',serif;font-size:20px;color:#2d1a0e;font-style:italic}
.sig-title{font-size:10px;color:#b8906a;letter-spacing:.12em;text-transform:uppercase;margin-top:4px}
.date-box{text-align:right;font-size:12px;color:#7a5540}
.watermark{position:absolute;bottom:40px;left:50%;transform:translateX(-50%);font-size:10px;color:rgba(184,144,106,0.5);letter-spacing:.1em;text-transform:uppercase}
.verify{font-size:10px;color:rgba(184,144,106,0.6);text-align:center;margin-top:4px}
.criteria{font-size:11px;color:#7a5540;margin:-18px 0 22px 0;letter-spacing:.05em;text-transform:uppercase}
<\/style><\/head><body>
<div class="cert">
  <div class="logo">ARIA</div>
  <div class="tagline">AI English Mastery System · Verified Certificate</div>
  <div class="cert-title">This is to certify that</div>
  <div class="certifies">the following learner has demonstrated English language proficiency at the</div>
  <div class="name">${learnerName}</div><br>
  <div class="cefr-badge">
    <div class="cefr-code">${cefrCode}</div>
    <div class="cefr-info">
      <div class="cefr-level">${cefrName}</div>
      <div class="cefr-desc">Common European Framework of Reference</div>
    </div>
  </div><br>
  <div class="stats">
    <div class="stat"><div class="stat-n">${sessions}</div><div class="stat-l">Sessions</div></div>
    <div class="stat"><div class="stat-n">${avgFluency}/10</div><div class="stat-l">Avg Fluency</div></div>
    <div class="stat"><div class="stat-n">${VOCAB_STORE.length}</div><div class="stat-l">Words Learned</div></div>
    <div class="stat"><div class="stat-n">${MEMORY.totalTurns||0}</div><div class="stat-l">Practice Turns</div></div>
  </div>
  <div class="criteria">Required evidence: consistency, speaking fluency, grammar mastery, debate performance, and vocabulary growth.</div>
  <div class="achieved">Achieved through sustained practice using realtime voice coaching, grammar correction, fluency analysis, and challenge performance.</div>
  <div class="footer">
    <div class="sig"><div class="sig-name">ARIA</div><div class="sig-title">AI English Coach · Powered by Groq</div></div>
    <div class="sig"><div class="sig-name">${learnerName}</div><div class="sig-title">Learner</div></div>
    <div class="date-box"><strong>Issue Date</strong><br>${date}<br><br>ID: ${certId}</div>
  </div>
  <div class="watermark">Validated locally · ${certId}</div>
</div>
<\/body><\/html>`;

  saveCertificateRecord({id:certId,level:cefrCode,name:USER.name,date:new Date().toISOString(),metrics});
  const blob=new Blob([certHTML],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`ARIA-${cefrCode}-Certificate-${certId}.html`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  const w = window.open('','_blank','width=1150,height=830');
  if(w){
    w.document.write(certHTML);
    w.document.close();
    setTimeout(()=>w.print(), 500);
  }
  earnXP(100,'Generated English Certificate');
}

// ══════════════════════════════════════════════
// PEER VIDEO/VOICE CHAT — automatic production signaling
// Full implementation is loaded from src/production-overrides.js.
// Legacy manual SDP exchange has been removed from the active runtime.
// ══════════════════════════════════════════════
let peerConn=null, localStream=null, peerMode='video';
function startPeerCall(mode){var f=_aria();if(f&&f.startPeerCall)return f.startPeerCall(mode);_notReady();}
function getPeerMediaConstraints(mode){const audio={echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1};return mode==='video'?{audio,video:{width:{ideal:960,max:1280},height:{ideal:540,max:720},frameRate:{ideal:24,max:30},facingMode:'user'}}:{audio,video:false};}
function acceptOffer(){var f=_aria();if(f&&f.acceptOffer)return f.acceptOffer();}
function endPeerCall(reason){var f=_aria();if(f&&f.endPeerCall)return f.endPeerCall(reason);}
function copyPeerOffer(){var f=_aria();if(f&&f.copyPeerOffer)return f.copyPeerOffer();}

// ══════════════════════════════════════════════
// INTERESTS — deep integration in system prompt (already in buildSystemPrompt)
// Also use interests to pre-select debate topics
// ══════════════════════════════════════════════
function suggestDebateTopicByInterests(){
  if(!USER.interests||!USER.interests.length)return;
  const interest = USER.interests[0]||'';
  const cards = document.querySelectorAll('.debate-topic-card');
  // Try to find a matching card
  for(const card of cards){
    const title=(card.querySelector('.dtc-name')||card).textContent.toLowerCase();
    if(interest.split(/[&,]/)[0].trim().split(' ').some(w=>w.length>3&&title.includes(w.toLowerCase()))){
      card.click();
      break;
    }
  }
}

// autoInit removed — handled by DOMContentLoaded

// ══════════════════════════════════════════════
// STATE
