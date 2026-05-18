// ══════════════════════════════════════════════
// QUIZ GENERATION
// ══════════════════════════════════════════════
async function generateQuiz(){
  const quizId='quiz_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
  QUIZ_STATE={questions:[],current:0,score:0,answered:false,status:'generating',id:quizId,startedAt:Date.now()};
  startActivity('grammar',{quiz:QUIZ_STATE});
  if(!$id('screenQuiz')?.classList.contains('active'))goScreen('screenQuiz');
  document.getElementById('quizBody').innerHTML='';
  document.getElementById('quizResult').classList.remove('show');
  document.getElementById('quizProgFill').style.width='0%';

  const weakAreas=Object.entries(MEMORY.weakAreas).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>k).join(', ');
  const recentMistakes=SESSION.corrections.slice(-5).map(c=>`"${c.wrong}" → "${c.right}"`).join('; ')||'general grammar';
  const prompt=`Generate 5 multiple choice English quiz questions for a ${USER.level} learner interested in ${USER.interests.slice(0,3).join(', ')}.

Focus on their weak areas: ${weakAreas}
Based on recent mistakes: ${recentMistakes}

Make questions practical and conversational, not textbook-y. Mix grammar, vocabulary, and natural expression.

Output ONLY valid JSON array, no markdown:
[{"q":"question text","opts":["A","B","C","D"],"correct":0,"explain":"why A is correct"}]

correct is the 0-based index of the right answer. All options on one line. No extra text.`;

  document.getElementById('quizSub').textContent='Generating personalised questions...';

  try{
    const res=await fetch('/api/ai/chat',{
      method:'POST',headers:{'Authorization':'Bearer '+GROQ_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'user',content:prompt}],temperature:0.7,max_tokens:1000})
    });
    if(QUIZ_STATE.id!==quizId)return;
    if(!res.ok)throw new Error('Quiz API failed');
    const data=await res.json();
    const raw=data.choices?.[0]?.message?.content||'[]';
    const clean=raw.replace(/```json|```/g,'').trim();
    QUIZ_STATE.questions=normalizeQuizQuestions(JSON.parse(clean));
    if(QUIZ_STATE.questions.length<3)throw new Error('Not enough valid questions');
    QUIZ_STATE.status='active';
    document.getElementById('quizSub').textContent=`${QUIZ_STATE.questions.length} questions based on your weak areas`;
    ACTIVE_ACTIVITY.snapshot={quiz:QUIZ_STATE};persistActivity();
    renderQuizQuestion();
  }catch(e){
    console.error('Quiz gen error',e);
    if(QUIZ_STATE.id!==quizId)return;
    document.getElementById('quizSub').textContent='Using default questions';
    QUIZ_STATE.questions=getDefaultQuestions();
    QUIZ_STATE.status='active';
    ACTIVE_ACTIVITY.snapshot={quiz:QUIZ_STATE};persistActivity();
    renderQuizQuestion();
  }
}

function normalizeQuizQuestions(items){
  if(!Array.isArray(items))return [];
  return items.map(q=>{
    const opts=Array.isArray(q?.opts)?q.opts.map(o=>String(o||'').trim()).filter(Boolean):[];
    const correct=Number(q?.correct);
    return {
      q:String(q?.q||'').trim(),
      opts:opts.slice(0,4),
      correct:Number.isInteger(correct)?correct:0,
      explain:String(q?.explain||'ARIA will explain the pattern after you answer.').trim()
    };
  }).filter(q=>q.q&&q.opts.length>=2&&q.correct>=0&&q.correct<q.opts.length).slice(0,6);
}

function getDefaultQuestions(){
  const baseline=[
    {q:"Which sentence is correct?",opts:["I am going to the market yesterday","I went to the market yesterday","I was go to the market yesterday","I did go the market yesterday"],correct:1,explain:"Use simple past 'went' for completed actions in the past."},
    {q:"Choose the more natural expression:",opts:["Can you say me the time?","Can you tell me the time?","Can you speak me the time?","Can you inform me the time?"],correct:1,explain:"'Tell me' is the natural phrase. 'Say' is used without a person object."},
    {q:"Fill in: 'I've been living here ___ five years.'",opts:["since","for","from","during"],correct:1,explain:"'For' is used with a duration of time. 'Since' is used with a point in time."},
    {q:"What does 'eloquent' mean?",opts:["Loud and aggressive","Fluent and persuasive in speaking","Confused and unclear","Shy and quiet"],correct:1,explain:"Eloquent means able to speak clearly, fluently, and persuasively."},
    {q:"Which is grammatically correct?",opts:["She don't know the answer","She doesn't know the answer","She not know the answer","She isn't know the answer"],correct:1,explain:"Third person singular uses 'doesn't' for negative sentences."}
  ];
  const advanced=[
    {q:"Choose the best connector: 'The proposal is ambitious; ___, it needs clearer evidence.'",opts:["however","because","also","so"],correct:0,explain:"'However' contrasts ambition with a limitation."},
    {q:"Which sentence has the most natural tense sequence?",opts:["If I will know, I tell you","If I knew, I would tell you","If I knowed, I would tell","If I knew, I will tell you"],correct:1,explain:"Second conditional uses past form + would."}
  ];
  return shuffle((USER.level==='advanced'?advanced.concat(baseline):baseline)).slice(0,5);
}

function renderQuizQuestion(){
  const q=QUIZ_STATE.questions[QUIZ_STATE.current];
  if(!q){showQuizResult();return}
  QUIZ_STATE.answered=false;
  const pct=((QUIZ_STATE.current)/QUIZ_STATE.questions.length)*100;
  document.getElementById('quizProgFill').style.width=pct+'%';
  ACTIVE_ACTIVITY.snapshot={quiz:QUIZ_STATE};persistActivity();
  const html=`<div class="quiz-card" id="quizQCard">
    <div class="qnum">Question ${QUIZ_STATE.current+1} of ${QUIZ_STATE.questions.length}</div>
    <div class="qtext">${escapeHTML(q.q)}</div>
    <div class="q-opts">${q.opts.map((o,i)=>`<button class="q-opt" onclick="answerQuiz(${i})">${String.fromCharCode(65+i)}. ${escapeHTML(o)}</button>`).join('')}</div>
    <div class="q-explain" id="qExplain">💡 ${escapeHTML(q.explain)}</div>
  </div>
  <div style="display:flex;justify-content:flex-end;margin-top:10px">
    <button class="btn-sm" id="nextQBtn" style="display:none" onclick="nextQuestion()">Next Question →</button>
  </div>`;
  document.getElementById('quizBody').innerHTML=html;
}

function answerQuiz(idx){
  if(QUIZ_STATE.answered)return;
  QUIZ_STATE.answered=true;
  const q=QUIZ_STATE.questions[QUIZ_STATE.current];
  const opts=document.querySelectorAll('.q-opt');
  opts.forEach((o,i)=>{
    if(i===q.correct)o.classList.add('correct');
    else if(i===idx&&i!==q.correct)o.classList.add('wrong');
    o.onclick=null;
  });
  if(idx===q.correct)QUIZ_STATE.score++;
  else recordLearningSignal('quiz_miss',{question:q.q,selected:q.opts[idx],correct:q.opts[q.correct],level:USER.level});
  document.getElementById('qExplain').classList.add('show');
  document.getElementById('nextQBtn').style.display='block';
  // Track wrong answers to memory
  if(idx!==q.correct)MEMORY.weakAreas.grammar=(MEMORY.weakAreas.grammar||0)+1;
  saveMemory();
  ACTIVE_ACTIVITY.snapshot={quiz:QUIZ_STATE};persistActivity();
}

function nextQuestion(){
  QUIZ_STATE.current++;
  if(QUIZ_STATE.current>=QUIZ_STATE.questions.length)showQuizResult();
  else renderQuizQuestion();
}

function showQuizResult(){
  document.getElementById('quizProgFill').style.width='100%';
  document.getElementById('quizBody').innerHTML='';
  const pct=Math.round((QUIZ_STATE.score/QUIZ_STATE.questions.length)*100);
  if(pct===100){try{localStorage.setItem('aria_quiz_perfect_'+USER.name,'1');}catch(e){}}
  const msgs={90:'Outstanding! You clearly know your stuff.',70:'Good work — a few gaps to fill.',50:'Getting there — keep practising these patterns.',0:'Don\'t worry — mistakes are how we learn. Review the corrections above.'};
  const msg=Object.entries(msgs).reverse().find(([k])=>pct>=Number(k))?.[1]||'Keep going!';
  document.getElementById('resultScore').textContent=`${QUIZ_STATE.score}/${QUIZ_STATE.questions.length}`;
  document.getElementById('resultLabel').textContent=`${pct}% — ${pct>=70?'Well done!':'Keep practising'}`;
  document.getElementById('resultMsg').textContent=msg;
  document.getElementById('quizResult').classList.add('show');
  document.getElementById('dashQuizCount').textContent=QUIZ_STATE.questions.length+' ready';
  QUIZ_STATE.status='complete';
  recordLearningSignal('quiz_complete',{score:QUIZ_STATE.score,total:QUIZ_STATE.questions.length,pct});
  ACTIVE_ACTIVITY={type:null,status:'idle',snapshot:null,updatedAt:Date.now()};
  try{localStorage.removeItem(ACTIVITY_STORAGE_KEY);}catch(e){}
  renderActivityBar();
}

// ══════════════════════════════════════════════
// PODCASTS
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// MASTER RESOURCES DATABASE — 80+ curated learning resources
// Categories: youtube | podcast | book | reading | tool | course
// Levels: beginner | intermediate | advanced | all
// ══════════════════════════════════════════════════════════════
const RESOURCES_DB = [

  // ── YOUTUBE ────────────────────────────────────────────────
  {id:'yt1',type:'youtube',level:'beginner',free:true,lang:'all',
   icon:'🎬',title:'BBC Learning English',
   why:'Structured daily lessons from the world\'s most trusted broadcaster. Short, clear, accent-perfect.',
   url:'https://www.youtube.com/@BBCLearningEnglish',
   tags:['British English','Daily Lessons','Grammar','Vocabulary'],
   featured:true, topics:['daily life','news']},

  {id:'yt2',type:'youtube',level:'beginner',free:true,lang:'all',
   icon:'🎬',title:'EnglishClass101',
   why:'Absolute beginner to advanced — structured video lessons with native speakers. 3,000+ videos.',
   url:'https://www.youtube.com/@EnglishClass101',
   tags:['Structured','Grammar','Speaking'],
   topics:['daily life','travel']},

  {id:'yt3',type:'youtube',level:'intermediate',free:true,lang:'all',
   icon:'🎬',title:'TED-Ed',
   why:'Stunning short animated videos on complex topics. Expand academic vocabulary while being entertained.',
   url:'https://www.youtube.com/@TEDEd',
   tags:['Academic','Vocabulary','Ideas'],
   featured:true, topics:['technology','science','business']},

  {id:'yt4',type:'youtube',level:'intermediate',free:true,lang:'all',
   icon:'🎬',title:'Rachel\'s English',
   why:'The definitive American English pronunciation channel. Mouth positions, stress patterns, linking words.',
   url:'https://www.youtube.com/@rachelsenglish',
   tags:['Pronunciation','American English','Accent'],
   featured:true, topics:['pronunciation']},

  {id:'yt5',type:'youtube',level:'advanced',free:true,lang:'all',
   icon:'🎬',title:'Lex Fridman Podcast (YouTube)',
   why:'4-hour deep conversations with world\'s smartest people. Extreme vocab, complex ideas, natural speed.',
   url:'https://www.youtube.com/@lexfridman',
   tags:['Advanced','Technical','Interviews'],
   topics:['technology','science','philosophy']},

  {id:'yt6',type:'youtube',level:'intermediate',free:true,lang:'all',
   icon:'🎬',title:'English with Lucy',
   why:'British English explained with class and depth. Idioms, phrasal verbs, grammar nuances textbooks skip.',
   url:'https://www.youtube.com/@EnglishwithLucy',
   tags:['British English','Idioms','Grammar'],
   topics:['daily life']},

  {id:'yt7',type:'youtube',level:'beginner',free:true,lang:'indian',
   icon:'🎬',title:'Speak English With Niharika',
   why:'India\'s most popular English teacher. Covers exact mistakes Indian speakers make. Hindi explanations.',
   url:'https://www.youtube.com/@SpeakEnglishWithNiharika',
   tags:['Indian English','Hindi','Mistakes'],
   featured:true, topics:['daily life','career']},

  {id:'yt8',type:'youtube',level:'beginner',free:true,lang:'indian',
   icon:'🎬',title:'TsMadaan',
   why:'Hindi-medium English explained for Indian learners. Grammar made instantly clear.',
   url:'https://www.youtube.com/@TsMadaan',
   tags:['Hindi','Grammar','Indian'],
   topics:['daily life']},

  {id:'yt9',type:'youtube',level:'intermediate',free:true,lang:'all',
   icon:'🎬',title:'Speak English With Vanessa',
   why:'American English for real conversations. Focus on phrases you\'ll actually use every day.',
   url:'https://www.youtube.com/@SpeakEnglishWithVanessa',
   tags:['American English','Conversation','Phrases'],
   topics:['daily life','travel']},

  {id:'yt10',type:'youtube',level:'advanced',free:true,lang:'all',
   icon:'🎬',title:'Patrick Winston — MIT Lectures',
   why:'MIT professor teaching how to speak persuasively. Watch once; speak differently forever.',
   url:'https://www.youtube.com/watch?v=Unzc731iCUY',
   tags:['Public Speaking','MIT','Persuasion'],
   topics:['career','business']},

  {id:'yt11',type:'youtube',level:'intermediate',free:true,lang:'all',
   icon:'🎬',title:'VOA Learning English',
   why:'Voice of America uses simplified English for learners. Real news, slower speed. Transcripts included.',
   url:'https://www.youtube.com/@VOALearningEnglish',
   tags:['News','Slow Speed','Transcripts'],
   topics:['news','daily life']},

  {id:'yt12',type:'youtube',level:'advanced',free:true,lang:'all',
   icon:'🎬',title:'JRE Clips — Joe Rogan',
   why:'Unscripted, diverse, often controversial conversations. Great for slang, idioms, natural fast speech.',
   url:'https://www.youtube.com/@JREClips',
   tags:['Informal','Slang','American'],
   topics:['sports','health','entertainment']},

  // ── PODCASTS ───────────────────────────────────────────────
  {id:'pod1',type:'podcast',level:'beginner',free:true,lang:'all',
   icon:'🎧',title:'6 Minute English — BBC',
   why:'One topic, six minutes, perfect for daily commutes. British pronunciation modelled clearly.',
   url:'https://www.bbc.co.uk/programmes/p02pc9zn/episodes/downloads',
   tags:['BBC','6 Minutes','Vocabulary'],
   featured:true, topics:['daily life','news']},

  {id:'pod2',type:'podcast',level:'beginner',free:true,lang:'all',
   icon:'🎧',title:'Slow English Podcast',
   why:'News read slowly and clearly. Transcripts and vocab lists included. Perfect ear training.',
   url:'https://www.slowenglish.info',
   tags:['Slow Speed','Transcripts','Australian'],
   topics:['news','daily life']},

  {id:'pod3',type:'podcast',level:'beginner',free:true,lang:'all',
   icon:'🎧',title:'Duolingo English Podcast',
   why:'True personal stories told at medium pace with narration. Emotional, engaging, clear.',
   url:'https://podcast.duolingo.com/',
   tags:['Stories','Emotional','Clear Speech'],
   featured:true, topics:['daily life','culture']},

  {id:'pod4',type:'podcast',level:'intermediate',free:true,lang:'all',
   icon:'🎧',title:'All Ears English',
   why:'Dedicated to real American English — idioms, phrasal verbs, natural conversation patterns.',
   url:'https://www.allearsenglish.com',
   tags:['American English','Idioms','Phrasal Verbs'],
   topics:['daily life']},

  {id:'pod5',type:'podcast',level:'intermediate',free:true,lang:'all',
   icon:'🎧',title:'The English We Speak — BBC',
   why:'Short 3-minute episodes explaining one phrase or idiom. The most efficient vocab podcast.',
   url:'https://www.bbc.co.uk/programmes/p02pc9tn',
   tags:['Idioms','3 Minutes','BBC'],
   topics:['daily life']},

  {id:'pod6',type:'podcast',level:'advanced',free:true,lang:'all',
   icon:'🎧',title:'NPR Fresh Air',
   why:'Elite journalism interviews at native speed. Complex topics, rich academic vocabulary.',
   url:'https://www.npr.org/programs/fresh-air/',
   tags:['Journalism','Academic','Native Speed'],
   featured:true, topics:['news','arts','science']},

  {id:'pod7',type:'podcast',level:'advanced',free:true,lang:'all',
   icon:'🎧',title:'How I Built This — NPR',
   why:'Founder stories. Startup vocabulary, business idioms, storytelling in natural American English.',
   url:'https://www.npr.org/podcasts/510313/how-i-built-this',
   tags:['Business','Startups','Storytelling'],
   topics:['business','entrepreneurship']},

  {id:'pod8',type:'podcast',level:'intermediate',free:true,lang:'all',
   icon:'🎧',title:'Stuff You Should Know',
   why:'Two friends explain fascinating topics. Informal conversation at natural speed. Very addictive.',
   url:'https://www.iheart.com/podcast/105-stuff-you-should-know-26940277/',
   tags:['Informal','Conversation','Facts'],
   topics:['science','history','daily life']},

  {id:'pod9',type:'podcast',level:'intermediate',free:true,lang:'all',
   icon:'🎧',title:'TED Talks Daily',
   why:'One brilliant idea per day. Expert vocabulary, structured arguments, powerful public speaking.',
   url:'https://www.ted.com/podcasts/tedtalks_audio',
   tags:['Ideas','Public Speaking','Expert'],
   topics:['technology','business','science']},

  {id:'pod10',type:'podcast',level:'advanced',free:true,lang:'all',
   icon:'🎧',title:'Radiolab',
   why:'Beautiful storytelling about science and philosophy. Exceptional use of descriptive language.',
   url:'https://radiolab.org',
   tags:['Storytelling','Science','Philosophy'],
   topics:['science','philosophy']},

  // ── BOOKS ──────────────────────────────────────────────────
  {id:'bk1',type:'book',level:'intermediate',free:false,lang:'all',
   icon:'📖',title:'English Grammar in Use — Raymond Murphy',
   why:'The gold standard. Every grammar rule explained with exercises. Used by 40 million learners worldwide.',
   url:'https://www.cambridge.org/gb/cambridgeenglish/catalog/grammar-vocabulary-and-pronunciation/english-grammar-use-5th-edition',
   tags:['Grammar','Cambridge','Exercises'],
   featured:true, topics:['grammar']},

  {id:'bk2',type:'book',level:'advanced',free:false,lang:'all',
   icon:'📖',title:'Word Power Made Easy — Norman Lewis',
   why:'Master 3,500 advanced words in 30 days. The vocabulary book that changed millions of careers.',
   url:'https://www.amazon.com/Word-Power-Made-Easy-Vocabulary/dp/1101873833',
   tags:['Vocabulary','Advanced','Classic'],
   featured:true, topics:['vocabulary']},

  {id:'bk3',type:'book',level:'intermediate',free:false,lang:'all',
   icon:'📖',title:'The Elements of Style — Strunk & White',
   why:'84 pages that will transform your English writing forever. Conciseness, clarity, precision.',
   url:'https://www.amazon.com/Elements-Style-William-Strunk-Jr/dp/194564401X',
   tags:['Writing','Style','Classic'],
   topics:['writing','grammar']},

  {id:'bk4',type:'book',level:'beginner',free:false,lang:'all',
   icon:'📖',title:'Oxford Picture Dictionary',
   why:'Visual vocabulary learning. 4,000 words organized by topic with pictures. Perfect for beginners.',
   url:'https://www.amazon.com/Oxford-Picture-Dictionary-English-Vietnamese/dp/0194740765',
   tags:['Vocabulary','Visual','Beginner'],
   topics:['vocabulary','daily life']},

  {id:'bk5',type:'book',level:'advanced',free:false,lang:'all',
   icon:'📖',title:'Business English for Dummies',
   why:'Corporate vocabulary, email etiquette, presentation skills, meeting language. Career essential.',
   url:'https://www.amazon.com/Business-English-Dummies-Jaimie-Bloomer/dp/0764574280',
   tags:['Business','Corporate','Career'],
   topics:['business','career']},

  {id:'bk6',type:'book',level:'intermediate',free:false,lang:'all',
   icon:'📖',title:'Longman Phrasal Verbs Dictionary',
   why:'3,000 phrasal verbs with authentic examples. The most complete reference for natural English.',
   url:'https://www.amazon.com/Longman-Phrasal-Verbs-Dictionary-Paper/dp/0582291771',
   tags:['Phrasal Verbs','Dictionary','Reference'],
   topics:['vocabulary','grammar']},

  {id:'bk7',type:'book',level:'beginner',free:false,lang:'all',
   icon:'📖',title:'English Vocabulary in Use — Elementary',
   why:'Cambridge\'s topic-based vocabulary system. Self-study with answers. Proven approach.',
   url:'https://www.cambridge.org/gb/cambridgeenglish/catalog/grammar-vocabulary-and-pronunciation/english-vocabulary-use-elementary',
   tags:['Vocabulary','Cambridge','Self-Study'],
   topics:['vocabulary']},

  {id:'bk8',type:'book',level:'advanced',free:false,lang:'all',
   icon:'📖',title:'The Art of Public Speaking — Carnegie',
   why:'Dale Carnegie\'s masterclass on confident communication. Still the definitive guide 100 years on.',
   url:'https://www.amazon.com/Public-Speaking-Carnegie-Dale/dp/B093WCNV8D',
   tags:['Speaking','Confidence','Classic'],
   topics:['public speaking','career']},

  // ── READING / ARTICLES ─────────────────────────────────────
  {id:'rd1',type:'reading',level:'intermediate',free:true,lang:'all',
   icon:'📰',title:'The Guardian',
   why:'Quality British journalism. Complex grammar, rich vocabulary, editorial diverse topics.',
   url:'https://www.theguardian.com',
   tags:['British','Journalism','Current Affairs'],
   featured:true, topics:['news','politics','culture']},

  {id:'rd2',type:'reading',level:'advanced',free:false,lang:'all',
   icon:'📰',title:'The New York Times',
   why:'American journalism standard. Op-eds teach argument construction. Culture section for natural idioms.',
   url:'https://www.nytimes.com',
   tags:['American','Journalism','Premium'],
   topics:['news','opinion','culture']},

  {id:'rd3',type:'reading',level:'beginner',free:true,lang:'all',
   icon:'📰',title:'VOA Learning English — News',
   why:'Real news written in simplified English, Level A2-B1. Vocabulary support built in.',
   url:'https://learningenglish.voanews.com',
   tags:['Simple English','News','Free'],
   featured:true, topics:['news','daily life']},

  {id:'rd4',type:'reading',level:'beginner',free:true,lang:'all',
   icon:'📰',title:'Breaking News English',
   why:'Current news adapted to 7 difficulty levels. Download lessons, quizzes, gap-fill exercises.',
   url:'https://breakingnewsenglish.com',
   tags:['Graded Reading','News','Exercises'],
   topics:['news','current affairs']},

  {id:'rd5',type:'reading',level:'intermediate',free:true,lang:'all',
   icon:'📰',title:'BBC News',
   why:'Clear standard British English. Well-structured articles with consistent style. Great for B1-B2.',
   url:'https://www.bbc.com/news',
   tags:['BBC','British English','Structured'],
   topics:['news','world affairs']},

  {id:'rd6',type:'reading',level:'intermediate',free:true,lang:'all',
   icon:'📰',title:'Newsela',
   why:'Any article at 5 reading levels. Switch between levels to see how language changes. Brilliant tool.',
   url:'https://newsela.com',
   tags:['Leveled Reading','Interactive','Education'],
   topics:['news','science','social studies']},

  {id:'rd7',type:'reading',level:'advanced',free:true,lang:'all',
   icon:'📰',title:'The Economist',
   why:'The world\'s most precise English writing. Every sentence is engineered. C1-C2 challenge.',
   url:'https://www.economist.com',
   tags:['Precision','Business','Advanced'],
   featured:true, topics:['business','economics','politics']},

  {id:'rd8',type:'reading',level:'beginner',free:true,lang:'all',
   icon:'📰',title:'Simple English Wikipedia',
   why:'Wikipedia written in 1,000 basic words. Read about anything at your level. Infinite topics.',
   url:'https://simple.wikipedia.org',
   tags:['Simple English','Wikipedia','Topics'],
   topics:['general','science','history']},

  {id:'rd9',type:'reading',level:'intermediate',free:true,lang:'all',
   icon:'📰',title:'TED Ideas Blog',
   why:'Written companion to TED talks. Thoughtful essays on ideas that expand your mind and vocab.',
   url:'https://ideas.ted.com',
   tags:['Essays','Ideas','Thoughtful'],
   topics:['ideas','technology','science']},

  {id:'rd10',type:'reading',level:'intermediate',free:true,lang:'all',
   icon:'📰',title:'Graded Readers — Oxford Bookworms',
   why:'Classic literature adapted to 6 levels. Read Sherlock Holmes or Jane Austen at your pace.',
   url:'https://elt.oup.com/catalogue/items/global/graded_readers/oxford_bookworms_library/',
   tags:['Literature','Graded','Classic'],
   topics:['literature','culture']},

  // ── TOOLS ──────────────────────────────────────────────────
  {id:'tl1',type:'tool',level:'all',free:true,lang:'all',
   icon:'🔧',title:'YouGlish',
   why:'Type any word, hear it used by native speakers in real YouTube videos. Context, pronunciation, stress.',
   url:'https://youglish.com',
   tags:['Pronunciation','Context','Video'],
   featured:true, topics:['pronunciation','vocabulary']},

  {id:'tl2',type:'tool',level:'all',free:true,lang:'all',
   icon:'🔧',title:'Anki Flashcards',
   why:'The scientifically proven spaced-repetition system. Make your own cards or download 50,000+ decks.',
   url:'https://apps.ankiweb.net',
   tags:['Spaced Repetition','Flashcards','Science'],
   featured:true, topics:['vocabulary','grammar']},

  {id:'tl3',type:'tool',level:'all',free:true,lang:'all',
   icon:'🔧',title:'Grammarly',
   why:'Real-time grammar and style feedback as you write. Learn from corrections, don\'t just fix them.',
   url:'https://www.grammarly.com',
   tags:['Grammar','Writing','Real-time'],
   topics:['writing','grammar']},

  {id:'tl4',type:'tool',level:'intermediate',free:true,lang:'all',
   icon:'🔧',title:'DeepL Translator',
   why:'The most accurate translator. Compare your sentences with DeepL\'s natural English versions.',
   url:'https://www.deepl.com',
   tags:['Translation','Comparison','Accuracy'],
   topics:['translation','writing']},

  {id:'tl5',type:'tool',level:'all',free:true,lang:'all',
   icon:'🔧',title:'Forvo Pronunciation Dictionary',
   why:'Hear any word pronounced by native speakers from 20 countries. Never mispronounce again.',
   url:'https://forvo.com',
   tags:['Pronunciation','Native Speakers','Dictionary'],
   topics:['pronunciation']},

  {id:'tl6',type:'tool',level:'all',free:true,lang:'all',
   icon:'🔧',title:'Ludwig.guru',
   why:'Find natural sentences using any phrase. Shows real examples from published literature and journalism.',
   url:'https://ludwig.guru',
   tags:['Collocation','Natural English','Examples'],
   topics:['writing','vocabulary']},

  {id:'tl7',type:'tool',level:'intermediate',free:true,lang:'all',
   icon:'🔧',title:'Reverso Context',
   why:'See any phrase translated with real examples from movies and books. Context-aware dictionary.',
   url:'https://context.reverso.net',
   tags:['Context','Translation','Examples'],
   topics:['vocabulary','translation']},

  {id:'tl8',type:'tool',level:'all',free:true,lang:'all',
   icon:'🔧',title:'Playphrase.me',
   why:'Type a phrase, watch native speakers say it in movie clips. The most fun pronunciation tool.',
   url:'https://playphrase.me',
   tags:['Movies','Pronunciation','Fun'],
   featured:true, topics:['pronunciation','informal English']},

  {id:'tl9',type:'tool',level:'all',free:false,lang:'all',
   icon:'🔧',title:'ELSA Speak',
   why:'AI pronunciation coach with phoneme-level feedback. Best mobile app for accent reduction.',
   url:'https://elsaspeak.com',
   tags:['AI','Pronunciation','Mobile App'],
   topics:['pronunciation','accent']},

  {id:'tl10',type:'tool',level:'all',free:true,lang:'all',
   icon:'🔧',title:'Netspeak',
   why:'Find the right word in English using partial phrases. Backed by billions of sentences.',
   url:'https://netspeak.org',
   tags:['Word Choice','Writing','Suggestions'],
   topics:['writing','vocabulary']},

  // ── COURSES ────────────────────────────────────────────────
  {id:'cr1',type:'course',level:'beginner',free:true,lang:'all',
   icon:'🎓',title:'Coursera — Learn English: Intermediate Grammar',
   why:'UC Irvine\'s structured grammar specialization. Certificates, peer review, university-level quality.',
   url:'https://www.coursera.org/specializations/intermediate-grammar',
   tags:['University','Certificate','Grammar'],
   featured:true, topics:['grammar']},

  {id:'cr2',type:'course',level:'intermediate',free:false,lang:'all',
   icon:'🎓',title:'British Council — Online English Courses',
   why:'The world\'s most trusted English institution. Live classes, certified teachers, structured paths.',
   url:'https://www.britishcouncil.org/english/online-courses',
   tags:['Certified','Live Classes','British'],
   topics:['general English','grammar','speaking']},

  {id:'cr3',type:'course',level:'advanced',free:false,lang:'all',
   icon:'🎓',title:'Udemy — Business English Communication Skills',
   why:'Comprehensive business English from emails to negotiations. 4.7 stars, 50,000+ students.',
   url:'https://www.udemy.com/course/business-english-communication/',
   tags:['Business','Communication','Certificate'],
   topics:['business','career','writing']},

  {id:'cr4',type:'course',level:'intermediate',free:true,lang:'all',
   icon:'🎓',title:'edX — Effective Business Communication',
   why:'Learn professional written and spoken English from top universities. Free to audit.',
   url:'https://www.edx.org/learn/communication/rochester-institute-of-technology-effective-business-communication',
   tags:['Business','Free','University'],
   topics:['business','writing','communication']},

  {id:'cr5',type:'course',level:'beginner',free:true,lang:'indian',
   icon:'🎓',title:'NPTEL — Spoken English for Indian Learners',
   why:'IIT professors teaching English to Indian learners. Government certified, completely free.',
   url:'https://nptel.ac.in/courses/109104141',
   tags:['IIT','Free','Indian','Certification'],
   featured:true, topics:['speaking','grammar']},

  {id:'cr6',type:'course',level:'advanced',free:false,lang:'all',
   icon:'🎓',title:'Toastmasters International',
   why:'The world\'s #1 public speaking organization. Join local chapters to practice with real humans.',
   url:'https://www.toastmasters.org',
   tags:['Public Speaking','Club','Practice'],
   topics:['public speaking','career','confidence']},

  {id:'cr7',type:'course',level:'intermediate',free:true,lang:'all',
   icon:'🎓',title:'BBC Learning English — Grammar Reference',
   why:'Free, comprehensive grammar reference with exercises. BBC quality, zero cost.',
   url:'https://www.bbc.co.uk/learningenglish/english/grammar',
   tags:['Grammar','BBC','Free'],
   topics:['grammar']},

  {id:'cr8',type:'course',level:'advanced',free:false,lang:'all',
   icon:'🎓',title:'IELTS / TOEFL Prep — Magoosh',
   why:'Data-driven test prep with proven score improvements. Track record with millions of test-takers.',
   url:'https://magoosh.com',
   tags:['IELTS','TOEFL','Exam Prep'],
   topics:['exams','academic English']},
];

// ══════════════════════════════════════════════
// RESOURCES ENGINE — State
// ══════════════════════════════════════════════
let _resCurrentCat = 'all';
let _resCurrentLvl = 'all';

// ══════════════════════════════════════════════
// RESOURCES ENGINE — Render
// ══════════════════════════════════════════════
function renderResources() {
  _renderFeatured();
  _renderGrid();
  _updateSubtitle();
}

function switchResCat(btn) {
  document.querySelectorAll('#resCatBar .res-cat').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  _resCurrentCat = btn.dataset.cat || 'all';
  _renderGrid();
  _updateSubtitle();
}

function switchResLvl(btn) {
  document.querySelectorAll('#resLevelBar .res-lvl').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  _resCurrentLvl = btn.dataset.lvl || 'all';
  _renderGrid();
  _updateSubtitle();
}

function setResFilter(btn, lvl) { switchResLvl(btn); } // compat alias

function _getFiltered() {
  return RESOURCES_DB.filter(r => {
    const catOk = _resCurrentCat === 'all' || r.type === _resCurrentCat;
    const lvlOk = _resCurrentLvl === 'all' || r.level === _resCurrentLvl || r.level === 'all';
    return catOk && lvlOk;
  });
}

function _scoredResources() {
  const userLang = (USER.nativeLang || '').toLowerCase();
  const isIndian = ['hindi','gujarati','marathi','punjabi','tamil','telugu','bengali','kannada','malayalam'].some(l => userLang.includes(l));
  const interests = (USER.interests || []).map(i => i.toLowerCase());

  return RESOURCES_DB.map(r => {
    let score = 0;
    // Level match
    if (r.level === USER.level) score += 5;
    else if (r.level === 'all') score += 3;
    else if (
      (USER.level === 'intermediate' && r.level !== 'beginner') ||
      (USER.level === 'advanced' && r.level !== 'beginner')
    ) score += 1;
    // Language match
    if (r.lang === 'indian' && isIndian) score += 4;
    // Topic / interest match
    if (r.topics && interests.length) {
      const match = r.topics.some(t => interests.some(i => t.toLowerCase().includes(i.split(' ')[0]) || i.includes(t)));
      if (match) score += 3;
    }
    // Featured bonus
    if (r.featured) score += 2;
    return { ...r, score };
  }).sort((a, b) => b.score - a.score);
}

function _renderFeatured() {
  const row = document.getElementById('resFeaturedRow');
  if (!row) return;
  const featured = _scoredResources().filter(r => r.featured || r.score >= 8).slice(0, 6);
  if (!featured.length) {
    const sec = document.getElementById('resFeaturedSection');
    if (sec) sec.style.display = 'none';
    return;
  }
  const typeLabel = { youtube: '▶️ YouTube', podcast: '🎧 Podcast', book: '📖 Book', reading: '📰 Article', tool: '🔧 Tool', course: '🎓 Course' };
  row.innerHTML = featured.map(r => `
    <a class="res-feat-card" href="${escapeHTML(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHTML(r.title)}">
      <div class="res-feat-type"><span>${typeLabel[r.type] || r.type}</span></div>
      <div class="res-feat-icon">${r.icon}</div>
      <div class="res-feat-title">${escapeHTML(r.title)}</div>
      <div class="res-feat-why">${escapeHTML(r.why)}</div>
      <div class="res-feat-badge">${r.level === 'all' ? 'All Levels' : r.level.charAt(0).toUpperCase() + r.level.slice(1)}</div>
    </a>`).join('');
}

function _renderGrid() {
  const grid = document.getElementById('resMainGrid');
  if (!grid) return;
  const items = _resCurrentCat === 'all' && _resCurrentLvl === 'all'
    ? _scoredResources()
    : _getFiltered().map(r => ({ ...r, score: 0 }));

  const labelEl = document.getElementById('resGridLabel');
  if (labelEl) {
    const catNames = { all: 'All Resources', youtube: 'YouTube Channels', podcast: 'Podcasts', book: 'Books', reading: 'Articles & Reading', tool: 'Tools', course: 'Courses' };
    labelEl.textContent = catNames[_resCurrentCat] + (items.length ? ` (${items.length})` : '');
  }

  if (!items.length) {
    grid.innerHTML = '<div class="res-no-results">No resources found for this filter. <button class="btn-sm" onclick="switchResCat(document.querySelector(\'.res-cat\'))">Show all</button></div>';
    return;
  }

  const typeLabel = { youtube: 'YouTube', podcast: 'Podcast', book: 'Book', reading: 'Article', tool: 'Tool', course: 'Course' };
  const lvlLabel = { beginner: 'A1–A2', intermediate: 'B1–B2', advanced: 'C1–C2', all: 'All Levels' };
  const lvlClass = { beginner: 'beg', intermediate: 'int', advanced: 'adv', all: 'beg' };

  grid.innerHTML = items.map(r => `
    <a class="res-card" href="${escapeHTML(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHTML(r.title)}">
      <div class="res-card-top">
        <div class="res-card-meta">
          <span class="res-card-emoji" aria-hidden="true">${r.icon}</span>
          <span class="res-card-type res-type-${r.type}">${typeLabel[r.type] || r.type}</span>
          <span class="res-card-level res-lvl-${lvlClass[r.level] || 'int'}">${lvlLabel[r.level] || r.level}</span>
        </div>
        <div class="res-card-title">${escapeHTML(r.title)}</div>
        <div class="res-card-why">${escapeHTML(r.why)}</div>
      </div>
      <div class="res-card-tags">
        ${(r.tags || []).slice(0, 4).map(t => `<span class="res-tag ${t === 'Free' ? 'free' : t === 'Paid' ? 'paid' : ''}">${escapeHTML(t)}</span>`).join('')}
        ${r.free ? '<span class="res-tag free">Free</span>' : '<span class="res-tag paid">Paid</span>'}
      </div>
    </a>`).join('');
}

function _updateSubtitle() {
  const sub = document.getElementById('resourcesSub');
  if (!sub) return;
  const lvlText = _resCurrentLvl === 'all' ? 'all levels' : _resCurrentLvl;
  const catText = _resCurrentCat === 'all' ? 'all categories' : _resCurrentCat + 's';
  sub.textContent = `Showing ${catText} for ${lvlText} — personalised for your level and interests`;
}

// compat: called from goScreen
function switchResourceTab(btn, pane) {
  // Legacy shim — delegates to new cat switcher
  const catMap = { resAll: 'all', resYoutube: 'youtube', resPodcast: 'podcast', resBooks: 'book', resReading: 'reading', resTools: 'tool', resCourses: 'course' };
  const cat = catMap[pane] || 'all';
  const catBtn = document.querySelector('[data-cat="' + cat + '"]');
  if (catBtn) switchResCat(catBtn);
}



