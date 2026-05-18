// ══════════════════════════════════════════════
// ALWAYS-ON MIC
// ══════════════════════════════════════════════
async function initMic(){
  try{
    cleanupSpeechSystems({keepState:true});
    mediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,sampleRate:16000}});
    audioContext=new(window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
    analyser=audioContext.createAnalyser();
    analyser.fftSize=512;analyser.smoothingTimeConstant=0.3;
    audioContext.createMediaStreamSource(mediaStream).connect(analyser);
    document.getElementById('sessionTag').textContent=USER.topic.charAt(0).toUpperCase()+USER.topic.slice(1);
    setState('idle');
    startVAD();
    regTimeout('coach-greeting',()=>{
      const greetings={
        beginner:`Hi ${USER.name}! I'm ARIA, your English coach. Just speak naturally — the mic is always on. Let's start easy today. Tell me about your day!`,
        intermediate:`Hey ${USER.name}! Ready to level up? I'm ARIA. We're talking about ${USER.topic} today — I'll push you to use better vocabulary and more natural expressions. What's been on your mind?`,
        advanced:`Good to have you, ${USER.name}. I'm ARIA — I'll be direct and honest with your English today. No sugarcoating. We're covering ${USER.topic}. Give me your best — what's on your mind?`
      };
      ariaSpeak(greetings[USER.level]||greetings.intermediate);
    },700);
  }catch(e){
    console.error('Mic error:',e);
    const mb=$id('micBar');
    if(mb){mb.classList.add('state-muted');const mt=$id('micTitle');if(mt)mt.textContent='Mic blocked — allow in browser settings';}
  }
}

function startVAD(){
  if(!analyser)return;
  if(vadRafHandle)cancelAnimationFrame(vadRafHandle);
  const data=new Uint8Array(analyser.fftSize);
  const SPEAK_TH=20,INTERRUPT_TH=52;
  const SILENCE_SHORT=2200,SILENCE_LONG=3200,MIN_MS=500;
  vadActive=true;
  function tick(){
    if(!vadActive){if(vadRafHandle)cancelAnimationFrame(vadRafHandle);vadRafHandle=null;return;}
    analyser.getByteTimeDomainData(data);
    let sum=0;for(const v of data){const d=v-128;sum+=d*d}
    const rms=Math.sqrt(sum/data.length);
    if(!isMuted){
      if(appState==='listening'){
        if(rms<SPEAK_TH){
          if(speechStarted&&!silenceTimer){
            const spokenMs=Date.now()-speechStartTime;
            clearTimeout(silenceTimer);
            silenceTimer=regTimeout('vad-silence',()=>{
              silenceTimer=null;
              const totalMs=Date.now()-speechStartTime;
              if(totalMs>MIN_MS)stopAndProcess();else cancelRecording();
            },spokenMs>=4000?SILENCE_LONG:SILENCE_SHORT);
          }
        } else {
          clearTimerKey('vad-silence');silenceTimer=null;
          if(!speechStarted){speechStarted=true;speechStartTime=Date.now();}
        }
      } else if((appState==='speaking'||appState==='thinking')&&rms>INTERRUPT_TH){
        handleInterrupt();
      } else if(appState==='idle'&&rms>SPEAK_TH){
        startRec();
      }
    }
    vadRafHandle=requestAnimationFrame(tick);
  }
  vadRafHandle=requestAnimationFrame(tick);
}

function startRec(){
  if(appState!=='idle')return;
  setState('listening');
  speechStarted=false;speechStartTime=0;audioChunks=[];
  const mime=getSupportedMime();
  mediaRecorder=mime?new MediaRecorder(mediaStream,{mimeType:mime}):new MediaRecorder(mediaStream);
  mediaRecorder.ondataavailable=e=>{if(e.data.size>0)audioChunks.push(e.data)};
  mediaRecorder.start(100);
}

async function stopAndProcess(){
  if(!mediaRecorder||mediaRecorder.state==='inactive')return;
  if(appState==='thinking'||appState==='speaking')return; // guard double-fire
  clearTimerKey('vad-silence');silenceTimer=null;
  setState('thinking');
  return new Promise(res=>{
    const mr=mediaRecorder;
    mr.onstop=async()=>{
      if(!audioChunks.length){setState('idle');res();return;}
      const mime=mr.mimeType||'audio/webm';
      const blob=new Blob(audioChunks,{type:mime});
      audioChunks=[];
      lastSpeechDurationMs=Date.now()-speechStartTime;
      const text=await transcribeGroq(blob);
      if(text&&text.trim().length>1){setTx(text.trim(),false);await processLLM(text.trim())}
      else{setState('idle');setTx('Hmm, try speaking a bit louder!',true)}
      res();
    };
    try{mr.stop();}catch(e){setState('idle');res();}
  });
}

function cancelRecording(){
  try{if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop();}catch(e){}
  clearTimerKey('vad-silence');
  speechStarted=false;speechStartTime=0;audioChunks=[];silenceTimer=null;
  setState('idle');
}

function cleanupSpeechSystems(opts){
  opts=opts||{};
  vadActive=false;
  if(vadRafHandle)cancelAnimationFrame(vadRafHandle);
  vadRafHandle=null;
  clearTimerKey('vad-silence');
  clearTimerKey('coach-greeting');
  try{if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop();}catch(e){}
  mediaRecorder=null;audioChunks=[];silenceTimer=null;speechStarted=false;
  cleanupMediaStream(mediaStream);mediaStream=null;
  try{if(audioContext&&audioContext.state!=='closed')audioContext.close();}catch(e){}
  audioContext=null;analyser=null;
  if(window.speechSynthesis)window.speechSynthesis.cancel();
  ttsQueue=[];ttsBusy=false;
  if(!opts.keepState)setState('stopped');
}

function handleInterrupt(){
  if(appState==='thinking')return; // don't interrupt while API is processing
  window.speechSynthesis.cancel();ttsQueue=[];ttsBusy=false;
  setState('idle');
  setTimeout(()=>startRec(),120);
}

function getSupportedMime(){
  for(const t of['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'])
    if(MediaRecorder.isTypeSupported(t))return t;
  return '';
}

// ══════════════════════════════════════════════
// ORB CLICK — tap orb to mute/unmute or resume session
function handleOrbClick(){
  if(appState==='stopped'){
    // Resume from stopped: go to idle so VAD picks up next speech
    if(mediaStream&&audioContext&&audioContext.state!=='closed'){setState('idle');}
  } else if(appState==='speaking'||appState==='thinking'){
    // Interrupt ARIA — stop speech, cancel recording, go idle
    window.speechSynthesis&&window.speechSynthesis.cancel();
    ttsQueue=[];ttsBusy=false;
    cancelRecording&&cancelRecording();
    setState('idle');
  } else {
    // Toggle mute for listening/idle/muted states
    toggleMute();
  }
}

// MUTE & STOP ARIA
// ══════════════════════════════════════════════
function toggleMute(){
  isMuted=!isMuted;
  const btn=document.getElementById('muteBtn');
  if(isMuted){
    if(appState==='listening')cancelRecording();
    btn.textContent='🔇 Unmute';btn.classList.add('muted-on');
    setState('muted');
  } else {
    btn.textContent='🎙️ Mute';btn.classList.remove('muted-on');
    if(appState!=='speaking'&&appState!=='thinking')setState('idle');
  }
}

function stopAria(){
  window.speechSynthesis.cancel();ttsQueue=[];ttsBusy=false;
  document.getElementById('stopAriaBtn').style.display='none';
  setState('idle');
}

function confirmStopSession(){
  document.getElementById('stopConfirmBox').classList.remove('hidden');
}

function cancelStopSession(){
  document.getElementById('stopConfirmBox').classList.add('hidden');
}

// ══════════════════════════════════════════════
// STATE MACHINE
// ══════════════════════════════════════════════
function setState(s){
  appState=s;
  const bar=document.getElementById('micBar');
  const ind=document.getElementById('micInd');
  const title=document.getElementById('micTitle');
  const sub=document.getElementById('micSub');
  const wf=document.getElementById('waveform');
  const wrap=document.getElementById('ariaWrap');
  const face=document.getElementById('ariaFace');
  const lbl=document.getElementById('ariaLbl');
  const stopBtn=$id('stopAriaBtn');

  bar.className='mic-bar state-'+s;
  wrap.className='aria-wrap';wf.className='waveform';
  stopBtn.style.display='none';

  const map={
    idle:{ind:'🎙️',title:'Listening — speak anytime',sub:'ARIA detects your voice automatically',face:'🎓',lbl:'ARIA',wf:''},
    listening:{ind:'🔴',title:'Recording your voice...',sub:'Pause naturally when done — no button needed',face:'👂',lbl:'Listening',wf:'wf-listening'},
    thinking:{ind:'⏳',title:'ARIA is thinking...',sub:'Secure AI processing your message',face:'🤔',lbl:'Thinking',wf:'wf-thinking'},
    speaking:{ind:'🔊',title:'ARIA is speaking',sub:'Speak over ARIA to interrupt immediately',face:'💬',lbl:'Speaking',wf:'wf-speaking'},
    muted:{ind:'🔇',title:'Microphone muted',sub:'Tap Unmute to resume',face:'😴',lbl:'Muted',wf:''},
    stopped:{ind:'⏸️',title:'Session paused',sub:'',face:'🎓',lbl:'ARIA',wf:''},
  };
  const cfg=map[s]||map.idle;
  ind.textContent=cfg.ind;title.textContent=cfg.title;sub.textContent=cfg.sub;
  face.textContent=cfg.face;lbl.textContent=cfg.lbl;
  if(cfg.wf)wf.classList.add(cfg.wf);
  if(s==='listening')wrap.className='aria-wrap listening';
  if(s==='thinking')wrap.className='aria-wrap thinking';
  if(s==='speaking'){wrap.className='aria-wrap speaking';stopBtn.style.display='flex'}
}

function setTx(text,faded){
  const el=document.getElementById('txText');const card=document.getElementById('txCard');
  el.textContent=text;el.className='tx-text'+(faded?' faded':'');
  card.classList.toggle('lit',!faded);
}

// ══════════════════════════════════════════════
// GROQ WHISPER
// ══════════════════════════════════════════════
async function transcribeGroq(blob){
  const form=new FormData();
  const ext=blob.type.includes('mp4')?'mp4':blob.type.includes('ogg')?'ogg':'webm';
  form.append('file',blob,`audio.${ext}`);
  form.append('model','whisper-large-v3-turbo');
  form.append('language','en');
  form.append('response_format','json');
  try{
    const res=await fetch('/api/ai/transcribe',{
      method:'POST',headers:{'Authorization':'Bearer '+GROQ_KEY},body:form
    });
    if(!res.ok){try{const e=await res.json();console.error('STT err',e);}catch(ex){}return ''}
    return (await res.json()).text||'';
  }catch(e){console.error('STT fetch',e);return ''}
}

// ══════════════════════════════════════════════
// GROQ LLaMA — HONEST COACH
// ══════════════════════════════════════════════
function buildSystemPrompt(){
  const memSummary=MEMORY.ariaObservations.slice(-6).join('; ')||'No observations yet';
  const topWeak=Object.entries(MEMORY.weakAreas).filter(([k,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const weakStr=topWeak.map(([k,v])=>k+'(score:'+Math.round(v)+')').join(', ')||'none detected yet';
  const fluencyTrend=MEMORY.fluencyTrend&&MEMORY.fluencyTrend.length>2?(MEMORY.fluencyTrend.at(-1)>MEMORY.fluencyTrend[0]?'improving':'declining'):'unknown';
  const sessionCount=MEMORY.totalSessions||0;
  const recentEmotion=(MEMORY.emotionalSignals||[]).slice(-5);
  const emotionalState=recentEmotion.length
    ? `confidence hedges:${recentEmotion.reduce((a,b)=>a+(b.hedges||0),0)}, anxiety signals:${recentEmotion.filter(e=>e.anxiety).length}, avg pace:${Math.round(recentEmotion.reduce((a,b)=>a+(b.wpm||0),0)/recentEmotion.length)||0} wpm`
    : 'not enough data yet';
  const nativeTips = getNativeLanguageTips ? getNativeLanguageTips() : '';
  return `You are ARIA, a real-time English fluency coach for ${USER.name}. You are warm but HONEST and DIRECT — a great teacher who wants real results, not just to make the student feel good.

STUDENT PROFILE:
- Name: ${USER.name}
- Level: ${USER.level}
- Native language: ${USER.nativeLang||'not specified'}
- Common L1 interference errors for ${USER.nativeLang||'this language'}: ${nativeTips}
  → Actively watch for these specific patterns in every message. Flag them immediately when they appear.
- Goal: ${USER.goal}
- Interests: ${USER.interests.join(', ')}
- Topic today: ${USER.topic}
- Documented weak areas (ranked): ${weakStr}
- Fluency trend across sessions: ${fluencyTrend}
- Recent emotional learning signals: ${emotionalState}
- Sessions completed: ${sessionCount}
- ARIA's memory of this student: ${memSummary}
- Today: ${new Date().toDateString()}

CORE RULES:
1. Reply conversationally in 2-3 SHORT sentences. End with a question to keep the flow.
2. Be genuinely warm — not cold. But NEVER sugarcoat.
3. If they said something factually wrong, correct it clearly. Don't agree to be nice.
4. If they made a grammar mistake, correct it — don't skip it. Be gentle but clear.
5. Praise must be earned and specific ("Your use of 'however' there was smooth" — not "Great job!").
6. If this is a repeated mistake, say so: "We've seen this one before — let's fix it properly."
7. Use contractions, idioms, casual English. Be a person, not a textbook.
8. If the learner sounds hesitant, anxious, or burned out, lower pressure, give one precise next step, and keep your warmth grounded.

After your conversational reply, output EXACTLY this on a new line:
ARIA_JSON:{"reply":"your conversational reply","grammar":[{"wrong":"exact phrase","right":"correct","rule":"brief why","severity":"minor|moderate|major"}],"better":{"used":"what they said","natural":"more native phrasing"},"vocab":{"word":"useful word","type":"noun/verb/adj/phrase","def":"simple definition","example":"short sentence"},"note":"specific honest observation — can critique or genuinely praise","score":7,"observation":"one thing ARIA noticed about this student's pattern to remember"}

JSON RULES:
- grammar: real mistakes only, max 2, empty [] if none
- better: phrasing upgrade or null if fine
- vocab: always 1 useful word (never null)
- note: honest — not generic praise
- score: real 1-10. 5=average, 7=good, 9=near-native. Don't inflate.
- observation: what pattern did you notice? (for personalisation memory)
- All strings on ONE LINE, no line breaks inside values`;
}

async function processLLM(userText){
  SESSION.turns++;SESSION.history.push({role:'user',content:userText});
  const emotionalSignal=detectEmotionalLearningSignal(userText,lastSpeechDurationMs);
  if(SESSION.history.length>20)SESSION.history=SESSION.history.slice(-20);
  addToLog('you',userText);

  try{
    const res=await fetch('/api/ai/chat',{
      method:'POST',headers:{'Authorization':'Bearer '+GROQ_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({model:'llama-3.3-70b-versatile',
        messages:[{role:'system',content:buildSystemPrompt()},...SESSION.history],
        temperature:0.78,max_tokens:480,stream:false})
    });
    if(!res.ok){
      let errMsg='API error';
      try{const e=await res.json();errMsg=e?.error?.message||errMsg;console.error('LLM err',e);}catch(ex){}
      setState('idle');showReply('⚠️ '+errMsg+' — Check the ARIA backend AI proxy configuration');return;
    }
    const data=await res.json();
    const full=data.choices?.[0]?.message?.content||'';
    console.log('LLM:',full);

    let reply='',grammar=[],better=null,vocab=null,note='',score=0,observation='';
    const mi=full.indexOf('ARIA_JSON:');
    if(mi!==-1){
      const before=full.substring(0,mi).trim();
      const after=full.substring(mi+10).trim();
      const bs=after.indexOf('{');
      if(bs!==-1){
        let depth=0,end=-1;
        for(let i=bs;i<after.length;i++){if(after[i]==='{')depth++;else if(after[i]==='}'){depth--;if(depth===0){end=i;break}}}
        if(end!==-1){
          try{
            const fb=JSON.parse(after.substring(bs,end+1));
            reply=fb.reply||before||full;
            grammar=Array.isArray(fb.grammar)?fb.grammar:[];
            better=(fb.better&&fb.better.used)?fb.better:null;
            vocab=(fb.vocab&&fb.vocab.word)?fb.vocab:null;
            note=fb.note||'';score=typeof fb.score==='number'?fb.score:0;
            observation=fb.observation||'';
          }catch(e){reply=before||full.replace(/ARIA_JSON:.*/s,'').trim()}
        }
      } else reply=before||full;
    } else reply=full.trim();
    if(!reply||reply.trim().length<2)reply="That's interesting — tell me more!";

    SESSION.history.push({role:'assistant',content:full});
    SESSION.feedbackLog.push({turn:SESSION.turns,text:userText,grammar,better:better?[better]:[],vocab,note,score});
    SESSION.fluencyHistory.push(score||0);
    if(grammar.length){SESSION.corrections.push(...grammar);SESSION.fixes+=grammar.length}
    if(vocab){
      SESSION.vocabTaught.push(vocab);SESSION.words++;
      saveVocabStore({...vocab,source:'Voice Session',date:new Date().toLocaleDateString()});
    }
    if(observation)updateMemory(observation,grammar,score,emotionalSignal);

    showReply(reply);addToLog('aria',reply);updatePanels(grammar,better?[better]:[],vocab,note,score);
    ariaSpeak(reply);
  }catch(e){reportError('llm-fetch',e);setState('idle');showReply('Network error. Check connection.')}
}

// ══════════════════════════════════════════════
// MEMORY & PERSONALISATION
// ══════════════════════════════════════════════
function detectEmotionalLearningSignal(text,durationMs){
  const words=String(text||'').trim().split(/\s+/).filter(Boolean).length;
  const wpm=durationMs>0?Math.round(words/(durationMs/60000)):0;
  const hedges=(text.match(/\b(um|uh|maybe|i think|not sure|sorry)\b/gi)||[]).length;
  const anxiety=/\b(nervous|anxious|confused|afraid|scared|stuck|tired|burned out|burnt out)\b/i.test(text);
  const confidence=/\b(confident|easy|clear|comfortable|i can)\b/i.test(text);
  return {words,wpm,hedges,anxiety,confidence,durationMs};
}

function updateMemory(observation,grammar,score,emotion){
  MEMORY.totalTurns++;
  // Cap observations at 30, avoid duplicates
  if(observation){
    const isDupe=MEMORY.ariaObservations.some(o=>o.toLowerCase().includes(observation.toLowerCase().slice(0,20)));
    if(!isDupe&&MEMORY.ariaObservations.length<30)MEMORY.ariaObservations.push(observation);
  }
  // Track grammar weakness by error type
  grammar.forEach(g=>{
    const w=g.rule||'grammar';
    const key=w.toLowerCase().includes('tense')?'tenses':w.toLowerCase().includes('article')?'articles':w.toLowerCase().includes('preposition')?'prepositions':w.toLowerCase().includes('plural')?'plurals':'grammar';
    if(g.severity==='major')MEMORY.weakAreas[key]=(MEMORY.weakAreas[key]||0)+2;
    else if(g.severity==='moderate')MEMORY.weakAreas[key]=(MEMORY.weakAreas[key]||0)+1;
    else MEMORY.weakAreas[key]=(MEMORY.weakAreas[key]||0)+0.5;
  });
  // Track fluency trend
  if(score>0){
    if(!MEMORY.fluencyTrend)MEMORY.fluencyTrend=[];
    MEMORY.fluencyTrend.push(score);
    if(MEMORY.fluencyTrend.length>20)MEMORY.fluencyTrend.shift();
    const recentAvg=MEMORY.fluencyTrend.slice(-5).reduce((a,b)=>a+b,0)/Math.min(5,MEMORY.fluencyTrend.length);
    if(recentAvg<5)MEMORY.weakAreas.fluency=(MEMORY.weakAreas.fluency||0)+1;
  }
  if(emotion){
    if(!MEMORY.emotionalSignals)MEMORY.emotionalSignals=[];
    MEMORY.emotionalSignals.push(emotion);
    if(MEMORY.emotionalSignals.length>40)MEMORY.emotionalSignals.shift();
    if(emotion.hedges>=2)MEMORY.weakAreas.confidence=(MEMORY.weakAreas.confidence||0)+0.5;
    if(emotion.anxiety)MEMORY.weakAreas.burnout=(MEMORY.weakAreas.burnout||0)+0.5;
    recordLearningSignal('voice_turn',{score,grammarCount:grammar.length,emotion});
  }
  MEMORY.lastActive=new Date().toDateString();
  saveMemory();
}

function saveMemory(){
  try{localStorage.setItem('aria_memory_'+USER.name,JSON.stringify(MEMORY));}catch(e){}
  recordLearningSignal('memory_update',{
    weakAreas:MEMORY.weakAreas,
    totalSessions:MEMORY.totalSessions||0,
    totalTurns:MEMORY.totalTurns||0,
    fluencyTrend:(MEMORY.fluencyTrend||[]).slice(-10),
    emotionalSignals:(MEMORY.emotionalSignals||[]).slice(-5),
    interests:USER.interests||[]
  });
}

function safeJSONParse(str, fallback){
  if(!str) return fallback;
  try{return JSON.parse(str);}
  catch(e){console.warn('[ARIA] Corrupt localStorage data, using fallback');return fallback;}
}

// Fisher-Yates shuffle — replaces biased Math.random().sort()
function shuffle(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

// ── Centralized timer registry — prevents orphaned intervals/timeouts ──
const _timerReg=new Map(); // key → {id, type}
function regTimeout(key,fn,ms){
  const prev=_timerReg.get(key);if(prev){clearTimeout(prev.id);}
  const id=setTimeout(()=>{_timerReg.delete(key);fn();},ms);
  _timerReg.set(key,{id,type:'timeout'});return id;
}
function regInterval(key,fn,ms){
  const prev=_timerReg.get(key);if(prev){clearInterval(prev.id);}
  const id=setInterval(fn,ms);
  _timerReg.set(key,{id,type:'interval'});return id;
}
function clearTimerKey(key){
  const t=_timerReg.get(key);if(!t)return;
  if(t.type==='timeout')clearTimeout(t.id);else clearInterval(t.id);
  _timerReg.delete(key);
}
function clearAllTimers(){_timerReg.forEach(t=>{if(t.type==='timeout')clearTimeout(t.id);else clearInterval(t.id);});_timerReg.clear();}

function loadMemory(){
  try{
    const savedUser=localStorage.getItem('aria_user');
    if(savedUser){const u=safeJSONParse(savedUser,{});USER={...USER,...u};}
    const saved=localStorage.getItem('aria_memory_'+USER.name);
    if(saved){const m=safeJSONParse(saved,{});MEMORY={...MEMORY,...m};}
    loadVocabStore();
    loadXP();
  }catch(e){console.warn('[ARIA] loadMemory error:',e);}
}

// ══════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════
function showReply(text){document.getElementById('replyText').textContent=text;document.getElementById('replyCard').classList.add('on')}

function updatePanels(grammar,betterArr,vocab,note,score){
  if(score){
    setText('fluencyN',score);
    setStyle('fluencyFill','width',(score*10)+'%');
    const L=['','Very Weak','Weak','Basic','Below Avg','Average','Good','Very Good','Excellent','Outstanding','Native'];
    setText('fluencyLbl',L[score]||'');
    updateSparkline();
  }
  const cl=document.getElementById('corrList');let hadCorr=false;
  if(grammar.length){if(cl.querySelector('.empty-note'))cl.innerHTML='';
    grammar.forEach(g=>{const d=document.createElement('div');d.className='corr-item';
      d.innerHTML=`<div><span class="corr-wrong">"${escapeHTML(g.wrong)}"</span> → <span class="corr-right">"${escapeHTML(g.right)}"</span></div>${g.rule?`<div class="corr-rule">${escapeHTML(g.rule)}</div>`:''}`;
      cl.insertBefore(d,cl.firstChild);hadCorr=true;});
  }
  if(betterArr.length){if(cl.querySelector('.empty-note'))cl.innerHTML='';
    betterArr.forEach(b=>{if(!b||!b.used)return;const d=document.createElement('div');d.className='corr-item';d.style.borderLeftColor='var(--amber)';
      d.innerHTML=`<div><span style="color:var(--text2)">"${escapeHTML(b.used)}"</span> → <span class="corr-right">"${escapeHTML(b.natural)}"</span></div>`;
      cl.insertBefore(d,cl.firstChild);hadCorr=true;});
  }
  if(hadCorr){document.querySelectorAll('.tab-btn').forEach((b,i)=>b.classList.toggle('on',i===0));document.querySelectorAll('.tab-pane').forEach((p,i)=>p.classList.toggle('on',i===0))}
  if(vocab){const vl=document.getElementById('vocabList');
    if(vl.querySelector('.empty-note'))vl.innerHTML='';
    const d=document.createElement('div');d.className='vocab-item';
    d.innerHTML=`<div class="vocab-word">${escapeHTML(vocab.word)} <span style="color:var(--text3);font-size:10.5px;font-weight:400">(${escapeHTML(vocab.type||'')})</span></div><div class="vocab-def">${escapeHTML(vocab.def||'')}</div>${vocab.example?`<div class="vocab-ex">"${escapeHTML(vocab.example)}"</div>`:''}`;
    vl.insertBefore(d,vl.firstChild);
    const items=vl.querySelectorAll('.vocab-item');if(items.length>5)items[items.length-1].remove();
    document.getElementById('vBadge').textContent=SESSION.words;
  }
  if(note){const n=document.getElementById('confNote');n.textContent=(note.match(/great|excellent|perfect|well done/i)?'✨ ':'💡 ')+note;n.classList.add('on')}
  setText('stTurns',SESSION.turns);
  setText('stFixes',SESSION.fixes);
  setText('stWords',SESSION.words);
  if(SESSION.turns>0&&SESSION.turns%5===0)showPronunciationTip();
}

function updateSparkline(){
  const sl=document.getElementById('sparkline');sl.innerHTML='';
  SESSION.fluencyHistory.slice(-12).forEach(s=>{
    const b=document.createElement('div');b.className='spark-b';
    b.style.height=Math.max(5,s*10)+'%';
    b.style.background=`hsl(${Math.round((s/10)*90+20)},72%,50%)`;
    sl.appendChild(b);
  });
}

function addToLog(role,text){
  const log=document.getElementById('convLog');
  if(log.querySelector('.empty-note'))log.innerHTML='';
  const d=document.createElement('div');d.className='log-item';
  d.innerHTML=`<span class="log-role ${role}">${role==='you'?'You':'ARIA'}</span><span class="log-msg">${escapeHTML(text)}</span>`;
  log.appendChild(d);log.scrollTop=log.scrollHeight;
}

function switchTab(btn,paneId){
  const container=btn.closest('.panel-box,.panel-card,#screenQuiz');
  if(container){
    container.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('on'));
    container.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('on'));
  }
  btn.classList.add('on');document.getElementById(paneId).classList.add('on');
}

// ══════════════════════════════════════════════
// TTS — sentence chunked
// ══════════════════════════════════════════════
function ariaSpeak(text){
  if(!window.speechSynthesis){setState('idle');return}
  window.speechSynthesis.cancel();
  if(window.speechSynthesis.paused)window.speechSynthesis.resume();
  ttsQueue=[];ttsBusy=false;
  setState('speaking');
  ttsQueue=(text.match(/[^.!?]+[.!?]*/g)||[text]).map(s=>s.trim()).filter(s=>s.length>0);
  playNextTTS();
}

function playNextTTS(){
  if(ttsQueue.length===0){setState('idle');return}
  const utt=new SpeechSynthesisUtterance(ttsQueue.shift());
  utt.lang='en-US';utt.rate=0.93;utt.pitch=1.05;utt.volume=1;
  const voices=window.speechSynthesis.getVoices();
  const best=voices.find(v=>v.name==='Samantha'||v.name==='Google US English'||v.name==='Karen'||(v.lang==='en-US'&&v.localService))||voices.find(v=>v.lang.startsWith('en'));
  if(best)utt.voice=best;
  utt.onend=()=>{ttsBusy=false;playNextTTS()};
  utt.onerror=()=>{ttsBusy=false;playNextTTS()};
  ttsBusy=true;window.speechSynthesis.speak(utt);
}

// ══════════════════════════════════════════════
// END SESSION & REPORT
// ══════════════════════════════════════════════
function endSession(){
  document.getElementById('stopConfirmBox').classList.add('hidden');
  window.speechSynthesis.cancel();ttsQueue=[];
  vadActive=false;
  if(mediaStream)mediaStream.getTracks().forEach(t=>t.stop());
  if(audioContext&&audioContext.state!=='closed')audioContext.close();
  mediaStream=null;audioContext=null;analyser=null;mediaRecorder=null;
  setState('stopped');
  isMuted=false;
  const mb=$id('muteBtn');if(mb){mb.textContent='🎙️ Mute';mb.classList.remove('muted-on');}
  MEMORY.totalSessions++;saveMemory();
  updateStreak();
  earnXP(30+SESSION.turns*2,'Voice session completed');
  generateReport();
  goScreen('screenReport');
  appState='stopped';
}

function generateReport(){
  if(SESSION.turns===0){document.getElementById('reportContent').innerHTML='<div style="text-align:center;color:var(--text3);font-size:14px;font-style:italic;padding:40px">Complete a voice session to see your report.</div>';return}
  const avg=SESSION.fluencyHistory.length?(SESSION.fluencyHistory.reduce((a,b)=>a+b,0)/SESSION.fluencyHistory.length).toFixed(1):'—';
  const trend=SESSION.fluencyHistory.length>2?(SESSION.fluencyHistory.at(-1)>SESSION.fluencyHistory[0]?'📈 Improving':SESSION.fluencyHistory.at(-1)<SESSION.fluencyHistory[0]?'📉 Needs Focus':'➡️ Steady'):'—';
  setText('reportSub',`${SESSION.turns} turns · ${USER.topic} · ${USER.level} · Avg score ${avg}/10`);
  const ra=$id('reportActions');if(ra)ra.style.display='flex';

  const desc=['','Very Weak','Weak','Basic','Below Avg','Average','Good','Very Good','Excellent','Outstanding','Native'];
  let html=`<div class="r-sec"><div class="r-sec-title">Session Overview</div>
    <div class="ov-grid">
      <div class="ov-box"><div class="ov-val">${SESSION.turns}</div><div class="ov-key">Turns</div></div>
      <div class="ov-box"><div class="ov-val">${avg}</div><div class="ov-key">Avg Fluency</div></div>
      <div class="ov-box"><div class="ov-val">${SESSION.fixes}</div><div class="ov-key">Mistakes Fixed</div></div>
      <div class="ov-box"><div class="ov-val">${SESSION.words}</div><div class="ov-key">Words Learned</div></div>
    </div></div>`;

  if(SESSION.fluencyHistory.length){
    html+=`<div class="r-sec"><div class="r-sec-title">Fluency Per Turn</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">`;
    SESSION.fluencyHistory.forEach((s,i)=>html+=`<span style="background:var(--cream2);border:1px solid var(--border);border-radius:8px;padding:4px 9px;font-size:12px;color:var(--text2)">Turn ${i+1}: <strong style="color:var(--orange)">${s}/10</strong> ${desc[s]||''}</span>`);
    html+=`</div><div style="margin-top:10px;font-size:13px;color:var(--text2)">Trend: ${trend}</div></div>`;
  }

  // Focus areas breakdown
  const gramErr=SESSION.corrections.length;
  const totalTurns=Math.max(1,SESSION.turns);
  const gramPct=Math.min(100,Math.round((gramErr/totalTurns)*50));
  const vocabPct=Math.max(0,100-SESSION.words*10);
  const fluencyPct=Math.round((1-Number(avg)/10)*100);
  html+=`<div class="r-sec"><div class="r-sec-title">Focus Areas Analysis</div>
    <div class="focus-areas">
      <div class="fa-row"><div class="fa-label">Grammar</div><div class="fa-track"><div class="fa-fill ${gramPct>50?'high':gramPct>25?'mid':'good'}" style="width:${gramPct}%"></div></div><div class="fa-pct">${gramPct}%</div></div>
      <div class="fa-row"><div class="fa-label">Vocabulary</div><div class="fa-track"><div class="fa-fill ${vocabPct>60?'mid':'good'}" style="width:${vocabPct}%"></div></div><div class="fa-pct">${vocabPct}%</div></div>
      <div class="fa-row"><div class="fa-label">Fluency</div><div class="fa-track"><div class="fa-fill ${fluencyPct>50?'high':fluencyPct>30?'mid':'good'}" style="width:${fluencyPct}%"></div></div><div class="fa-pct">${fluencyPct}%</div></div>
    </div></div>`;

  if(SESSION.corrections.length){
    html+=`<div class="r-sec"><div class="r-sec-title">Grammar Corrections</div>`;
    SESSION.corrections.forEach(c=>html+=`<div class="r-mistake"><div><span class="rm-wrong">"${c.wrong}"</span> → <span class="rm-right">"${c.right}"</span></div>${c.rule?`<div class="rm-rule">${c.rule}</div>`:''}</div>`);
    html+=`</div>`;
  }

  const allBetter=SESSION.feedbackLog.flatMap(f=>f.better||[]);
  if(allBetter.length){
    html+=`<div class="r-sec"><div class="r-sec-title">More Natural Expressions</div>`;
    allBetter.forEach(b=>{if(b&&b.used)html+=`<div class="r-mistake" style="border-left-color:var(--amber)"><div><span style="color:var(--text2)">"${b.used}"</span> → <span class="rm-right">"${b.natural}"</span></div></div>`});
    html+=`</div>`;
  }

  if(SESSION.vocabTaught.length){
    html+=`<div class="r-sec"><div class="r-sec-title">Vocabulary Learned (${SESSION.vocabTaught.length} words)</div>`;
    SESSION.vocabTaught.forEach(v=>html+=`<div class="r-vocab"><div style="color:var(--amber);font-weight:700;font-size:14px">${v.word} <span style="color:var(--text3);font-size:10.5px;font-weight:400">(${v.type||''})</span></div><div style="color:var(--text2);font-size:12.5px;margin-top:2px">${v.def||''}</div>${v.example?`<div style="font-size:12px;font-style:italic;color:var(--text);margin-top:3px">"${v.example}"</div>`:''}</div>`);
    html+=`</div>`;
  }

  const notes=SESSION.feedbackLog.map(f=>f.note).filter(Boolean);
  if(notes.length){html+=`<div class="r-sec"><div class="r-sec-title">ARIA's Observations</div>`;notes.forEach(n=>html+=`<div class="strength-item">${n}</div>`);html+=`</div>`}

  html+=`<div class="r-sec"><div class="r-sec-title">Overall Assessment</div>
    <div style="font-size:15px;line-height:1.8;color:var(--text)">You completed <strong>${SESSION.turns} turns</strong> on <strong>${USER.topic}</strong>. Average fluency: <strong>${avg}/10</strong>. ${SESSION.corrections.length?`You had ${SESSION.corrections.length} grammar issue${SESSION.corrections.length!==1?'s':''} — review them carefully above.`:'Excellent — very few grammar errors!'} You learned <strong>${SESSION.words}</strong> new word${SESSION.words!==1?'s':''}.</div>
    <div class="final-sc">
      <div class="fsc-box"><div class="fsc-val">${avg}</div><div class="fsc-lbl">Fluency</div></div>
      <div class="fsc-box"><div class="fsc-val">${SESSION.fixes}</div><div class="fsc-lbl">Fixed</div></div>
      <div class="fsc-box"><div class="fsc-val">${SESSION.words}</div><div class="fsc-lbl">Vocab</div></div>
    </div>
    <div class="next-goal-box"><strong>🎯 Next Session Goal:</strong> ${SESSION.corrections.length ? 'Focus on: ' + (SESSION.corrections[0]?.rule || SESSION.corrections[0]?.wrong || 'your top error') + ' — practise before your next session.' : 'Try connectors: although, despite, in contrast — they will push your score higher.'}</div>
  </div>`;

  setHTML('reportContent',html);
  saveSessionToHistory();
}

function saveSessionToHistory(){
  try{
    const sessions=JSON.parse(localStorage.getItem('aria_sessions_'+USER.name)||'[]');
    sessions.unshift({
      date:new Date().toLocaleDateString(),
      turns:SESSION.turns,
      avg:SESSION.fluencyHistory.length?(SESSION.fluencyHistory.reduce((a,b)=>a+b,0)/SESSION.fluencyHistory.length).toFixed(1):0,
      topic:USER.topic,fixes:SESSION.fixes,words:SESSION.words,
      topWord:SESSION.vocabTaught[0]?.word||null
    });
    if(sessions.length>10)sessions.pop();
    localStorage.setItem('aria_sessions_'+USER.name,JSON.stringify(sessions));
  }catch(e){}
}

