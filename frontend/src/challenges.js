// ══════════════════════════════════════════════
// SPEED CHALLENGE — You vs ARIA
// ══════════════════════════════════════════════
const SPEED_QUESTIONS=[
  {q:'What is the past tense of "go"?',hint:'Irregular verb',a:'went'},
  {q:'Complete: "She ___ to school every day."',hint:'Present simple',a:'goes'},
  {q:'What does "verbose" mean?',hint:'It relates to talking',a:'using more words than needed'},
  {q:'Complete: "I have ___ this movie before." (see)',hint:'Present perfect',a:'seen'},
  {q:'What is the opposite of "generous"?',hint:'Think about money',a:'stingy'},
  {q:'Complete: "If I ___ you, I would study more." (be)',hint:'Second conditional',a:'were'},
  {q:'What does "procrastinate" mean?',hint:'Many students do this before exams',a:'delay or postpone'},
  {q:'Complete: "She ___ for 2 hours already." (wait)',hint:'Present perfect continuous',a:'has been waiting'},
  {q:'What is a synonym for "happy"?',hint:'Sounds like "cheer"',a:'cheerful'},
  {q:'What does "eloquent" mean?',hint:'A great speaker is this',a:'fluent and persuasive'},
];

let speedState={yourScore:0,ariaScore:0,qIdx:0,timer:null,ariaTimer:null,answered:false};

function startSpeedChallenge(resumeState){
  cleanupActivity('all');
  startActivity('speed',resumeState?{speed:resumeState}:null);
  document.getElementById('speedChallenge').classList.add('active');
  document.getElementById('fillBlank').classList.remove('active');
  document.getElementById('idiomChallenge').classList.remove('active');
  document.getElementById('quizBody').innerHTML='';
  document.getElementById('quizResult').classList.remove('show');
  speedState=resumeState||{yourScore:0,ariaScore:0,qIdx:0,timer:null,ariaTimer:null,answered:false};
  document.getElementById('scYou').textContent='0';
  document.getElementById('scAria').textContent='0';
  document.getElementById('speedResult').style.display='none';
  document.getElementById('speedGameArea').style.display='block';
  nextSpeedQ();
}

function nextSpeedQ(){
  if(speedState.yourScore>=5||speedState.ariaScore>=5){showSpeedResult();return}
  if(speedState.qIdx>=SPEED_QUESTIONS.length)speedState.qIdx=0;
  const q=SPEED_QUESTIONS[speedState.qIdx++];
  speedState.answered=false;
  document.getElementById('speedQ').textContent=q.q;
  document.getElementById('speedHint').textContent='Hint: '+q.hint;
  document.getElementById('speedInput').value='';
  document.getElementById('speedInput').disabled=false;
  document.getElementById('speedInput').focus();
  // Timer
  let t=10;document.getElementById('speedTimer').textContent=t;
  document.getElementById('speedTimer').className='speed-timer';
  clearInterval(speedState.timer);
  speedState.timer=regInterval('speed-countdown',()=>{
    t--;document.getElementById('speedTimer').textContent=t;
    if(t<=3)document.getElementById('speedTimer').className='speed-timer urgent';
    if(t<=0){clearTimerKey('speed-countdown');if(!speedState.answered)ariaAnswers(q);}
  },1000);
  // ARIA answers after random delay 4-8s (simulating thinking)
  clearTimerKey('speed-aria-answer');
  const ariaDelay=(4+Math.random()*4)*1000;
  speedState.ariaTimer=regTimeout('speed-aria-answer',()=>{if(!speedState.answered)ariaAnswers(q);},ariaDelay);
  ACTIVE_ACTIVITY.snapshot={speed:speedState};persistActivity();
}

function submitSpeed(){
  if(speedState.answered)return;
  const q=SPEED_QUESTIONS[speedState.qIdx-1];
  const ans=document.getElementById('speedInput').value.trim().toLowerCase();
  const correct=q.a.toLowerCase();
  const isRight=ans&&(ans===correct||correct.includes(ans)||ans.includes(correct.split(' ')[0]));
  clearTimerKey('speed-countdown');clearTimerKey('speed-aria-answer');
  speedState.answered=true;
  document.getElementById('speedInput').disabled=true;
  if(isRight){
    speedState.yourScore++;
    document.getElementById('scYou').textContent=speedState.yourScore;
    showFlash('✅ You got it! (+1)','var(--green)');
    earnXP(15,'Speed challenge correct!');
  } else {
    showFlash('❌ Wrong — correct: '+q.a,'var(--red)');
    // ARIA also gets a point when user is wrong (after delay)
    regTimeout('speed-wrong-score',()=>{speedState.ariaScore++;document.getElementById('scAria').textContent=speedState.ariaScore;},600);
  }
  ACTIVE_ACTIVITY.snapshot={speed:speedState};persistActivity();
  regTimeout('speed-next',nextSpeedQ,1800);
}

function ariaAnswers(q){
  if(speedState.answered)return;
  clearTimerKey('speed-countdown');
  speedState.answered=true;
  speedState.ariaScore++;
  document.getElementById('scAria').textContent=speedState.ariaScore;
  document.getElementById('speedInput').disabled=true;
  showFlash('🤖 ARIA answered first! Correct: '+q.a,'var(--amber)');
  ACTIVE_ACTIVITY.snapshot={speed:speedState};persistActivity();
  regTimeout('speed-next',nextSpeedQ,1800);
}

function showFlash(msg,color){
  const el=document.getElementById('speedHint');
  const orig=el.textContent;
  el.style.color=color;el.style.fontWeight='700';el.textContent=msg;
  regTimeout('speed-flash',()=>{el.style.color='';el.style.fontWeight='';el.textContent=orig;},1600);
}

function showSpeedResult(){
  clearTimerKey('speed-countdown');clearTimerKey('speed-aria-answer');clearTimerKey('speed-next');
  document.getElementById('speedGameArea').style.display='none';
  document.getElementById('speedResult').style.display='block';
  const won=speedState.yourScore>=speedState.ariaScore;
  document.getElementById('winnerEmoji').textContent=won?'🏆':'🤖';
  document.getElementById('winnerText').textContent=won?'You beat ARIA!':'ARIA wins this round!';
  document.getElementById('winnerSub').textContent='You: '+speedState.yourScore+' — ARIA: '+speedState.ariaScore+(won?' Great job!':' Keep practising — you will get there!');
  if(won){earnXP(50,'Beat ARIA in Speed Challenge!');try{localStorage.setItem('aria_speed_win_'+USER.name,'1');}catch(e){}}
  else earnXP(20,'Completed Speed Challenge');
  recordLearningSignal('speed_complete',{yourScore:speedState.yourScore,ariaScore:speedState.ariaScore,won});
  ACTIVE_ACTIVITY={type:null,status:'idle',snapshot:null,updatedAt:Date.now()};
  try{localStorage.removeItem(ACTIVITY_STORAGE_KEY);}catch(e){}
  renderActivityBar();
}

// ══════════════════════════════════════════════
// FILL IN THE BLANK
// ══════════════════════════════════════════════
const FILL_QUESTIONS=[
  {sentence:'She has been studying English ___ three years.',blank:'for',opts:['for','since','during','from'],explain:'"For" is used with duration. "Since" is used with a point in time (e.g. since 2020).'},
  {sentence:'I ___ rather stay home than go out tonight.',blank:'would',opts:['will','would','should','could'],explain:'"Would rather" is the correct fixed expression for preference.'},
  {sentence:'By the time he arrives, we ___ finished eating.',blank:'will have',opts:['will have','will be','have','had'],explain:'Future perfect: will have + past participle for an action completed before a future moment.'},
  {sentence:'She speaks English as ___ as a native speaker.',blank:'fluently',opts:['fluent','fluently','fluency','fluentness'],explain:'After "as...as" with a verb (speaks), use an adverb: fluently.'},
  {sentence:'___ you mind closing the window?',blank:'Would',opts:['Could','Would','Do','Shall'],explain:'"Would you mind" is the most polite form. "Could you mind" is incorrect.'},
  {sentence:'He apologised ___ being late.',blank:'for',opts:['for','of','about','to'],explain:'"Apologise for" is the correct preposition. "Apologise about" is informal but common.'},
  {sentence:'The report needs to be ___ by Friday.',blank:'submitted',opts:['submit','submitting','submitted','submission'],explain:'After "needs to be", use the past participle (passive voice).'},
  {sentence:'I am looking forward ___ meeting you.',blank:'to',opts:['to','for','at','of'],explain:'"Look forward to" + verb-ing. The "to" here is a preposition, not part of the infinitive.'},
];

let fillState={qIdx:0,score:0,answered:false};

function startFillBlank(resumeState){
  cleanupActivity('all');
  startActivity('fill',resumeState?{fill:resumeState}:null);
  document.getElementById('fillBlank').classList.add('active');
  document.getElementById('speedChallenge').classList.remove('active');
  document.getElementById('idiomChallenge').classList.remove('active');
  document.getElementById('quizBody').innerHTML='';
  document.getElementById('quizResult').classList.remove('show');
  fillState=resumeState||{qIdx:0,score:0,answered:false};
  document.getElementById('fillResult').style.display='none';
  renderFillQ();
}

function renderFillQ(){
  if(fillState.qIdx>=FILL_QUESTIONS.length){showFillResult();return}
  const q=FILL_QUESTIONS[fillState.qIdx];
  fillState.answered=false;
  document.getElementById('fillQNum').textContent=fillState.qIdx+1;
  const sent=escapeHTML(q.sentence).replace('___','<span style="color:var(--orange);font-weight:700;border-bottom:2.5px solid var(--orange);padding:0 4px">___</span>');
  document.getElementById('fillSentence').innerHTML=sent;
  document.getElementById('fillExplain').style.display='none';
  document.getElementById('fillNextBtn').style.display='none';
  const opts=document.getElementById('fillOpts');
  const shuffled=shuffle(q.opts);
  opts.innerHTML=shuffled.map(o=>'<button class="fill-opt" onclick="answerFill(this,this.textContent)">'+escapeHTML(o)+'</button>').join('');
  ACTIVE_ACTIVITY.snapshot={fill:fillState};persistActivity();
}

function answerFill(el,ans){ans=ans||el.textContent;
  if(fillState.answered)return;
  fillState.answered=true;
  const q=FILL_QUESTIONS[fillState.qIdx];
  document.querySelectorAll('.fill-opt').forEach(b=>{
    b.classList.toggle('correct',b.textContent===q.blank);
    if(b===el&&b.textContent!==q.blank)b.classList.add('wrong');
  });
  if(ans===q.blank){fillState.score++;earnXP(10,'Fill in blank correct');}
  else recordLearningSignal('fill_miss',{sentence:q.sentence,selected:ans,correct:q.blank});
  const ex=document.getElementById('fillExplain');
  ex.textContent='💡 '+q.explain;ex.style.display='block';
  document.getElementById('fillNextBtn').style.display='inline-block';
}

function nextFill(){fillState.qIdx++;ACTIVE_ACTIVITY.snapshot={fill:fillState};persistActivity();renderFillQ();}

function showFillResult(){
  document.getElementById('fillResult').style.display='block';
  const pct=Math.round(fillState.score/FILL_QUESTIONS.length*100);
  document.getElementById('fillResultEmoji').textContent=pct>=80?'🎉':pct>=50?'👍':'📚';
  document.getElementById('fillResultText').textContent=fillState.score+'/'+FILL_QUESTIONS.length+' correct ('+pct+'%)';
  earnXP(25,'Completed Fill in the Blank');
  recordLearningSignal('fill_complete',{score:fillState.score,total:FILL_QUESTIONS.length,pct});
  ACTIVE_ACTIVITY={type:null,status:'idle',snapshot:null,updatedAt:Date.now()};
  try{localStorage.removeItem(ACTIVITY_STORAGE_KEY);}catch(e){}
  renderActivityBar();
}

// ══════════════════════════════════════════════
// IDIOM MASTER CHALLENGE
// ══════════════════════════════════════════════
const IDIOM_QUESTIONS=[
  {idiom:'Under the weather',ctx:'Used when talking about health',opts:['Feeling ill','Enjoying rain','Being outside','Feeling scared'],correct:0,explain:'This idiom means feeling sick or unwell, not literally related to weather.'},
  {idiom:'Bite the bullet',ctx:'Used in difficult situations',opts:['Eat fast food','Endure something painful','Shoot a gun','Speak too fast'],correct:1,explain:'To "bite the bullet" means to bravely face something painful or difficult.'},
  {idiom:'Hit the nail on the head',ctx:'Used when someone is exactly right',opts:['Hurt your thumb','Fix something','Say exactly the right thing','Work hard'],correct:2,explain:'This means to be exactly correct or to identify the precise problem.'},
  {idiom:'Break the ice',ctx:'Used in social situations',opts:['Break something cold','Start a conversation','Finish a meeting','Leave a room'],correct:1,explain:'To "break the ice" means to do or say something to ease tension in a social situation.'},
  {idiom:'Once in a blue moon',ctx:'Used to describe frequency',opts:['Every month','Never','Very rarely','Once a week'],correct:2,explain:'A "blue moon" is rare; so this idiom means something that happens very infrequently.'},
  {idiom:'Burn bridges',ctx:'Used in relationships or work',opts:['Start a fire','Destroy future opportunities','Build connections','Travel far'],correct:1,explain:'To "burn bridges" means to permanently damage a relationship or close off future opportunities.'},
];

let idiomChalState={qIdx:0,score:0};

function startIdiomChallenge(resumeState){
  cleanupActivity('all');
  startActivity('idiom',resumeState?{idiom:resumeState}:null);
  document.getElementById('idiomChallenge').classList.add('active');
  document.getElementById('speedChallenge').classList.remove('active');
  document.getElementById('fillBlank').classList.remove('active');
  document.getElementById('quizBody').innerHTML='';
  document.getElementById('quizResult').classList.remove('show');
  idiomChalState=resumeState||{qIdx:0,score:0};
  document.getElementById('idiomResult').style.display='none';
  renderIdiomQ();
}

function renderIdiomQ(){
  if(idiomChalState.qIdx>=IDIOM_QUESTIONS.length){showIdiomResult();return}
  const q=IDIOM_QUESTIONS[idiomChalState.qIdx];
  document.getElementById('idiomQNum').textContent=idiomChalState.qIdx+1;
  document.getElementById('idiomChalQ').textContent='"'+q.idiom+'"';
  document.getElementById('idiomChalCtx').textContent=q.ctx;
  document.getElementById('idiomExplain').style.display='none';
  document.getElementById('idiomNextBtn').style.display='none';
  const opts=document.getElementById('idiomOpts');
  opts.innerHTML=q.opts.map((o,i)=>'<button class="fill-opt" style="border-color:rgba(107,63,160,0.2)" onclick="answerIdiom(this,'+i+')">'+escapeHTML(o)+'</button>').join('');
  ACTIVE_ACTIVITY.snapshot={idiom:idiomChalState};persistActivity();
}

function answerIdiom(el,idx){
  const q=IDIOM_QUESTIONS[idiomChalState.qIdx];
  document.querySelectorAll('#idiomOpts .fill-opt').forEach((b,i)=>{
    b.classList.toggle('correct',i===q.correct);
    if(b===el&&i!==q.correct)b.classList.add('wrong');
  });
  if(idx===q.correct){idiomChalState.score++;earnXP(12,'Idiom challenge correct');}
  else recordLearningSignal('idiom_miss',{idiom:q.idiom,selected:q.opts[idx],correct:q.opts[q.correct]});
  document.getElementById('idiomExplain').textContent='💡 '+q.explain;
  document.getElementById('idiomExplain').style.display='block';
  document.getElementById('idiomNextBtn').style.display='inline-block';
}

function nextIdiomQ(){idiomChalState.qIdx++;ACTIVE_ACTIVITY.snapshot={idiom:idiomChalState};persistActivity();renderIdiomQ();}

function showIdiomResult(){
  document.getElementById('idiomResult').style.display='block';
  const pct=Math.round(idiomChalState.score/IDIOM_QUESTIONS.length*100);
  document.getElementById('idiomResultText').textContent='Score: '+idiomChalState.score+'/'+IDIOM_QUESTIONS.length+' ('+pct+'%) — '+(pct>=80?'Idiom Master! 🏆':pct>=50?'Getting there 👍':'Keep practising 📚');
  earnXP(30,'Completed Idiom Master');
  recordLearningSignal('idiom_complete',{score:idiomChalState.score,total:IDIOM_QUESTIONS.length,pct});
  ACTIVE_ACTIVITY={type:null,status:'idle',snapshot:null,updatedAt:Date.now()};
  try{localStorage.removeItem(ACTIVITY_STORAGE_KEY);}catch(e){}
  renderActivityBar();
}

// XP/WOTD/idiom rendered directly in updateDash

// XP/streak awarded at session end — called from endSession directly


// ══════════════════════════════════════════════
// STEELMAN DEBATE ARENA — STATE & LOGIC
// ══════════════════════════════════════════════
let DEBATE={topic:'',topicId:'',question:'',stanceA:'',stanceB:'',steelA:'',steelB:'',empathyA:'',empathyB:'',userSide:'',ariaSide:'',history:[],turn:0,userScore:0,ariaScore:0,debatesCompleted:0,verdictRequested:false};

function selectDebateTopic(el,id,name,question){
  document.querySelectorAll('.debate-topic-card').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  DEBATE.topicId=id;DEBATE.topic=name;DEBATE.question=question;
  const ci=document.getElementById('debateCustomInput');if(ci)ci.value='';
  // Reset stances so they regenerate cleanly
  DEBATE.stanceA='';DEBATE.stanceB='';
  generateSteelmanStances();
}

function useCustomDebateTopic(){
  const val=document.getElementById('debateCustomInput').value.trim();
  if(!val)return;
  document.querySelectorAll('.debate-topic-card').forEach(c=>c.classList.remove('selected'));
  DEBATE.topicId='custom';DEBATE.topic=val;DEBATE.question=val;
  DEBATE.stanceA='';DEBATE.stanceB='';
  document.querySelectorAll('.debate-topic-card').forEach(c=>c.classList.remove('selected'));
  generateSteelmanStances();
}

async function generateSteelmanStances(){
  if(!GROQ_KEY){alert('Please enter your Groq API key first on the setup screen.');return}
  const section=document.getElementById('sideChooserSection');
  section.style.display='block';
  section.scrollIntoView({behavior:'smooth',block:'nearest'});
  document.getElementById('sideStanceA').textContent='Generating...';
  document.getElementById('sideStanceB').textContent='Generating...';
  document.getElementById('steelmanSection').style.display='none';
  document.getElementById('startDebateBtn').disabled=true;
  document.getElementById('sideCardA').classList.remove('chosen');
  document.getElementById('sideCardB').classList.remove('chosen');
  const prompt=`For the debate topic: "${DEBATE.question}"\nReturn ONLY valid JSON:\n{"stanceA":"One sentence: the PRO / FOR position label (10-15 words)","stanceB":"One sentence: the CON / AGAINST position label (10-15 words)"}`;
  try{
    const res=await fetch('/api/ai/chat',{method:'POST',headers:{'Authorization':'Bearer '+GROQ_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'user',content:prompt}],temperature:0.4,max_tokens:120})});
    const data=await res.json();
    const raw=data.choices?.[0]?.message?.content||'';
    const jm=raw.match(/\{[\s\S]*\}/);
    if(!jm)throw new Error('no json');
    const parsed=JSON.parse(jm[0]);
    DEBATE.stanceA=parsed.stanceA||'FOR the proposition';
    DEBATE.stanceB=parsed.stanceB||'AGAINST the proposition';
  }catch(e){
    DEBATE.stanceA='FOR: '+DEBATE.topic;
    DEBATE.stanceB='AGAINST: '+DEBATE.topic;
  }
  document.getElementById('sideStanceA').textContent=DEBATE.stanceA;
  document.getElementById('sideStanceB').textContent=DEBATE.stanceB;
  document.getElementById('steelStanceA').textContent=DEBATE.stanceA;
  document.getElementById('steelStanceB').textContent=DEBATE.stanceB;
}

function chooseSide(side){
  DEBATE.userSide=side;DEBATE.ariaSide=side==='A'?'B':'A';
  document.getElementById('sideCardA').classList.toggle('chosen',side==='A');
  document.getElementById('sideCardB').classList.toggle('chosen',side==='B');
  document.getElementById('steelmanSection').style.display='block';
  document.getElementById('steelmanSection').scrollIntoView({behavior:'smooth',block:'nearest'});
  generateFullSteelmans();
}

async function generateFullSteelmans(){
  document.getElementById('steelContentA').innerHTML='<span class="sp-loading">Crafting steelman for Side A...</span>';
  document.getElementById('steelContentB').innerHTML='<span class="sp-loading">Crafting steelman for Side B...</span>';
  document.getElementById('steelEmpathyA').style.display='none';
  document.getElementById('steelEmpathyB').style.display='none';
  document.getElementById('startDebateBtn').disabled=true;
  const prompt=`You are an expert at steel-manning arguments. For the debate: "${DEBATE.question}"\nSide A: ${DEBATE.stanceA}\nSide B: ${DEBATE.stanceB}\nGenerate the STRONGEST possible case for each side — the absolute best arguments.\nAlso write a short "experiential empathy" paragraph starting with "Imagine you grew up..." for each side.\nReturn ONLY valid JSON:\n{"steelA":"3-4 sentences","steelB":"3-4 sentences","empathyA":"2-3 sentences starting with Imagine you grew up...","empathyB":"2-3 sentences starting with Imagine you grew up..."}`;
  try{
    const res=await fetch('/api/ai/chat',{method:'POST',headers:{'Authorization':'Bearer '+GROQ_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'user',content:prompt}],temperature:0.65,max_tokens:700})});
    const data=await res.json();
    const raw=data.choices?.[0]?.message?.content||'';
    const jm=raw.match(/\{[\s\S]*\}/);
    if(!jm)throw new Error('parse fail');
    const parsed=JSON.parse(jm[0]);
    DEBATE.steelA=parsed.steelA||'';DEBATE.steelB=parsed.steelB||'';
    DEBATE.empathyA=parsed.empathyA||'';DEBATE.empathyB=parsed.empathyB||'';
    document.getElementById('steelContentA').textContent=DEBATE.steelA;
    document.getElementById('steelContentB').textContent=DEBATE.steelB;
    if(DEBATE.empathyA){const ea=document.getElementById('steelEmpathyA');ea.textContent='💭 '+DEBATE.empathyA;ea.style.display='block'}
    if(DEBATE.empathyB){const eb=document.getElementById('steelEmpathyB');eb.textContent='💭 '+DEBATE.empathyB;eb.style.display='block'}
    document.getElementById('startDebateBtn').disabled=false;
  }catch(e){
    document.getElementById('steelContentA').textContent='Could not generate. Check your Groq key.';
    document.getElementById('steelContentB').textContent='Could not generate. Check your Groq key.';
  }
}

function startLiveDebate(){
  DEBATE.history=[];DEBATE.turn=0;DEBATE.userScore=0;DEBATE.ariaScore=0;DEBATE.verdictRequested=false;
  const ariaStance=DEBATE.ariaSide==='A'?DEBATE.stanceA:DEBATE.stanceB;
  const userStance=DEBATE.userSide==='A'?DEBATE.stanceA:DEBATE.stanceB;
  document.getElementById('arenaTitle').innerHTML='Debate: <em>'+escapeHTML(DEBATE.topic)+'</em>';
  document.getElementById('arenaMeta').textContent='ARIA defends "'+ariaStance.substring(0,50)+'..."';
  document.getElementById('arenaBadgeYou').textContent='You: '+(DEBATE.userSide==='A'?'🔵 Side A':'🟣 Side B');
  document.getElementById('arenaBadgeAria').textContent='ARIA: '+(DEBATE.ariaSide==='A'?'🔵 Side A':'🟣 Side B');
  document.getElementById('arenaTurnCount').textContent='Turn 1';
  document.getElementById('verdictPanel').classList.remove('show');
  document.getElementById('debateChat').innerHTML='';
  document.getElementById('debateInput').value='';
  document.getElementById('debateSendBtn').disabled=false;
  document.getElementById('debateArena').classList.add('active');
  document.getElementById('debateArena').scrollIntoView({behavior:'smooth'});
  // Store opening user prompt in history for proper alternation
  const openingPrompt = 'Please open the debate with your strongest opening statement for: '+DEBATE.question+'. Be punchy and direct — 3-4 sentences. End with a sharp question for me.';
  DEBATE.history.push({role:'user', content: openingPrompt});
  fetchDebateAI(DEBATE.history.slice(), 'opening', null);
}

function buildDebateSystemPrompt(){
  const ariaStance=DEBATE.ariaSide==='A'?DEBATE.stanceA:DEBATE.stanceB;
  const ariaSteelman=DEBATE.ariaSide==='A'?DEBATE.steelA:DEBATE.steelB;
  return `Debate student background: interests include ${USER.interests.join(', ')}. Native language: ${USER.nativeLang||'not specified'}. Level: ${USER.level}.

You are ARIA, an AI debate partner arguing FIRMLY for: "${ariaStance}"\nTopic: ${DEBATE.question}\nYour steelmanned position: ${ariaSteelman}\n\nRULES:\n1. ALWAYS maintain your assigned position — never switch sides.\n2. Give sharp, specific arguments with facts and examples.\n3. Directly respond to what the user said before making your own point.\n4. Keep responses to 3-5 sentences. Be punchy.\n5. If user makes a WEAK argument, call it out respectfully.\n6. If user makes a STRONG point, acknowledge then counter: "Fair point — but consider..."\n7. End EVERY response with a pointed question.\n\nAfter your debate response, on a NEW LINE output EXACTLY:\nDEBATE_JSON:{"reply":"your response","strength":7,"counter_question":"the question you asked"}`;
}

// ══ DEBATE VOICE MODE ══
let debateVoiceActive=false, debateVoiceRecorder=null, debateVoiceStream=null, debateVoiceChunks=[];

function toggleDebateVoice(){
  if(debateVoiceActive) stopDebateVoice();
  else startDebateVoice();
}

async function startDebateVoice(){
  if(!GROQ_KEY){alert('Groq API key needed');return}
  try{
    debateVoiceStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    debateVoiceChunks=[];
    const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t))||'';
    debateVoiceRecorder=mime?new MediaRecorder(debateVoiceStream,{mimeType:mime}):new MediaRecorder(debateVoiceStream);
    debateVoiceRecorder.ondataavailable=e=>{if(e.data.size>0)debateVoiceChunks.push(e.data)};
    debateVoiceRecorder.onstop=async()=>{
      if(debateVoiceStream)debateVoiceStream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(debateVoiceChunks,{type:debateVoiceRecorder.mimeType||'audio/webm'});
      const ext=blob.type.includes('mp4')?'mp4':blob.type.includes('ogg')?'ogg':'webm';
      const form=new FormData();form.append('file',blob,'debate.'+ext);form.append('model','whisper-large-v3-turbo');form.append('language','en');form.append('response_format','json');
      document.getElementById('debateVoiceStatus').textContent='Transcribing...';
      try{
        const res=await fetch('/api/ai/transcribe',{method:'POST',headers:{'Authorization':'Bearer '+GROQ_KEY},body:form});
        const data=await res.json();
        const text=data.text||'';
        if(text.trim()){
          document.getElementById('debateInput').value=text.trim();
          document.getElementById('debateVoiceStatus').textContent='Transcribed — review and send, or speak again';
        } else {
          document.getElementById('debateVoiceStatus').textContent='Did not catch that — try again';
        }
      }catch(e){document.getElementById('debateVoiceStatus').textContent='Transcription error';}
      debateVoiceActive=false;
      document.getElementById('debateVoiceBtn').textContent='🎙️';
      document.getElementById('debateVoiceBtn').style.background='var(--cream)';
    };
    debateVoiceRecorder.start(100);
    debateVoiceActive=true;
    document.getElementById('debateVoiceBtn').textContent='⏹';
    document.getElementById('debateVoiceBtn').style.background='var(--orange-pale)';
    document.getElementById('debateVoiceBtn').style.borderColor='var(--orange)';
    document.getElementById('debateVoiceStatus').textContent='🔴 Recording — tap ⏹ to stop and transcribe';
  }catch(e){alert('Mic access needed for voice mode');console.error(e);}
}

function stopDebateVoice(){
  if(debateVoiceRecorder&&debateVoiceRecorder.state!=='inactive')debateVoiceRecorder.stop();
  debateVoiceActive=false;
}

let _debateSending=false;
async function sendDebateMessage(){
  if(_debateSending)return;
  const input=document.getElementById('debateInput');
  const text=input.value.trim();
  if(!text||!GROQ_KEY)return;
  _debateSending=true;
  input.value='';autoResizeDebateInput(input);
  const sb=document.getElementById('debateSendBtn');
  if(sb)sb.disabled=true;
  DEBATE.turn++;
  document.getElementById('arenaTurnCount').textContent='Turn '+DEBATE.turn;
  const userStrength=estimateArgumentStrength(text);
  DEBATE.userScore+=userStrength;
  addDebateBubble('user',text,userStrength);
  const thinkId=addDebateThinkingBubble();
  DEBATE.history.push({role:'user',content:text});
  // Ensure alternation: if last 2 are both user, trim
  const msgs=DEBATE.history.slice(-12);
  await fetchDebateAI(msgs,'debate',thinkId);
  document.getElementById('debateSendBtn').disabled=false;
  document.getElementById('debateInput').focus();
}

async function fetchDebateAI(msgs,mode,thinkBubbleId){
  const systemPrompt=buildDebateSystemPrompt();
  try{
    const res=await fetch('/api/ai/chat',{
      method:'POST',
      headers:{'Authorization':'Bearer '+GROQ_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'llama-3.3-70b-versatile',
        messages:[{role:'system',content:systemPrompt},...msgs],
        temperature:0.75,
        max_tokens:500
      })
    });
    if(!res.ok){
      const err=await res.json();
      throw new Error('Groq error: '+(err.error?.message||res.status));
    }
    const data=await res.json();
    const full=(data.choices?.[0]?.message?.content||'').trim();
    if(!full) throw new Error('Empty response from AI');

    // Parse reply and strength — DEBATE_JSON is optional
    let reply=full, ariaStrength=7;
    const djIdx=full.indexOf('DEBATE_JSON:');
    if(djIdx!==-1){
      const before=full.substring(0,djIdx).trim();
      const jsonStr=full.substring(djIdx+12).trim();
      const bs=jsonStr.indexOf('{');
      if(bs!==-1){
        let depth=0,endIdx=-1;
        for(let i=bs;i<jsonStr.length;i++){
          if(jsonStr[i]==='{')depth++;
          else if(jsonStr[i]==='}'){depth--;if(depth===0){endIdx=i;break}}
        }
        if(endIdx!==-1){
          try{
            const parsed=JSON.parse(jsonStr.substring(bs,endIdx+1));
            reply=(parsed.reply||before||full).trim();
            ariaStrength=typeof parsed.strength==='number'?Math.min(10,Math.max(1,parsed.strength)):7;
          }catch(e){ reply=before||full; }
        } else { reply=before||full; }
      } else { reply=before||full; }
    }

    if(!reply) reply=full; // final fallback

    DEBATE.ariaScore+=ariaStrength;
    // Push assistant reply to history (user message was already pushed before calling)
    DEBATE.history.push({role:'assistant',content:reply});

    if(thinkBubbleId){const el=document.getElementById(thinkBubbleId);if(el)el.remove();}
    const ariaSideClass=DEBATE.ariaSide==='A'?'ai-bubble-a':'ai-bubble-b';
    addDebateBubble('aria',reply,ariaStrength,ariaSideClass);
    updateArgMeter(ariaStrength);
    // Enable send button after ARIA responds
    const sb=document.getElementById('debateSendBtn');
    if(sb)sb.disabled=false;
    _debateSending=false;
  }catch(e){
    console.error('Debate AI error:',e);
    if(thinkBubbleId){const el=document.getElementById(thinkBubbleId);if(el)el.remove();}
    addDebateBubble('aria','⚠️ Error: '+e.message+' — check your API key and connection.',0);
    const sb=document.getElementById('debateSendBtn');
    if(sb)sb.disabled=false;
    _debateSending=false;
  }
}

function addDebateBubble(role,text,strength,bubbleClass){
  const chat=document.getElementById('debateChat');
  const div=document.createElement('div');
  div.className='debate-msg '+(role==='user'?'user-msg':'');
  const bc=bubbleClass||(role==='user'?'user-bubble':'ai-bubble-neutral');
  const roleTag=role==='user'?'You':'ARIA';
  const roleColor=role==='user'?'color:var(--brown)':'color:var(--green)';
  const strengthBar=strength>0?`<div style="font-size:10px;margin-top:5px;opacity:.7">${'▓'.repeat(Math.round(strength/2))}${'░'.repeat(5-Math.round(strength/2))} ${strength}/10</div>`:'';
  div.innerHTML=`<div class="dm-avatar ${role==='user'?'user-avatar-dm':'ai-avatar'}">${role==='user'?'👤':'🎓'}</div><div class="dm-bubble ${bc}"><div class="dm-role-tag" style="${roleColor}">${escapeHTML(roleTag)}</div>${escapeHTML(text)}${strengthBar}</div>`;
  chat.appendChild(div);
  // Use instant scroll for new messages to prevent jank
  chat.scrollTop=chat.scrollHeight;
}

function addDebateThinkingBubble(){
  const id='think_'+Date.now();
  const chat=document.getElementById('debateChat');
  const div=document.createElement('div');
  div.className='debate-msg';div.id=id;
  div.innerHTML=`<div class="dm-avatar ai-avatar">🎓</div><div class="dm-bubble ai-bubble-neutral"><div class="dm-role-tag" style="color:var(--green)">ARIA</div><span class="dm-thinking">Formulating counter-argument...</span></div>`;
  chat.appendChild(div);
  chat.scrollTop=chat.scrollHeight;
  return id;
}

function estimateArgumentStrength(text){
  let score=5;
  const words=text.split(/\s+/).length;
  if(words>40)score+=1;if(words>80)score+=1;
  if(/because|evidence|study|research|data|fact|example|according|statistics|shows|proves|historically|expert/i.test(text))score+=1;
  if(/therefore|however|furthermore|moreover|consequently|although|despite|in contrast|on the other hand/i.test(text))score+=1;
  if(text.includes('?'))score-=0.5;
  return Math.min(10,Math.max(1,Math.round(score)));
}

function updateArgMeter(strength){
  const bars=document.querySelectorAll('#argBars .arg-bar');
  bars.forEach((bar,i)=>{
    const filled=i<Math.round(strength*bars.length/10);
    const hue=filled?Math.round((strength/10)*90+20):0;
    bar.style.height=filled?(30+strength*4)+'%':'15%';
    bar.style.background=filled?`hsl(${hue},65%,50%)`:'var(--border2)';
    bar.style.transition='all 0.4s ease '+(i*0.04)+'s';
  });
}

async function requestDebateVerdict(){
  if(DEBATE.verdictRequested&&DEBATE.verdictDone)return;
  DEBATE.verdictRequested=true;
  document.getElementById('verdictPanel').classList.add('show');
  document.getElementById('verdictAnalysis').textContent='Analysing the debate...';
  document.getElementById('verdictScoreA').textContent='...';
  document.getElementById('verdictScoreB').textContent='...';
  document.getElementById('verdictPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
  const userStance=DEBATE.userSide==='A'?DEBATE.stanceA:DEBATE.stanceB;
  const ariaStance=DEBATE.ariaSide==='A'?DEBATE.stanceA:DEBATE.stanceB;
  const transcriptStr=DEBATE.history.slice(1).map(m=>(m.role==='user'?'USER':'ARIA')+': '+m.content).join('\n\n');
  const verdictPrompt=`You are an impartial debate judge. Topic: "${DEBATE.question}"\nUser argued: "${userStance}"\nARIA argued: "${ariaStance}"\n\nTRANSCRIPT:\n${transcriptStr}\n\nScore each 1-10 on: logic, evidence, engagement, persuasiveness.\nReturn ONLY valid JSON:\n{"userScore":7,"ariaScore":8,"userFeedback":"2-3 sentences on user performance","winner":"user|aria|draw","keyInsight":"One key insight","bestArgument":"The strongest argument made"}`;
  try{
    const res=await fetch('/api/ai/chat',{method:'POST',headers:{'Authorization':'Bearer '+GROQ_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'user',content:verdictPrompt}],temperature:0.35,max_tokens:400})});
    const data=await res.json();
    const raw=data.choices?.[0]?.message?.content||'';
    const jm=raw.match(/\{[\s\S]*\}/);
    if(!jm)throw new Error('no json');
    const v=JSON.parse(jm[0]);
    const winnerEmoji=v.winner==='user'?'🏆 You Won!':v.winner==='aria'?'🤖 ARIA Won':'🤝 Draw!';
    document.getElementById('verdictScoreA').textContent=v.userScore+'/10';
    document.getElementById('verdictScoreB').textContent=v.ariaScore+'/10';
    document.getElementById('verdictStanceA').textContent='You — '+userStance.substring(0,28)+'...';
    document.getElementById('verdictStanceB').textContent='ARIA — '+ariaStance.substring(0,28)+'...';
    document.getElementById('verdictAnalysis').innerHTML=`<div style="font-size:16px;font-weight:700;color:var(--orange);margin-bottom:8px">${escapeHTML(winnerEmoji)}</div><div style="margin-bottom:8px"><strong>Your Performance:</strong> ${escapeHTML(v.userFeedback||'')}</div><div style="margin-bottom:8px"><strong>Key Insight:</strong> ${escapeHTML(v.keyInsight||'')}</div><div style="font-style:italic;color:var(--text3)">"${escapeHTML(v.bestArgument||'')}"</div>`;
    DEBATE.debatesCompleted++;
    try{
      const key='aria_debates_'+USER.name;
      const prev=JSON.parse(localStorage.getItem(key)||'[]');
      prev.unshift({topic:DEBATE.topic,date:new Date().toLocaleDateString(),userScore:v.userScore,winner:v.winner});
      localStorage.setItem(key,JSON.stringify(prev.slice(0,20)));
      const el=document.getElementById('dashDebateCount');
      if(el)el.textContent=prev.length+' debate'+(prev.length!==1?'s':'');
    }catch(e){}
    DEBATE.verdictDone=true;
    earnXP(25+(v.winner==='user'?25:10),'Completed steelman debate');
    if(typeof markDebateDone==='function')markDebateDone();
  }catch(e){
    console.error('Verdict error',e);
    const va=$id('verdictAnalysis');
    if(va) va.innerHTML='<div style="color:var(--red)">Could not generate verdict: '+escapeHTML(e.message)+'</div><div style="margin-top:8px;color:var(--text2)">Your debate was saved. Check your API key and connection, then retry.</div>';
    DEBATE.verdictRequested=false; // allow retry
  }
}

function markDebateDone(){try{localStorage.setItem('aria_debate_done_'+USER.name,'1');}catch(e){}}
function resetDebate(){
  DEBATE.history=[];DEBATE.turn=0;DEBATE.verdictRequested=false;
  document.getElementById('debateArena').classList.remove('active');
  document.getElementById('steelmanSection').style.display='none';
  document.getElementById('sideChooserSection').style.display='none';
  document.querySelectorAll('.debate-topic-card').forEach(c=>c.classList.remove('selected'));
  document.getElementById('debateCustomInput').value='';
  window.scrollTo({top:0,behavior:'smooth'});
}

function switchSidesDebate(){
  const prevUser=DEBATE.userSide;
  DEBATE.userSide=prevUser==='A'?'B':'A';
  DEBATE.ariaSide=DEBATE.userSide==='A'?'B':'A';
  startLiveDebate();
  // ARIA opens fresh with new stance - already called in startLiveDebate via fetchDebateAI
}

function autoResizeDebateInput(el){
  el.style.height='auto';
  el.style.height=Math.min(el.scrollHeight,140)+'px';
}

function updateDebateDashStat(){
  try{
    if(!$id('dashDebateCount'))return;
    const debates=JSON.parse(localStorage.getItem('aria_debates_'+USER.name)||'[]');
    const el=document.getElementById('dashDebateCount');
    if(el)el.textContent=debates.length+' debate'+(debates.length!==1?'s':'');
  }catch(e){}
}

// ── Daily Challenge ──
function startDailyChallenge(){
  const today=new Date().toDateString();
  const done=localStorage.getItem('aria_daily_'+USER.name);
  if(done===today){
    const el=document.getElementById('dashDailyStatus');
    if(el){el.textContent='✅ Done today';setTimeout(()=>{el.textContent='Ready today'},2000)}
    return;
  }
  const weak=Object.entries(MEMORY.weakAreas||{}).sort((a,b)=>b[1]-a[1])[0]?.[0]||'grammar';
  if(weak==='grammar')generateQuiz();
  else if(weak==='vocabulary')startFillBlank();
  else startIdiomChallenge();
  localStorage.setItem('aria_daily_'+USER.name,today);
  const el=document.getElementById('dashDailyStatus');
  if(el)el.textContent='✅ Done today';
  earnXP(20,'Daily challenge completed');
}

// ── Pronunciation tip ──
async function showPronunciationTip(){
  const box=document.getElementById('pronTipBox');
  const tip=document.getElementById('pronTipText');
  if(!box||!tip)return;
  box.style.display='block';
  tip.textContent='Loading tip...';
  const nativeLang=USER.nativeLang||'Hindi';
  const recent=SESSION.corrections.slice(-2).map(c=>c.wrong).join(', ')||'general English';
  const prompt=`Give ONE very specific pronunciation tip for a ${nativeLang} speaker learning English. Make it practical about a specific sound. Context: recent errors included: ${recent}. Keep it to 2-3 sentences. Start with the phoneme or pattern name.`;
  try{
    const res=await fetch('/api/ai/chat',{method:'POST',headers:{'Authorization':'Bearer '+GROQ_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'user',content:prompt}],temperature:0.5,max_tokens:120})});
    const data=await res.json();
    tip.textContent=data.choices?.[0]?.message?.content||'Focus on clear vowel sounds.';
  }catch(e){tip.textContent='Try recording yourself and comparing to a native speaker!'}
}


