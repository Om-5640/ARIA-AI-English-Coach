// ══════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════
function updateGreeting(){
  const h=new Date().getHours();
  const g=h<12?'morning':h<17?'afternoon':'evening';
  document.getElementById('timeGreet').textContent=g;
  document.getElementById('dashName').textContent=USER.name;
  const lvlMap={beginner:'You\'re building your foundation — consistency is key!',intermediate:'You\'re making real progress — push yourself a little more each day.',advanced:'You\'re close to mastery — focus on nuance and naturalness.'};
  document.getElementById('dashSub').textContent=lvlMap[USER.level]||'';
  document.getElementById('userAvatarNav').textContent=USER.name.charAt(0).toUpperCase();
  document.getElementById('userNameNav').textContent=USER.name;
  const navAv=document.getElementById('userAvatarNav');
  navAv.textContent=USER.name.charAt(0).toUpperCase();
}

function updateDash(){
  const lvlPct={beginner:15,intermediate:35,advanced:70}[USER.level]||35;
  document.getElementById('levelLabel').textContent=USER.level.charAt(0).toUpperCase()+USER.level.slice(1);
  document.getElementById('levelPct').textContent=lvlPct+'%';
  document.getElementById('levelProgFill').style.width=lvlPct+'%';
  try{
    const sessions=JSON.parse(localStorage.getItem('aria_sessions_'+USER.name)||'[]');
    document.getElementById('sessionsNote').textContent=sessions.length?`${sessions.length} total session${sessions.length!==1?'s':''} completed`:'Complete your first session!';
    if(sessions.length){
      const el=document.getElementById('recentSessions');
      el.innerHTML=sessions.slice(0,3).map(s=>`
        <div style="background:#fff;border:1px solid var(--border);border-radius:14px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;gap:14px">
          <div style="font-size:24px">🎙️</div>
          <div style="flex:1"><div style="font-size:13.5px;font-weight:600;color:var(--text)">${s.topic} · Score ${s.avg}/10</div>
          <div style="font-size:12px;color:var(--text2)">${s.date} · ${s.turns} turns · ${s.fixes} fixes · ${s.words} words</div></div>
        </div>`).join('');
    }
  }catch(e){}
  document.getElementById('dashQuizCount').textContent=QUIZ_STATE.questions.length?QUIZ_STATE.questions.length+' ready':'Generate now';
  loadXP();renderXP();loadWotd();loadIdiomOfDay();
}

// ══════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════
function renderProfile(){
  const pn=$id('profileName'); if(pn) pn.value=USER.name||'';
  const pnat=$id('profileNative'); if(pnat) pnat.value=USER.nativeLang||''; // USER.nativeLang set at login
  const lvlPct={beginner:15,intermediate:35,advanced:70}[USER.level]||35;
  document.getElementById('profileLevelLabel').textContent=USER.level.charAt(0).toUpperCase()+USER.level.slice(1);
  document.getElementById('profileLevelPct').textContent=lvlPct+'%';
  document.getElementById('profileLevelBar').style.width=lvlPct+'%';
  const nextLvl={beginner:'Elementary',intermediate:'Upper Intermediate',advanced:'Near-Native'};
  document.getElementById('profileLevelNote').textContent=`Keep practising to advance to ${nextLvl[USER.level]||'the next level'}`;
  // Interests
  const ic=document.getElementById('profileInterests');
  ic.innerHTML=USER.interests.map((interest,idx)=>`<span class="memory-chip">${escapeHTML(interest)}<span class="x" onclick="removeInterestByIndex(${idx})">✕</span></span>`).join('');
  // Set level seg active state
  document.querySelectorAll('#ptSettings .seg-opt').forEach(b=>{
    const v=b.getAttribute('onclick')||'';
    if(v.includes("'"+USER.level+"'")||v.includes('"'+USER.level+'"'))b.classList.add('on');
    else b.classList.remove('on');
  });
  loadVocabStore();renderVocabStore();
  // Memory
  const mc=document.getElementById('ariaMemoryDisplay');
  const topW=Object.entries(MEMORY.weakAreas).filter(([k,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const obsHtml=MEMORY.ariaObservations.slice(-6).map(o=>`<div class="memory-chip" style="margin:3px;display:inline-flex">💡 ${o}</div>`).join('');
  const weakHtml=topW.length?'<div style="margin-bottom:8px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);font-weight:700;margin-bottom:6px">Top Weak Areas</div>'+topW.map(([k,v])=>`<span class="focus-tag ${v>5?'high':v>2?'mid':'good'}" style="margin:2px 4px;display:inline-block">${k} (${Math.round(v)})</span>`).join('')+'</div>':''
  const fluencyHtml=MEMORY.fluencyTrend&&MEMORY.fluencyTrend.length?'<div style="font-size:12px;color:var(--text2);margin-bottom:8px">Avg fluency: '+(MEMORY.fluencyTrend.reduce((a,b)=>a+b,0)/MEMORY.fluencyTrend.length).toFixed(1)+'/10 over last '+MEMORY.fluencyTrend.length+' turns</div>':'';
  mc.innerHTML=weakHtml+fluencyHtml+(obsHtml||'<div style="font-size:12.5px;color:var(--text3);font-style:italic">ARIA will fill this as you practise.</div>');
}

function setGoalProfile(el,v){el.closest('.seg').querySelectorAll('.seg-opt').forEach(b=>b.classList.remove('on'));el.classList.add('on');USER.goal=v}
function removeInterest(v){USER.interests=USER.interests.filter(i=>i!==v);renderProfile()}
function removeInterestByIndex(idx){USER.interests.splice(idx,1);renderProfile();}
function addInterest(){const v=document.getElementById('newInterestInput').value.trim();if(v&&!USER.interests.includes(v)){USER.interests.push(v);document.getElementById('newInterestInput').value='';renderProfile()}}
function saveProfile(){
  const pn=$id('profileName'); if(pn&&pn.value.trim()) USER.name=pn.value.trim();
  const pnat=$id('profileNative'); if(pnat) USER.nativeLang=pnat.value.trim();
  const pgoal=document.querySelector('#ptSettings .seg-opt.on[onclick*="setGoalProfile"]');
  // goal saved by setGoalProfile onclick
  const plvl=document.querySelector('#ptSettings .seg-opt.on[onclick*="setLevelProfile"]');
  // level saved by setLevelProfile onclick
  try{localStorage.setItem('aria_user',JSON.stringify(USER));}catch(e){}
  saveMemory();
  const btn=document.querySelector('[onclick="saveProfile()"]');
  if(btn){const o=btn.textContent;btn.textContent='✅ Saved!';setTimeout(()=>{btn.textContent=o;},2000);}
  try{updateGreeting();}catch(e){}
  renderProfile();
}

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════
// speechSynthesis init handled in DOMContentLoaded

// ══════════════════════════════════════════════
// XP & STREAK SYSTEM
// ══════════════════════════════════════════════
let XP={points:0,level:1,streak:0,lastSession:'',streakDays:[]};
let VOCAB_STORE=[]; // persistent across sessions

function loadXP(){
  try{const s=localStorage.getItem('aria_xp_'+USER.name);if(s)XP={...XP,...safeJSONParse(s,{})};}catch(e){}
}
function saveXP(){try{localStorage.setItem('aria_xp_'+USER.name,JSON.stringify(XP))}catch(e){}}

function saveVocabStore(entry){
  try{
    const key='aria_vocab_'+USER.name;
    const existing=JSON.parse(localStorage.getItem(key)||'[]');
    // avoid duplicates
    if(!existing.find(e=>e.word===entry.word)){
      existing.unshift(entry);
      if(existing.length>200)existing.pop();
      localStorage.setItem(key,JSON.stringify(existing));
      VOCAB_STORE=existing;
    }
    renderVocabStore();
  }catch(e){}
}

function loadVocabStore(){
  try{
    const key='aria_vocab_'+USER.name;
    VOCAB_STORE=safeJSONParse(localStorage.getItem(key),[]);
    if(!Array.isArray(VOCAB_STORE))VOCAB_STORE=[];
  }catch(e){VOCAB_STORE=[];}
}

function removeVocabEntry(idx){
  loadVocabStore();
  VOCAB_STORE.splice(idx,1);
  try{localStorage.setItem('aria_vocab_'+USER.name,JSON.stringify(VOCAB_STORE));}catch(e){}
  renderVocabStore();
}

function earnXP(amount,reason){
  loadXP();
  XP.points+=amount;
  const xpPerLevel=200;
  XP.level=Math.floor(XP.points/xpPerLevel)+1;
  saveXP();renderXP();
  // Flash notification
  const note=document.createElement('div');
  note.style.cssText='position:fixed;bottom:24px;right:24px;background:var(--orange);color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:700;z-index:999;animation:popin .3s ease;box-shadow:0 4px 16px rgba(232,98,26,0.35)';
  note.textContent='+'+amount+' XP — '+reason;
  document.body.appendChild(note);
  setTimeout(()=>note.remove(),2500);
}

function updateStreak(){
  loadXP();
  const today=new Date().toDateString();
  if(XP.lastSession===today)return;
  const yesterday=new Date(Date.now()-86400000).toDateString();
  if(XP.lastSession===yesterday)XP.streak++;
  else XP.streak=1;
  XP.lastSession=today;
  if(!XP.streakDays)XP.streakDays=[];
  XP.streakDays.push(new Date().getDay());
  if(XP.streakDays.length>7)XP.streakDays=XP.streakDays.slice(-7);
  saveXP();
}

function renderXP(){
  loadXP();
  const xpPerLevel=200;
  const levelXP=XP.points%xpPerLevel;
  const pct=Math.round((levelXP/xpPerLevel)*100);
  const sn=document.getElementById('streakN');const xv=document.getElementById('xpVal');
  const xf=document.getElementById('xpFill');const xl=document.getElementById('xpLevel');
  const xn=document.getElementById('xpNext');const sd=document.getElementById('streakDays');
  if(sn)sn.textContent=XP.streak||0;
  if(xv)xv.textContent=XP.points+' XP';
  if(xf)xf.style.width=pct+'%';
  if(xl)xl.textContent=XP.level;
  if(xn)xn.textContent=(xpPerLevel-levelXP)+' XP to Level '+(XP.level+1);
  if(sd){
    const days=['S','M','T','W','T','F','S'];
    const today=new Date().getDay();
    sd.innerHTML=days.map((d,i)=>{
      const done=XP.streakDays&&XP.streakDays.includes(i);
      return '<div class="streak-day'+(done?' done':'')+'" title="'+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]+'">'+d+'</div>';
    }).join('');
  }
}

// ══════════════════════════════════════════════
// WORD OF THE DAY
// ══════════════════════════════════════════════
const WOTD_BANK=[
  {word:"Eloquent",phonetic:"/ˈɛləkwənt/",type:"adjective",def:"Fluent or persuasive in speaking or writing.",ex:"She gave an eloquent speech that moved the entire audience."},
  {word:"Persevere",phonetic:"/ˌpɜːsɪˈvɪər/",type:"verb",def:"Continue in a course of action despite difficulty.",ex:"You must persevere through the hard parts to achieve fluency."},
  {word:"Nuance",phonetic:"/ˈnjuːɑːns/",type:"noun",def:"A subtle difference in meaning, expression, or tone.",ex:"The nuance between say and tell trips up many learners."},
  {word:"Articulate",phonetic:"/ɑːˈtɪkjʊlɪt/",type:"adjective",def:"Having or showing the ability to speak fluently and clearly.",ex:"He became more articulate after months of practice."},
  {word:"Mundane",phonetic:"/mʌnˈdeɪn/",type:"adjective",def:"Lacking interest or excitement; ordinary.",ex:"Even mundane topics are great practice for conversation."},
  {word:"Resilient",phonetic:"/rɪˈzɪlɪənt/",type:"adjective",def:"Able to recover quickly from difficulties.",ex:"Resilient learners treat mistakes as stepping stones."},
  {word:"Candid",phonetic:"/ˈkændɪd/",type:"adjective",def:"Truthful and straightforward; frank.",ex:"I appreciate candid feedback — it helps me grow."},
  {word:"Diligent",phonetic:"/ˈdɪlɪdʒənt/",type:"adjective",def:"Having or showing care and conscientiousness in work.",ex:"Diligent practice every day beats cramming once a week."},
  {word:"Empathy",phonetic:"/ˈɛmpəθi/",type:"noun",def:"The ability to understand and share the feelings of another.",ex:"Good communicators show empathy when listening."},
  {word:"Concise",phonetic:"/kənˈsaɪs/",type:"adjective",def:"Giving a lot of information clearly using few words.",ex:"A concise answer is often more impressive than a long one."},
  {word:"Brainstorm",phonetic:"/ˈbreɪnstɔːm/",type:"verb",def:"Produce an idea spontaneously in a group discussion.",ex:"Let us brainstorm some topics for today's session."},
  {word:"Spontaneous",phonetic:"/spɒnˈteɪnɪəs/",type:"adjective",def:"Performed without premeditation; natural.",ex:"Spontaneous conversation is the real test of fluency."},
  {word:"Blunt",phonetic:"/blʌnt/",type:"adjective",def:"Uncompromisingly direct; not tactful.",ex:"She was blunt — she told me my accent needed work."},
  {word:"Fluent",phonetic:"/ˈfluːənt/",type:"adjective",def:"Able to express oneself easily and articulately.",ex:"Being fluent means thinking in English, not translating."},
];

const IDIOM_BANK=[
  {phrase:'Hit the nail on the head',meaning:'To describe exactly what is causing a problem',ex:'"You hit the nail on the head — my grammar is the issue."'},
  {phrase:'Under the weather',meaning:'Feeling ill or unwell',ex:'"I am feeling a bit under the weather today."'},
  {phrase:'Break a leg',meaning:'Good luck (used especially before a performance)',ex:'"Break a leg at your interview tomorrow!"'},
  {phrase:'Bite the bullet',meaning:'Endure a painful or difficult situation',ex:'"Just bite the bullet and practise speaking every day."'},
  {phrase:'Burning the midnight oil',meaning:'Working late into the night',ex:'"She was burning the midnight oil studying for her exam."'},
  {phrase:'Beat around the bush',meaning:'To talk vaguely without getting to the point',ex:'"Stop beating around the bush — just say what you mean."'},
  {phrase:'Cost an arm and a leg',meaning:'Be extremely expensive',ex:'"English tutors in big cities can cost an arm and a leg."'},
  {phrase:'Kill two birds with one stone',meaning:'Achieve two things with one action',ex:'"Listening to podcasts while commuting kills two birds with one stone."'},
  {phrase:'The ball is in your court',meaning:'It is now your decision or responsibility',ex:'"I have explained the situation — the ball is in your court now."'},
  {phrase:'Once in a blue moon',meaning:'Very rarely',ex:'"I only use formal English once in a blue moon."'},
];

let currentWotd=null;
let wotdSaved=[];

function loadWotd(forceNew){
  loadXP();
  const savedToday=localStorage.getItem('aria_wotd_date');
  const todayStr=new Date().toDateString();
  if(!forceNew && savedToday===todayStr){
    try{
      const saved=JSON.parse(localStorage.getItem('aria_wotd_word'));
      if(saved&&saved.word){currentWotd=saved;renderWotd();return;}
    }catch(e){}
  }
  // Pick a new word — avoid repeating current
  let idx,tries=0;
  do{idx=Math.floor(Math.random()*WOTD_BANK.length);tries++;}
  while(WOTD_BANK[idx].word===currentWotd?.word && tries<10);
  currentWotd=WOTD_BANK[idx];
  localStorage.setItem('aria_wotd_date',todayStr);
  localStorage.setItem('aria_wotd_word',JSON.stringify(currentWotd));
  renderWotd();
  if(forceNew){
    const btn=document.querySelector('[onclick="loadWotd()"]');
    if(btn){const o=btn.textContent;btn.textContent='✓ New word!';setTimeout(()=>btn.textContent=o,1500);}
  }
}

function renderWotd(){
  if(!currentWotd)return;
  const w=document.getElementById('wotdWord');
  const p=document.getElementById('wotdPhonetic');
  const d=document.getElementById('wotdDef');
  const ex=document.getElementById('wotdEx');
  if(w)w.textContent=currentWotd.word;
  if(p)p.textContent=currentWotd.phonetic+' · '+currentWotd.type;
  if(d)d.textContent=currentWotd.def;
  if(ex)ex.textContent=currentWotd.ex;
}

let wotdSpeaking=false;
function toggleWotdSpeech(){
  if(wotdSpeaking){
    window.speechSynthesis.cancel();
    wotdSpeaking=false;
    const btn=document.getElementById('wotdSpeakBtn');
    if(btn)btn.textContent='🔊 Hear it';
    return;
  }
  speakWotd();
}
function speakWotd(){
  if(!currentWotd||!window.speechSynthesis)return;
  window.speechSynthesis.cancel(); // stop any current speech first
  const utt=new SpeechSynthesisUtterance(currentWotd.word+'. '+currentWotd.def+'. Example: '+currentWotd.ex);
  utt.lang='en-US';utt.rate=0.88;
  wotdSpeaking=true;
  const speakBtn=document.getElementById('wotdSpeakBtn');
  if(speakBtn)speakBtn.textContent='⏹ Stop';
  utt.onend=()=>{wotdSpeaking=false;if(speakBtn)speakBtn.textContent='🔊 Hear it';};
  utt.onerror=()=>{wotdSpeaking=false;if(speakBtn)speakBtn.textContent='🔊 Hear it';};
  const voices=window.speechSynthesis.getVoices();
  const v=voices.find(v=>v.name==='Google US English'||v.name==='Samantha'||(v.lang==='en-US'&&v.localService))||voices.find(v=>v.lang.startsWith('en'));
  if(v)utt.voice=v;
  window.speechSynthesis.speak(utt);
}

function saveWotdToVocab(){
  if(!currentWotd)return;
  const entry={word:currentWotd.word,type:currentWotd.type,def:currentWotd.def,example:currentWotd.ex,source:'Word of the Day',date:new Date().toLocaleDateString()};
  SESSION.vocabTaught.push(entry);
  saveVocabStore(entry);
  earnXP(10,'Word saved to vocab');
  const btn=document.querySelector('[onclick="saveWotdToVocab()"]');
  if(btn){const orig=btn.textContent;btn.textContent='✅ Saved!';setTimeout(()=>btn.textContent=orig,2000);}
}

function loadIdiomOfDay(){
  const idx=new Date().getDate()%IDIOM_BANK.length;
  const idiom=IDIOM_BANK[idx];
  const ip=document.getElementById('idiomPhrase');
  const im=document.getElementById('idiomMeaning');
  const ie=document.getElementById('idiomEx');
  if(ip)ip.textContent='"'+idiom.phrase+'"';
  if(im)im.textContent=idiom.meaning;
  if(ie)ie.textContent=idiom.ex;
}

