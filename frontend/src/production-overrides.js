/* ARIA production runtime overlay.
   Keeps the original UI intact while replacing unsafe frontend-only systems with backend-backed realtime, AI proxying, and automatic WebRTC signaling. */
(function () {
  const PROD = {
    config: null,
    ws: null,
    wsReady: false,
    wsBackoffMs: 600,
    wsTimer: null,
    playerId: getOrCreatePlayerId(),
    sessionToken: getStoredSessionToken(),
    room: null,
    players: [],
    events: [],
    call: {
      room: null,
      mode: 'video',
      pc: null,
      localStream: null,
      remoteStream: null,
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
      makingOffer: false,
      ignoreOffer: false,
      polite: true,
      started: false,
      _pendingCandidates: []
    },
    answeredQuestions: new Set(),
    lastSnapshotVersion: 0
  };
  window.ARIA_PRODUCTION = PROD;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function productionFetch(input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    if (url && /^https:\/\/api\.groq\.com\/openai\/v1\//i.test(url)) {
      const isTranscribe = /\/audio\/transcriptions/i.test(url);
      const target = isTranscribe ? '/api/ai/transcribe' : '/api/ai/chat';
      const nextInit = { ...(init || {}), headers: cleanHeaders((init && init.headers) || {}) };
      delete nextInit.headers.Authorization;
      delete nextInit.headers.authorization;
      // Phase 6: inject tracked weak areas into coaching system prompt
      if (!isTranscribe && nextInit.body) {
        try {
          const body = JSON.parse(nextInit.body);
          const weak = getTopWeakAreas(3);
          if (weak.length && Array.isArray(body.messages)) {
            const si = body.messages.findIndex(m => m.role === 'system');
            if (si !== -1) {
              const msgs = body.messages.slice();
              msgs[si] = { ...msgs[si], content: msgs[si].content + '\n\nUser recurring weak areas — pay extra attention to these in corrections: ' + weak.join(', ') + '.' };
              nextInit.body = JSON.stringify({ ...body, messages: msgs });
            }
          }
        } catch (_) {}
      }
      return originalFetch(target, nextInit);
    }
    return originalFetch(input, init);
  };

  function cleanHeaders(headers) {
    const out = {};
    if (headers instanceof Headers) headers.forEach((v, k) => { out[k] = v; });
    else Object.assign(out, headers || {});
    return out;
  }

  function getOrCreatePlayerId() {
    try {
      const existing = sessionStorage.getItem('aria_player_id');
      if (existing) return existing;
      const id = 'p_' + crypto.getRandomValues(new Uint32Array(4)).join('_');
      sessionStorage.setItem('aria_player_id', id);
      return id;
    } catch (_) {
      return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    }
  }

  function getStoredSessionToken() {
    try { return sessionStorage.getItem('aria_session_token') || ''; } catch (_) { return ''; }
  }

  function storeSessionToken(token) {
    PROD.sessionToken = token || '';
    try { if (token) sessionStorage.setItem('aria_session_token', token); else sessionStorage.removeItem('aria_session_token'); } catch (_) {}
  }

  function api(path, options = {}) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 15000);
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    if (PROD.sessionToken && /^\/api\/(rooms\/|webrtc\/rooms\/)/.test(path)) {
      headers['Authorization'] = 'Bearer ' + PROD.sessionToken;
    }
    return originalFetch(path, { ...options, headers, signal: controller.signal }).then(async res => {
      clearTimeout(tid);
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok || data.ok === false) {
        const msg = data?.error?.message || data?.message || res.statusText || 'Request failed';
        const err = new Error(msg);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    }).catch(err => {
      clearTimeout(tid);
      if (err.name === 'AbortError') {
        const t = new Error('Request timed out — check your connection.');
        t.status = 408;
        throw t;
      }
      throw err;
    });
  }

  function showToast(message, type, durationMs) {
    type = type || 'info';
    durationMs = durationMs || 4000;
    let container = document.getElementById('ariaToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'ariaToastContainer';
      container.style.cssText = 'position:fixed;bottom:calc(80px + env(safe-area-inset-bottom,0px));right:14px;z-index:10000;display:flex;flex-direction:column-reverse;gap:8px;max-width:300px;pointer-events:none';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const cfg = {
      error: ['#fff5f5', 'rgba(192,57,43,.28)', '#c0392b'],
      success: ['#f0faf5', 'rgba(45,125,79,.22)', '#2d7d4f'],
      warn: ['#fffbf0', 'rgba(212,130,10,.28)', '#b8720a'],
      info: ['#fff', 'rgba(160,92,46,.2)', 'var(--text2)']
    }[type] || ['#fff', 'rgba(160,92,46,.2)', 'var(--text2)'];
    toast.style.cssText = 'background:' + cfg[0] + ';border:1px solid ' + cfg[1] + ';color:' + cfg[2] + ';padding:10px 14px;border-radius:11px;font-size:13px;font-family:Plus Jakarta Sans,sans-serif;line-height:1.45;box-shadow:0 4px 16px rgba(45,26,14,.1);opacity:0;transform:translateY(6px);transition:opacity .18s,transform .18s;pointer-events:auto;cursor:pointer;font-weight:500;word-break:break-word';
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
    const remove = () => { toast.style.opacity = '0'; toast.style.transform = 'translateY(6px)'; setTimeout(() => { try { toast.remove(); } catch (_) {} }, 200); };
    const tid2 = setTimeout(remove, durationMs);
    toast.addEventListener('click', () => { clearTimeout(tid2); remove(); }, { once: true });
  }

  async function boot() {
    injectPremiumStyles();
    patchOnboarding();
    patchPeerUi();
    installLifecycleGuards();
    // Defer intelligence injections until after first user interaction / screen render
    setTimeout(() => { try { injectDashboardIntelligence(); injectContextualGreeting(); } catch (_) {} }, 800);
    try {
      PROD.config = await api('/api/config');
      connectRealtime();
      showProductionNotice('Connected');
    } catch (error) {
      showProductionNotice('Backend unreachable — realtime features paused.', true);
      console.warn('[ARIA production] boot failed', error);
    }
  }

  function patchOnboarding() {
    const key = document.getElementById('groqKey');
    if (key) {
      key.value = 'server-managed-ai-proxy';
      const field = key.closest('.al-field');
      if (field) {
        const label = field.querySelector('.al-lbl');
        const hint = field.querySelector('.al-hint');
        if (label) label.textContent = 'AI Engine';
        key.style.display = 'none';
        const status = document.getElementById('keyStatus');
        const statusText = document.getElementById('keyStatusText');
        if (status) { status.style.display = 'flex'; status.className = 'key-status valid'; }
        if (statusText) statusText.textContent = '✓ Secured by backend proxy — no browser API key';
        if (hint) hint.textContent = 'Private realtime coaching engine. Provider keys are protected server-side.';
      }
    }
    const privacy = [...document.querySelectorAll('*')].find(el => /100% local/i.test(el.textContent || '') && el.textContent.includes('Groq'));
    if (privacy) privacy.innerHTML = privacy.innerHTML.replace(/100% local\./i, 'Server-secured.').replace(/No login, no server, no tracking\./i, 'No user password required; AI requests and realtime rooms are handled by the ARIA backend.');
  }

  function installGlobalOverrides() {
    try { scheduleKeyCheck = function () { validateGroqKey(); }; } catch (_) {}
    try {
      validateGroqKey = async function () {
        const statusEl = document.getElementById('keyStatus');
        const statusText = document.getElementById('keyStatusText');
        if (statusEl) { statusEl.style.display = 'flex'; statusEl.className = 'key-status valid'; }
        if (statusText) statusText.textContent = '✓ Server AI proxy is configured';
      };
    } catch (_) {}

    try {
      launchSession = async function productionLaunchSession() {
        const nameEl = document.getElementById('userName');
        const name = nameEl ? nameEl.value.trim() : '';
        if (!name) { showToast('Please enter your name.', 'warn'); if (nameEl) nameEl.focus(); return; }
        GROQ_KEY = 'server-managed-ai-proxy';
        USER.name = name;
        USER.email = (document.getElementById('userEmail')?.value || '').trim().toLowerCase();
        USER.userId = USER.email || ('user_' + name.toLowerCase().replace(/\s+/g, '_'));
        USER.nativeLang = document.getElementById('nativeLang')?.value.trim() || '';
        const qiBtns = document.querySelectorAll('#loginInterests .al-chip.on, #loginInterests .int-chip.on');
        if (qiBtns.length) {
          USER.interests = [];
          qiBtns.forEach(b => {
            const oc = b.getAttribute('onclick') || '';
            const m = oc.match(/toggleQuickInterest\(this,'([^']+)'\)/);
            if (m) USER.interests.push(m[1].replace(/&amp;/g, '&'));
          });
        }
        if (!USER.interests.length) USER.interests = ['daily life'];
        SESSION = { turns: 0, fixes: 0, words: 0, history: [], feedbackLog: [], fluencyHistory: [], vocabTaught: [], corrections: [] };
        try { loadMemory(); loadVocabStore(); loadXP(); } catch (_) {}
        try {
          localStorage.setItem('aria_groq_key', GROQ_KEY);
          localStorage.setItem('aria_user', JSON.stringify(USER));
          localStorage.setItem('aria_active_user', USER.userId);
        } catch (_) {}
        document.body.classList.add('logged-in');
        const nav = document.getElementById('mainNav'); if (nav) nav.style.display = 'flex';
        const mob = document.getElementById('mobNav'); if (mob && document.body.classList.contains('is-mobile')) mob.style.display = 'flex';
        try { updateGreeting(); updateDash(); renderResources(); updateDebateDashStat(); } catch (e) { console.warn(e); }
        goScreen('screenDash');
      };
      handleLaunch = function productionHandleLaunch(btn) {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = 'Setting up...';
        launchSession().finally(() => { btn.disabled = false; btn.textContent = 'Start Learning with ARIA →'; });
      };
    } catch (e) { console.warn('[ARIA production] launch override failed', e); }

    try { startCompeteRoom = productionStartCompeteRoom; window.startCompeteRoom = productionStartCompeteRoom; } catch (_) {}
    try { joinRoom = productionJoinRoom; window.joinRoom = productionJoinRoom; } catch (_) {}
    try { sendCompeteMsg = productionSendCompeteMsg; window.sendCompeteMsg = productionSendCompeteMsg; } catch (_) {}
    try { startCompeteGame = productionStartCompeteGame; window.startCompeteGame = productionStartCompeteGame; } catch (_) {}
    try { answerCompeteQ = productionAnswerCompeteQ; window.answerCompeteQ = productionAnswerCompeteQ; } catch (_) {}
    try { closeCompeteRoom = productionCloseCompeteRoom; window.closeCompeteRoom = productionCloseCompeteRoom; } catch (_) {}
    try { startPeerCall = productionStartPeerCall; window.startPeerCall = productionStartPeerCall; } catch (_) {}
    try { acceptOffer = productionJoinPeerCall; window.acceptOffer = productionJoinPeerCall; } catch (_) {}
    try { endPeerCall = productionEndPeerCall; window.endPeerCall = productionEndPeerCall; } catch (_) {}
    try { copyPeerOffer = copyPeerRoomCode; window.copyPeerOffer = copyPeerRoomCode; } catch (_) {}

    // Phase 10: hook trackWeakAreas into goHome so corrections are persisted on navigation
    try {
      const _origGoHome = window.goHome;
      window.goHome = function () {
        try { trackWeakAreas(); } catch (_) {}
        if (typeof _origGoHome === 'function') return _origGoHome.apply(this, arguments);
      };
    } catch (_) {}

    // Primary dispatch namespace — HTML stubs call through here.
    PROD.fn = {
      startCompeteRoom: productionStartCompeteRoom,
      joinRoom: productionJoinRoom,
      sendCompeteMsg: productionSendCompeteMsg,
      startCompeteGame: productionStartCompeteGame,
      answerCompeteQ: productionAnswerCompeteQ,
      closeCompeteRoom: productionCloseCompeteRoom,
      debateVerdict: productionDebateVerdict,
      startPeerCall: productionStartPeerCall,
      acceptOffer: productionJoinPeerCall,
      endPeerCall: productionEndPeerCall,
      copyPeerOffer: copyPeerRoomCode
    };

    // Override renderCallState: the original checks the HTML's `let localStream` which is
    // script-scoped (not window.localStream), so it always reads null from outside.
    // We replace it to check PROD.call.localStream directly.
    try {
      window.renderCallState = function () {
        var hasLive = !!(PROD.call.localStream && PROD.call.room);
        document.querySelectorAll('.call-end-btn').forEach(function (btn) {
          btn.classList.toggle('visible', hasLive);
        });
      };
    } catch (_) {}
  }

  function connectRealtime() {
    clearTimeout(PROD.wsTimer);
    if (!PROD._wsRetries) PROD._wsRetries = 0;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + (PROD.config?.realtimePath || '/realtime'));
    PROD.ws = ws;
    ws.onopen = () => {
      PROD.wsReady = true;
      PROD._wsRetries = 0;
      PROD.wsBackoffMs = 600;
      if (PROD.room?.code) subscribeRoom(PROD.room.code);
      if (PROD.call.room?.code) subscribeRoom(PROD.call.room.code);
      updateNetworkBadge('Connected');
    };
    ws.onmessage = event => {
      PROD._wsLastMsg = Date.now();
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }
      handleRealtimeMessage(msg);
    };
    ws.onclose = () => {
      PROD.wsReady = false;
      PROD._wsRetries++;
      const label = PROD._wsRetries > 3 ? 'Reconnecting (' + PROD._wsRetries + ')…' : 'Reconnecting…';
      updateNetworkBadge(label, true);
      PROD.wsTimer = setTimeout(connectRealtime, PROD.wsBackoffMs);
      PROD.wsBackoffMs = Math.min(PROD.wsBackoffMs * 1.8, 30000);
    };
    ws.onerror = () => updateNetworkBadge('Connection issue', true);
  }

  function subscribeRoom(code) {
    if (!PROD.wsReady || !PROD.ws) return;
    PROD.ws.send(JSON.stringify({ type: 'room.subscribe', roomCode: code, playerId: PROD.playerId, sessionToken: PROD.sessionToken }));
  }

  function handleRealtimeMessage(msg) {
    if (msg.type === 'room.snapshot') {
      if (msg.room?.mode?.startsWith('call-')) applyCallSnapshot(msg);
      else applyCompeteSnapshot(msg);
    }
    if (msg.type === 'room.event' && msg.event) appendRoomEvent(msg.event);
    if (msg.type === 'webrtc.signal' && msg.signal) receiveSignal(msg.signal).catch(e => setPeerStatus('WebRTC signaling error: ' + e.message));
  }

  function currentDisplayName() {
    return (typeof USER !== 'undefined' && USER.name) ? USER.name : 'Guest';
  }

  async function productionStartCompeteRoom(mode) {
    try {
      safeCleanupCompeteUi();
      if (typeof cleanupActivity === 'function') cleanupActivity('compete');
      if (typeof startActivity === 'function') startActivity('compete', { mode });
      currentCompeteMode = mode;
      const data = await api('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ mode, displayName: currentDisplayName(), playerId: PROD.playerId })
      });
      storeSessionToken(data.sessionToken);
      PROD.room = data.room;
      PROD.players = data.players || [];
      PROD.events = data.events || [];
      competeRoom = { code: data.room.code, players: PROD.players.map(p => p.displayName), gameActive: false, myScore: 0, friendScore: 0, questionIdx: 0, questions: [] };
      renderRoomCreated(data.room, mode);
      subscribeRoom(data.room.code);
      applyCompeteSnapshot(data);
    } catch (error) {
      showToast('Could not create room: ' + error.message, 'error');
    }
  }

  async function productionJoinRoom() {
    const code = (document.getElementById('joinCodeInput')?.value || '').replace(/\D/g, '').slice(0, 8);
    if (code.length !== 8) { showToast('Please enter an 8-digit room code.', 'warn'); return; }
    try {
      const data = await api('/api/rooms/' + code + '/join', {
        method: 'POST',
        body: JSON.stringify({ displayName: currentDisplayName(), playerId: PROD.playerId })
      });
      storeSessionToken(data.sessionToken);
      PROD.room = data.room;
      PROD.players = data.players || [];
      PROD.events = data.events || [];
      currentCompeteMode = data.room.mode;
      if (typeof startActivity === 'function') startActivity('compete', { code, mode: currentCompeteMode });
      competeRoom = { code, players: PROD.players.map(p => p.displayName), gameActive: false, myScore: 0, friendScore: 0, questionIdx: 0, questions: [] };
      document.getElementById('joinRoomPanel')?.classList.remove('active');
      document.getElementById('createRoomPanel')?.classList.add('active');
      setTextSafe('roomCodeDisplay', code);
      setTextSafe('roomStatus', 'Joined — waiting for the host to start.');
      setTextSafe('playerSelfName', currentDisplayName());
      renderChatEvents(data.events || []);
      subscribeRoom(code);
      applyCompeteSnapshot(data);
    } catch (error) {
      showToast('Room join failed: ' + error.message, 'error');
    }
  }

  async function productionSendCompeteMsg() {
    const input = document.getElementById('competeInput');
    const text = (input?.value || '').trim();
    if (!text || !PROD.room?.code) return;
    input.value = '';
    try {
      await api('/api/rooms/' + PROD.room.code + '/events', {
        method: 'POST',
        body: JSON.stringify({ playerId: PROD.playerId, type: 'chat', payload: { text } })
      });
    } catch (error) {
      showToast('Message failed: ' + error.message, 'error');
    }
  }

  async function productionStartCompeteGame() {
    if (!PROD.room?.code) return;
    const body = { playerId: PROD.playerId };
    if (currentCompeteMode === 'debate' || PROD.room.mode === 'debate') {
      const topicEl = document.getElementById('debateTopicInput');
      const topic = (topicEl?.value || '').trim();
      if (!topic) { showToast('Please enter a debate topic before starting.', 'warn'); return; }
      body.topic = topic;
    }
    try {
      await api('/api/rooms/' + PROD.room.code + '/start', {
        method: 'POST',
        body: JSON.stringify(body)
      });
    } catch (error) {
      showToast('Could not start game: ' + error.message, 'error');
    }
  }

  async function productionDebateVerdict() {
    const gs = PROD.room?.gameState;
    if (!gs || gs.mode !== 'debate') return;
    const btn = document.getElementById('verdictBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'AI judge is deliberating…'; }
    const players = PROD.players;
    const forPlayer = players.find(p => p.playerId === gs.stanceFor);
    const againstPlayer = players.find(p => p.playerId === gs.stanceAgainst);
    const chatMessages = PROD.events
      .filter(e => e.type === 'chat' && e.payload?.text)
      .map(e => {
        const p = players.find(pl => pl.playerId === e.playerId);
        return (p?.displayName || 'Player') + ': ' + e.payload.text;
      }).join('\n');
    if (!chatMessages) {
      showToast('No debate messages yet — have both players argue in chat first.', 'warn');
      if (btn) { btn.disabled = false; btn.textContent = 'End Debate & Get AI Verdict'; }
      return;
    }
    const prompt = `You are an impartial English debate judge. Evaluate the following debate.

Topic: "${gs.topic}"
${forPlayer?.displayName || 'Player 1'} is arguing FOR.
${againstPlayer?.displayName || 'Player 2'} is arguing AGAINST.

Transcript:
${chatMessages}

Please provide:
1. ${forPlayer?.displayName || 'Player 1'}'s best arguments (2-3 sentences)
2. ${againstPlayer?.displayName || 'Player 2'}'s best arguments (2-3 sentences)
3. Winner and reason (2-3 sentences)
4. Score out of 10 for each player

Be concise, fair, and encouraging. Focus on argument quality and English expression.`;
    try {
      const res = await originalFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
          temperature: 0.7
        })
      });
      const data = await res.json();
      const verdict = data.choices?.[0]?.message?.content || 'Could not get verdict.';
      await api('/api/rooms/' + PROD.room.code + '/events', {
        method: 'POST',
        body: JSON.stringify({ playerId: PROD.playerId, type: 'system', payload: { text: '⚖️ AI JUDGE VERDICT:\n' + verdict } })
      });
      const area = document.getElementById('liveQuestionArea'); if (area) area.style.display = 'none';
      const result = document.getElementById('liveGameResult'); if (result) result.style.display = 'block';
      setTextSafe('liveResultEmoji', '⚖️');
      setTextSafe('liveResultText', 'Debate Complete!');
      setTextSafe('liveResultSub', 'AI judge\'s verdict has been posted in the chat above.');
    } catch (error) {
      showToast('Could not get verdict: ' + error.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'End Debate & Get AI Verdict'; }
    }
  }

  async function productionAnswerCompeteQ(idx) {
    if (!PROD.room?.code) return;
    const gs = PROD.room.gameState || {};
    const qIdx = Number(gs.currentQuestionIdx || 0);
    if (PROD.answeredQuestions.has(qIdx)) return;
    PROD.answeredQuestions.add(qIdx);
    const opts = document.querySelectorAll('#liveOptions .q-opt');
    opts.forEach(o => { o.disabled = true; });
    try {
      const data = await api('/api/rooms/' + PROD.room.code + '/answer', {
        method: 'POST',
        body: JSON.stringify({ playerId: PROD.playerId, answerIdx: idx })
      });
      // Apply snapshot from response immediately to avoid race with WS broadcast
      if (data?.room) applyCompeteSnapshot(data);
    } catch (error) {
      PROD.answeredQuestions.delete(qIdx);
      opts.forEach(o => { o.disabled = false; });
      showToast('Answer rejected: ' + error.message, 'error');
    }
  }

  async function productionCloseCompeteRoom() {
    try {
      if (PROD.room?.code) {
        await api('/api/rooms/' + PROD.room.code + '/leave', { method: 'POST', body: JSON.stringify({ playerId: PROD.playerId }) });
      }
    } catch (_) {}
    storeSessionToken('');
    PROD.room = null;
    PROD.players = [];
    PROD.events = [];
    PROD.answeredQuestions.clear();
    try { clearTimerKey('room-poll'); clearTimerKey('compete-friend-answer'); clearTimerKey('compete-next-question'); } catch (_) {}
    document.getElementById('competeModeGrid') && (document.getElementById('competeModeGrid').style.display = 'grid');
    document.getElementById('createRoomPanel')?.classList.remove('active');
    document.getElementById('joinRoomPanel')?.classList.remove('active');
    document.getElementById('liveGamePanel')?.classList.remove('active');
    // Restore chat to createRoomPanel so it's ready for the next room
    _moveChatToPanel('createRoomPanel');
    try { ACTIVE_ACTIVITY = { type: null, status: 'idle', snapshot: null, updatedAt: Date.now() }; localStorage.removeItem(ACTIVITY_STORAGE_KEY); renderActivityBar(); } catch (_) {}
  }

  function renderRoomCreated(room, mode) {
    document.getElementById('competeModeGrid') && (document.getElementById('competeModeGrid').style.display = 'none');
    document.getElementById('joinRoomPanel')?.classList.remove('active');
    document.getElementById('liveGamePanel')?.classList.remove('active');
    document.getElementById('createRoomPanel')?.classList.add('active');
    // Restore chat to createRoomPanel (it may have been moved to liveGamePanel during a game)
    _moveChatToPanel('createRoomPanel');
    setTextSafe('roomCodeDisplay', room.code);
    const labels = { debate: '⚖️ DEBATE BATTLE', quiz: '⚡ QUIZ RACE', vocab: '📚 VOCAB SHOWDOWN' };
    setTextSafe('roomModeLabel', labels[mode] || String(mode).toUpperCase());
    setTextSafe('playerSelfName', currentDisplayName());
    setTextSafe('roomStatus', 'Waiting for your friend — share the code above.');
    const btn = document.getElementById('startGameBtn');
    if (btn) { btn.disabled = true; btn.textContent = '▶ Start Game (need 2 players)'; }
    const chat = document.getElementById('competeChat');
    if (chat) chat.innerHTML = '<div class="cc-msg system">Room created! Share code ' + escapeHTML(room.code) + ' with a friend.</div>';
    // Inject debate topic input for host
    const existing = document.getElementById('debateTopicSection');
    if (existing) existing.remove();
    if (mode === 'debate') {
      const section = document.createElement('div');
      section.id = 'debateTopicSection';
      section.style.cssText = 'margin:14px 0 4px;';
      section.innerHTML = '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">📝 Debate Topic (host sets this)</div><textarea id="debateTopicInput" rows="2" placeholder="Enter the topic to debate — e.g. \'AI will replace most creative jobs within 10 years\'" style="width:100%;background:var(--cream);border:1.5px solid var(--border2);border-radius:10px;padding:10px 12px;font-size:13px;font-family:Plus Jakarta Sans,sans-serif;color:var(--text);resize:none;outline:none;box-sizing:border-box;transition:border-color .2s" onfocus="this.style.borderColor=\'var(--orange)\'" onblur="this.style.borderColor=\'var(--border2)\'"></textarea><div style="font-size:11px;color:var(--text3);margin-top:4px">Sides (FOR / AGAINST) will be randomly assigned when you start.</div>';
      const statusEl = document.getElementById('roomStatus');
      if (statusEl?.parentNode) statusEl.parentNode.insertBefore(section, statusEl.nextSibling);
    }
  }

  function applyCompeteSnapshot(data) {
    if (!data.room || data.room.mode?.startsWith('call-')) return;
    // competeRoom is a global var from the HTML — guard against it being uninitialised
    if (typeof competeRoom === 'undefined' || !competeRoom) competeRoom = { code: '', players: [], gameActive: false, myScore: 0, friendScore: 0, questionIdx: 0, questions: [] };
    PROD.room = data.room;
    PROD.players = data.players || [];
    PROD.events = data.events || PROD.events;
    competeRoom.code = data.room.code;
    competeRoom.players = PROD.players.map(p => p.displayName);
    renderPlayers(PROD.players);
    renderChatEvents(PROD.events);
    const connected = PROD.players.filter(p => p.connected !== false);
    const isHost = data.room.hostPlayerId === PROD.playerId;
    const btn = document.getElementById('startGameBtn');
    if (btn) {
      btn.disabled = !(isHost && connected.length >= 2 && data.room.status === 'waiting');
      btn.textContent = isHost ? (connected.length >= 2 ? '▶ Start Game!' : '▶ Start Game (need 2 players)') : 'Waiting for host…';
    }
    if (data.room.status === 'waiting') {
      setTextSafe('roomStatus', connected.length >= 2 ? connected.map(p => p.displayName).join(' & ') + ' are ready.' : 'Waiting for your friend — share the code above.');
    }
    if (data.room.gameState?.status === 'active') renderAuthoritativeGame(data.room, connected);
    if (data.room.gameState?.status === 'finished' || data.room.status === 'ended') renderAuthoritativeResult(data.room, connected);
  }

  function renderPlayers(players) {
    const roomPlayers = document.getElementById('roomPlayers');
    if (!roomPlayers) return;
    const html = players.map(p => '<div class="player-chip"><div class="pc-dot" style="opacity:' + (p.connected === false ? '.35' : '1') + '"></div><span>' + escapeHTML(p.displayName) + (p.role === 'host' ? ' · host' : '') + '</span></div>').join('');
    safeSet(roomPlayers, html);
  }

  function renderChatEvents(events) {
    const chat = document.getElementById('competeChat');
    if (!chat) return;
    const html = events.filter(e => e.type === 'chat' || e.type === 'system').map(e => {
      const player = PROD.players.find(p => p.playerId === e.playerId);
      const mine = e.playerId === PROD.playerId;
      const klass = e.type === 'system' ? 'system' : (mine ? 'me' : 'them');
      const text = e.type === 'system' ? (e.payload?.text || 'Room update') : ((player?.displayName || 'Friend') + ': ' + (e.payload?.text || ''));
      return '<div class="cc-msg ' + klass + '">' + escapeHTML(text) + '</div>';
    }).join('');
    chat.innerHTML = html || '<div class="cc-msg system">Connected to realtime room.</div>';
    chat.scrollTop = chat.scrollHeight;
  }

  function appendRoomEvent(event) {
    if (event.roomCode !== PROD.room?.code && event.roomCode !== PROD.call.room?.code) return;
    if (event.type === 'chat' || event.type === 'system') {
      PROD.events.push(event);
      renderChatEvents(PROD.events);
    }
  }

  // Move competeChat + competeInputRow into targetPanelId so the chat stays visible
  // regardless of which panel is active. Moving real DOM nodes keeps IDs unique.
  function _moveChatToPanel(targetPanelId) {
    const target = document.getElementById(targetPanelId);
    if (!target) return;
    const chat = document.getElementById('competeChat');
    const inputRow = document.querySelector('.compete-input-row');
    if (chat && chat.parentElement?.id !== targetPanelId) target.appendChild(chat);
    if (inputRow && inputRow.parentElement?.id !== targetPanelId) target.appendChild(inputRow);
  }

  function renderAuthoritativeGame(room, players) {
    const gs = room.gameState;
    document.getElementById('createRoomPanel')?.classList.remove('active');
    document.getElementById('liveGamePanel')?.classList.add('active');

    // Move chat + input into liveGamePanel so players can communicate during the game
    _moveChatToPanel('liveGamePanel');

    const me = players.find(p => p.playerId === PROD.playerId);
    const friend = players.find(p => p.playerId !== PROD.playerId) || players[0];
    setTextSafe('liveYouName', me?.displayName || currentDisplayName());
    setTextSafe('liveFriendName', friend?.displayName || 'Friend');
    setTextSafe('liveYouScore', String(gs.scores?.[PROD.playerId] || 0));
    setTextSafe('liveFriendScore', String(gs.scores?.[friend?.playerId] || 0));
    setTextSafe('liveGameLabel', ({ quiz: '⚡ QUIZ RACE', debate: '⚖️ DEBATE BATTLE', vocab: '📚 VOCAB SHOWDOWN' }[room.mode] || 'LIVE GAME'));
    const result = document.getElementById('liveGameResult'); if (result) result.style.display = 'none';
    const area = document.getElementById('liveQuestionArea'); if (area) area.style.display = 'block';

    if (room.mode === 'debate') {
      const myStance = gs.stanceFor === PROD.playerId ? 'FOR — argue in favour' : 'AGAINST — argue against';
      setTextSafe('liveQLabel', 'Your stance: ' + myStance);
      setTextSafe('liveQuestion', gs.topic || 'Debate topic loading…');
      const opts = document.getElementById('liveOptions');
      if (opts) {
        const isHost = room.hostPlayerId === PROD.playerId;
        opts.innerHTML = '<div style="color:var(--text2);font-size:13px;margin-bottom:12px">Use the chat below to argue your position. Make strong points.</div>' +
          (isHost
            ? '<button id="verdictBtn" onclick="window.ARIA_PRODUCTION.fn.debateVerdict()" style="background:linear-gradient(135deg,var(--orange),var(--amber));border:none;border-radius:10px;padding:10px 18px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:Plus Jakarta Sans,sans-serif">End Debate &amp; Get AI Verdict</button>'
            : '<div style="color:var(--text3);font-size:12px;font-style:italic">Waiting for host to call the AI judge…</div>');
      }
      return;
    }

    const q = gs.questions?.[gs.currentQuestionIdx];
    if (!q) return;
    competeRoom.questionIdx = gs.currentQuestionIdx;
    competeRoom.questions = gs.questions;
    setTextSafe('liveQLabel', 'Question ' + (gs.currentQuestionIdx + 1) + ' of ' + gs.questions.length);
    setTextSafe('liveQuestion', q.q);
    const answers = gs.answers?.[String(gs.currentQuestionIdx)] || {};
    const already = !!answers[PROD.playerId];
    if (already) PROD.answeredQuestions.add(gs.currentQuestionIdx);
    const opts = document.getElementById('liveOptions');
    if (opts) {
      opts.innerHTML = q.opts.map((o, i) => {
        const klass = already ? (i === q.correct ? ' correct' : (answers[PROD.playerId]?.answerIdx === i ? ' wrong' : '')) : '';
        return '<button class="q-opt' + klass + '" ' + (already ? 'disabled' : '') + ' onclick="answerCompeteQ(' + i + ')">' + String.fromCharCode(65 + i) + '. ' + escapeHTML(o) + '</button>';
      }).join('');
    }
  }

  function renderAuthoritativeResult(room, players) {
    const gs = room.gameState || {};
    document.getElementById('createRoomPanel')?.classList.remove('active');
    document.getElementById('liveGamePanel')?.classList.add('active');
    const area = document.getElementById('liveQuestionArea'); if (area) area.style.display = 'none';
    const result = document.getElementById('liveGameResult'); if (result) result.style.display = 'block';
    const myScore = Number(gs.scores?.[PROD.playerId] || 0);
    const other = players.find(p => p.playerId !== PROD.playerId);
    const otherScore = Number(gs.scores?.[other?.playerId] || 0);
    const won = myScore > otherScore;
    const draw = myScore === otherScore;
    setTextSafe('liveResultEmoji', won ? '🏆' : draw ? '🤝' : '📚');
    setTextSafe('liveResultText', won ? 'You Won!' : draw ? "It's a Draw!" : 'Keep Practising!');
    setTextSafe('liveResultSub', 'You: ' + myScore + ' — Friend: ' + otherScore);
  }

  function safeCleanupCompeteUi() {
    try { clearTimerKey('room-poll'); clearTimerKey('compete-friend-answer'); clearTimerKey('compete-next-question'); } catch (_) {}
  }

  function setTextSafe(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
  function safeSet(el, html) { if (typeof safeSetInnerHTML === 'function') safeSetInnerHTML(el, html); else el.innerHTML = html; }

  function patchPeerUi() {
    const peerSection = document.getElementById('peerChatSection');
    if (!peerSection) return;
    const copy = peerSection.querySelector('div[style*="font-size:13.5px"]');
    if (copy) copy.textContent = 'Real-time video or voice call with a friend using automatic WebRTC signaling through ARIA room codes. No manual SDP copy-paste.';
    const labels = peerSection.querySelectorAll('.field-label');
    if (labels[0]) labels[0].textContent = 'Call code — share this with your partner';
    if (labels[1]) labels[1].textContent = 'Join a friend call';
    const input = document.getElementById('peerAnswerInput');
    if (input) { input.placeholder = 'Enter 8-digit call code'; input.rows = 1; input.style.fontFamily = 'Plus Jakarta Sans, sans-serif'; }
    const box = document.getElementById('peerOfferBox');
    if (box) { box.rows = 1; box.style.fontFamily = 'Plus Jakarta Sans, sans-serif'; box.style.fontSize = '20px'; box.style.textAlign = 'center'; box.style.letterSpacing = '5px'; }
    const btn = peerSection.querySelector('[onclick="acceptOffer()"]');
    if (btn) btn.textContent = '🔗 Join Call';
    const copyBtn = peerSection.querySelector('[onclick="copyPeerOffer()"]');
    if (copyBtn) copyBtn.textContent = '📋 Copy Code';
  }

  async function productionStartPeerCall(mode) {
    try {
      await productionEndPeerCall('Starting a new call', true);
      PROD.call.mode = mode;
      setPeerStatus('🎥 Setting up ' + (mode === 'voice' ? 'microphone' : 'camera') + '…');
      const data = await api('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ mode: mode === 'voice' ? 'call-voice' : 'call-video', displayName: currentDisplayName(), playerId: PROD.playerId })
      });
      storeSessionToken(data.sessionToken);
      PROD.call.room = data.room;
      PROD.call.polite = false;
      // Get media before subscribing — ensures we're ready before the hub can trigger peer connection
      await prepareLocalMedia(mode);
      showPeerArea(data.room.code, 'Share this call code with your friend.');
      subscribeRoom(data.room.code);
      applyCallSnapshot(data);
    } catch (error) {
      setPeerStatus('Call setup failed: ' + error.message, true);
      await productionEndPeerCall(error.message, true);
    }
  }

  async function productionJoinPeerCall() {
    const code = (document.getElementById('peerAnswerInput')?.value || '').replace(/\D/g, '').slice(0, 8);
    if (code.length !== 8) { showToast('Enter the 8-digit call code from your friend.', 'warn'); return; }
    try {
      // Only tear down a prior call — do NOT touch the UI so peerVideoArea stays visible
      if (PROD.call.room) await productionEndPeerCall('Joining another call', true);

      // Show UI before any async work so status messages are always visible to the user
      var pv = document.getElementById('peerVideoArea');
      if (pv) pv.style.display = 'block';
      setPeerStatus('Joining call…');

      const data = await api('/api/rooms/' + code + '/join', {
        method: 'POST',
        body: JSON.stringify({ displayName: currentDisplayName(), playerId: PROD.playerId })
      });
      storeSessionToken(data.sessionToken);
      PROD.call.room = data.room;
      PROD.call.mode = data.room.mode === 'call-voice' ? 'voice' : 'video';
      PROD.call.polite = true;
      await prepareLocalMedia(PROD.call.mode);
      showPeerArea(code, 'Joined — connecting to your friend…');
      applyCallSnapshot(data);
      subscribeRoom(code);
    } catch (error) {
      showToast('Could not join call: ' + error.message, 'error');
      await productionEndPeerCall(error.message, true);
    }
  }

  async function prepareLocalMedia(mode) {
    const ice = await api('/api/webrtc/ice').catch(() => null);
    if (ice?.iceServers) PROD.call.iceServers = ice.iceServers;
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

    if (mode === 'video') {
      const videoConstraints = { width: { ideal: 960, max: 1280 }, height: { ideal: 540, max: 720 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' };
      try {
        PROD.call.localStream = await navigator.mediaDevices.getUserMedia({ audio, video: videoConstraints });
      } catch (videoErr) {
        if (videoErr.name === 'NotAllowedError' || videoErr.name === 'PermissionDeniedError') {
          throw new Error('Camera/microphone permission denied. Click the camera icon in your browser address bar and allow access, then try again.');
        }
        // Camera in use by another app or browser — fall back to voice-only rather than failing the call
        console.warn('[ARIA] Camera unavailable (' + videoErr.name + '), falling back to voice-only:', videoErr.message);
        setPeerStatus('Camera unavailable — switching to voice only.', true);
        PROD.call.mode = 'voice';
        try {
          PROD.call.localStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
        } catch (audioErr) {
          if (audioErr.name === 'NotAllowedError' || audioErr.name === 'PermissionDeniedError') {
            throw new Error('Microphone permission denied. Allow microphone access and try again.');
          }
          throw new Error('Could not access microphone: ' + audioErr.message);
        }
      }
    } else {
      try {
        PROD.call.localStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      } catch (audioErr) {
        if (audioErr.name === 'NotAllowedError' || audioErr.name === 'PermissionDeniedError') {
          throw new Error('Microphone permission denied. Allow microphone access and try again.');
        }
        throw new Error('Could not access microphone: ' + audioErr.message);
      }
    }

    // Only attach video element if we actually have a video track
    if (PROD.call.localStream.getVideoTracks().length > 0) {
      const lv = document.getElementById('localVideo');
      if (lv) {
        lv.srcObject = PROD.call.localStream;
        lv.muted = true;
        lv.style.transform = 'scaleX(-1)';
        await lv.play().catch(() => {});
      }
    }
    try { window.renderCallState(); } catch (_) {}
  }

  function applyCallSnapshot(data) {
    if (!data.room?.mode?.startsWith('call-')) return;
    PROD.call.room = data.room;
    const players = (data.players || []).filter(p => p.connected !== false);
    if (players.length < 2) {
      setPeerStatus('Waiting for your friend — code: ' + data.room.code);
      return;
    }
    if (!PROD.call.localStream) return;
    const remote = players.find(p => p.playerId !== PROD.playerId);
    if (!remote) return;
    setPeerStatus('Connecting to ' + (remote.displayName || 'your friend') + '…');

    if (PROD.call.pc) {
      // PC already exists. If we are the host (impolite) and we have a local offer
      // that the joiner may not have received yet (they subscribed after we sent it),
      // re-send it now. Guard on signalingState — 'new' means no offer sent yet,
      // 'have-local-offer' means offer sent but no answer received yet.
      const ss = PROD.call.pc.signalingState;
      if (!PROD.call.polite && (ss === 'have-local-offer' || ss === 'new') && !PROD.call.makingOffer) {
        reOffer(PROD.call.pc, remote.playerId);
      }
      return;
    }
    ensurePeerConnection(remote.playerId).catch(error => setPeerStatus('Peer setup failed: ' + error.message, true));
  }

  // Re-sends the host's local offer to a joiner who subscribed after the initial offer was broadcast.
  async function reOffer(pc, remotePlayerId) {
    const ss = pc.signalingState;
    // Only valid to (re)create an offer from stable or when we already have a local offer
    if (ss !== 'stable' && ss !== 'have-local-offer') return;
    try {
      PROD.call.makingOffer = true;
      if (ss === 'have-local-offer' && pc.localDescription?.type === 'offer') {
        // Re-send the existing offer — joiner may have missed the first broadcast
        await sendSignal('offer', { description: pc.localDescription }, remotePlayerId);
      } else {
        // stable state — create a fresh offer
        await pc.setLocalDescription();
        await sendSignal(pc.localDescription.type, { description: pc.localDescription }, remotePlayerId);
      }
    } catch (e) {
      console.warn('[ARIA] reOffer failed:', e.message);
    } finally {
      PROD.call.makingOffer = false;
    }
  }

  async function ensurePeerConnection(remotePlayerId) {
    if (PROD.call.pc) return PROD.call.pc;
    if (!PROD.call.localStream) throw new Error('Local media not ready.');

    const pc = new RTCPeerConnection({ iceServers: PROD.call.iceServers, iceCandidatePoolSize: 10 });
    PROD.call.pc = pc;
    PROD.call.remotePlayerId = remotePlayerId;
    PROD.call.isSettingRemoteAnswerPending = false;

    // Add local tracks
    for (const track of PROD.call.localStream.getTracks()) {
      pc.addTrack(track, PROD.call.localStream);
    }

    // MDN-exact ontrack: wait for track.onunmute before showing remote video.
    // Avoids playing an empty srcObject which silently fails on Chrome/Safari.
    pc.ontrack = ({ track, streams }) => {
      track.onunmute = () => {
        const rv = document.getElementById('remoteVideo');
        if (rv && streams[0] && rv.srcObject !== streams[0]) {
          rv.srcObject = streams[0];
          PROD.call.remoteStream = streams[0];
          rv.play().catch(() => {});
        }
        setPeerStatus('Connected');
        const offerSec = document.getElementById('peerOfferSection');
        if (offerSec) offerSec.style.display = 'none';
        try { updateActiveCall({ status: 'connected', connectedAt: Date.now() }); } catch (_) {}
        try { window.renderCallState(); } catch (_) {}
      };
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) sendSignal('candidate', { candidate: candidate.toJSON() }, remotePlayerId);
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connecting') setPeerStatus('Establishing connection…');
      if (s === 'connected') {
        setPeerStatus('Connected');
        const offerSec = document.getElementById('peerOfferSection');
        if (offerSec) offerSec.style.display = 'none';
        try { updateActiveCall({ status: 'connected', connectedAt: Date.now() }); } catch (_) {}
        try { window.renderCallState(); } catch (_) {}
      }
      if (s === 'disconnected') setPeerStatus('Connection interrupted — recovering…', true);
      if (s === 'failed') { setPeerStatus('Reconnecting peer…', true); pc.restartIce(); }
      if (s === 'closed') setPeerStatus('Call ended.');
    };

    // MDN-exact negotiation: set makingOffer before await to prevent races
    pc.onnegotiationneeded = async () => {
      try {
        PROD.call.makingOffer = true;
        await pc.setLocalDescription();
        await sendSignal(pc.localDescription.type, { description: pc.localDescription }, remotePlayerId);
      } catch (e) {
        setPeerStatus('Negotiation error: ' + e.message, true);
      } finally {
        PROD.call.makingOffer = false;
      }
    };

    try { updateActiveCall({ id: PROD.call.room.code, mode: PROD.call.mode, status: 'connecting', startedAt: Date.now() }); } catch (_) {}
    try { window.renderCallState(); } catch (_) {}
    return pc;
  }

  async function sendSignal(type, payload, toPlayerId) {
    if (!PROD.call.room?.code) return;
    // playerId is required by the auth middleware; fromPlayerId is derived server-side from the token
    await api('/api/webrtc/rooms/' + PROD.call.room.code + '/signal', {
      method: 'POST',
      body: JSON.stringify({ playerId: PROD.playerId, toPlayerId, type, payload })
    });
  }

  async function receiveSignal(signal) {
    if (!PROD.call.room || signal.roomCode !== PROD.call.room.code) return;
    if (signal.fromPlayerId === PROD.playerId) return;
    if (signal.toPlayerId && signal.toPlayerId !== PROD.playerId) return;

    // ICE candidates must be queued until setRemoteDescription has been called.
    // Applying them before the remote description is set throws "remote description was null".
    if (signal.type === 'candidate') {
      if (!PROD.call.pc || !PROD.call.pc.remoteDescription) {
        PROD.call._pendingCandidates.push(signal.payload.candidate);
        return;
      }
      try { await PROD.call.pc.addIceCandidate(signal.payload.candidate); }
      catch (err) { if (!PROD.call.ignoreOffer) console.warn('[ARIA] addIceCandidate:', err.message); }
      return;
    }

    const pc = await ensurePeerConnection(signal.fromPlayerId);

    if (signal.type === 'offer' || signal.type === 'answer') {
      const description = signal.payload.description;
      const readyForOffer = !PROD.call.makingOffer && (pc.signalingState === 'stable' || PROD.call.isSettingRemoteAnswerPending);
      const offerCollision = signal.type === 'offer' && !readyForOffer;
      PROD.call.ignoreOffer = !PROD.call.polite && offerCollision;
      if (PROD.call.ignoreOffer) return;
      PROD.call.isSettingRemoteAnswerPending = description.type === 'answer';
      await pc.setRemoteDescription(description);
      PROD.call.isSettingRemoteAnswerPending = false;

      // Drain any ICE candidates that arrived before the remote description
      const queued = PROD.call._pendingCandidates.splice(0);
      for (const c of queued) {
        try { await pc.addIceCandidate(c); } catch (_) {}
      }

      if (description.type === 'offer') {
        await pc.setLocalDescription();
        await sendSignal(pc.localDescription.type, { description: pc.localDescription }, signal.fromPlayerId);
      }
    }

    if (signal.type === 'bye') await productionEndPeerCall('Friend ended the call', true);
  }

  function showPeerArea(code, status) {
    const pv = document.getElementById('peerVideoArea'); if (pv) pv.style.display = 'block';
    const offerSec = document.getElementById('peerOfferSection'); if (offerSec) offerSec.style.display = 'block';
    const box = document.getElementById('peerOfferBox'); if (box) box.value = code;
    setPeerStatus(status);
  }

  function setPeerStatus(text, warn) {
    const el = document.getElementById('peerStatus');
    if (el) { el.textContent = text; el.style.color = warn ? 'var(--red)' : 'var(--text2)'; }
  }

  function copyPeerRoomCode() {
    const code = document.getElementById('peerOfferBox')?.value || PROD.call.room?.code || '';
    if (!code) return;
    navigator.clipboard?.writeText(code).then(() => setPeerStatus('Call code copied.')).catch(() => showToast('Call code: ' + code, 'info', 8000));
  }

  async function productionEndPeerCall(reason, silent) {
    try { if (PROD.call.room?.code && PROD.call.remotePlayerId) await sendSignal('bye', { reason: reason || 'Call ended' }, PROD.call.remotePlayerId); } catch (_) {}
    try { if (PROD.call.room?.code) await api('/api/rooms/' + PROD.call.room.code + '/leave', { method: 'POST', body: JSON.stringify({ playerId: PROD.playerId }) }); } catch (_) {}
    try { PROD.call.pc?.getSenders?.().forEach(s => { try { s.track?.stop(); } catch (_) {} }); } catch (_) {}
    if (PROD.call.pc) {
      PROD.call.pc.ontrack = null;
      PROD.call.pc.onicecandidate = null;
      PROD.call.pc.onconnectionstatechange = null;
      PROD.call.pc.onnegotiationneeded = null;
    }
    try { PROD.call.pc?.close(); } catch (_) {}
    cleanupStream(PROD.call.localStream);
    // Do NOT stop remote tracks — they belong to the remote peer's sender
    const rv2 = document.getElementById('remoteVideo'); if (rv2) rv2.srcObject = null;
    storeSessionToken('');
    window.localStream = null;
    PROD.call.pc = null;
    PROD.call.localStream = null;
    PROD.call.remoteStream = null;
    PROD.call.room = null;
    PROD.call.remotePlayerId = null;
    PROD.call.makingOffer = false;
    PROD.call.ignoreOffer = false;
    PROD.call.isSettingRemoteAnswerPending = false;
    PROD.call._pendingCandidates = [];
    const pv = document.getElementById('peerVideoArea'); if (pv) pv.style.display = 'none';
    const lv = document.getElementById('localVideo'); if (lv) { lv.srcObject = null; lv.style.transform = ''; }
    const offerSec = document.getElementById('peerOfferSection'); if (offerSec) offerSec.style.display = 'block';
    const offer = document.getElementById('peerOfferBox'); if (offer) offer.value = '';
    const answer = document.getElementById('peerAnswerInput'); if (answer) answer.value = '';
    try { updateActiveCall({ status: 'ended', endedAt: Date.now(), reason: reason || 'Call ended' }); } catch (_) {}
    try { window.renderCallState(); } catch (_) {}
    if (!silent) setPeerStatus(reason || 'Call ended.');
  }

  function cleanupStream(stream) {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch (_) {}
    }
  }

  function installLifecycleGuards() {
    window.addEventListener('pagehide', () => {
      try { trackWeakAreas(); } catch (_) {}
      productionEndPeerCall('Page closed', true);
      if (PROD.room?.code) api('/api/rooms/' + PROD.room.code + '/leave', { method: 'POST', body: JSON.stringify({ playerId: PROD.playerId }) }).catch(() => {});
    });
    window.addEventListener('online', () => {
      updateNetworkBadge('Back online');
      if (!PROD.wsReady) {
        PROD.wsBackoffMs = 600;
        clearTimeout(PROD.wsTimer);
        connectRealtime();
      }
    });
    window.addEventListener('offline', () => updateNetworkBadge('Offline — realtime paused', true));
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !PROD.wsReady) {
        PROD.wsBackoffMs = 600;
        clearTimeout(PROD.wsTimer);
        connectRealtime();
      }
    });
  }

  function updateNetworkBadge(text, warn) {
    let el = document.getElementById('ariaProdNetBadge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ariaProdNetBadge';
      el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;padding:7px 13px;border-radius:999px;background:rgba(255,255,255,.96);border:1px solid var(--border2);font-size:11px;font-weight:500;letter-spacing:.01em;color:var(--text2);box-shadow:0 2px 12px rgba(45,26,14,.08);opacity:.96;transition:opacity .3s,color .2s,border-color .2s;backdrop-filter:blur(6px)';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.borderColor = warn ? 'rgba(192,57,43,.32)' : 'rgba(160,92,46,.18)';
    el.style.color = warn ? 'var(--red)' : 'var(--text3)';
    el.style.opacity = '.96';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.opacity = '.18'; }, 4000);
  }

  function showProductionNotice(text, warn) {
    updateNetworkBadge(text, warn);
  }

  // ── Phases 3+4+8+9: Premium design system, mobile, and polish injection ─────────
  function injectPremiumStyles() {
    if (document.getElementById('ariaPremiumStyles')) return;
    const s = document.createElement('style');
    s.id = 'ariaPremiumStyles';
    s.textContent = `
      /* Focus */
      :focus-visible{outline:2px solid var(--orange);outline-offset:2px;border-radius:4px}

      /* Unified button feedback */
      .btn-sm,.q-opt,button.start-debate-btn{transition:all .15s cubic-bezier(.4,0,.2,1) !important}
      .btn-sm:active:not(:disabled),.q-opt:active:not(:disabled){transform:scale(.97) !important;filter:brightness(.97)}
      button:disabled{cursor:not-allowed;opacity:.55}

      /* Phase 8: Mobile — remove tap highlight, enable momentum scrolling */
      button,.btn-sm,input,select,textarea,a{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
      .compete-chat,.debate-chat,.cc-chat{-webkit-overflow-scrolling:touch;overscroll-behavior:contain}

      /* Phase 8: Minimum touch target */
      .btn-sm{min-height:40px}

      /* Phase 8: Prevent iOS input zoom (requires font-size >= 16px on inputs) */
      input[type="text"],input[type="email"],input[type="search"],textarea{font-size:max(16px,1em)}

      /* Phase 8: Safe area for room panels */
      .room-panel{padding-bottom:max(12px, env(safe-area-inset-bottom,0px))}

      /* Phase 8: 100dvh mobile viewport */
      @supports(height:100dvh){.al-right,.al-left,.aria-login{min-height:100dvh !important}}

      /* Room code readability */
      .room-code-display{font-variant-numeric:tabular-nums;letter-spacing:.12em !important;user-select:all;cursor:copy}

      /* Chat */
      .compete-chat,.cc-msg,.debate-chat{scroll-behavior:smooth}
      .cc-msg.me{background:var(--orange-pale) !important}
      .cc-msg.them{background:var(--cream2) !important}

      /* Scrollbars */
      *{scrollbar-width:thin;scrollbar-color:var(--border2) transparent}
      ::-webkit-scrollbar{width:4px;height:4px}
      ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}
      ::-webkit-scrollbar-track{background:transparent}

      /* Phase 9: Screen entry animation */
      @media(prefers-reduced-motion:no-preference){
        .screen.active{animation:ariaScreenIn .18s cubic-bezier(.4,0,.2,1) both}
        @keyframes ariaScreenIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
      }

      /* Phase 9: Player presence pulse */
      @media(prefers-reduced-motion:no-preference){
        .pc-dot{animation:ariaDotPulse 2.4s ease-in-out infinite}
        @keyframes ariaDotPulse{0%,100%{opacity:1}50%{opacity:.35}}
      }

      /* Phase 9: Smooth score counter */
      #liveYouScore,#liveFriendScore{display:inline-block;transition:transform .3s cubic-bezier(.34,1.56,.64,1)}

      /* Phase 9: Quiz answer states */
      .q-opt{transition:all .15s cubic-bezier(.4,0,.2,1) !important}
      .q-opt.correct{background:var(--green-pale) !important;color:var(--green) !important;border-color:rgba(45,125,79,.3) !important}
      .q-opt.wrong{background:var(--red-pale) !important;color:var(--red) !important;border-color:rgba(192,57,43,.3) !important}

      /* Phase 9: Debate topic input */
      #debateTopicInput:focus{border-color:var(--orange) !important;box-shadow:0 0 0 3px rgba(232,98,26,.08)}
      #verdictBtn{transition:all .15s cubic-bezier(.4,0,.2,1)}
      #verdictBtn:active{transform:scale(.97) !important}

      /* Phase 9: Player chip transition */
      .player-chip{transition:opacity .25s,transform .2s}
      .pc-dot{transition:background-color .3s}

      /* Toast + badge mobile safe area */
      @media(max-width:600px){
        #ariaToastContainer{right:10px !important;left:10px !important;max-width:none !important}
        #ariaProdNetBadge{bottom:calc(70px + env(safe-area-inset-bottom,0px)) !important}
      }
    `;
    document.head.appendChild(s);
  }

  // ── Phase 5: Adaptive intelligence — track correction patterns ────────────────
  function trackWeakAreas() {
    try {
      if (typeof SESSION === 'undefined' || !SESSION.corrections?.length) return;
      const stored = JSON.parse(localStorage.getItem('aria_weak_areas') || '{}');
      SESSION.corrections.forEach(c => {
        const key = (c.type || c.rule || 'grammar').toLowerCase().trim().slice(0, 40);
        if (key) stored[key] = (stored[key] || 0) + 1;
      });
      localStorage.setItem('aria_weak_areas', JSON.stringify(stored));
    } catch (_) {}
  }

  function getTopWeakAreas(n) {
    try {
      return Object.entries(JSON.parse(localStorage.getItem('aria_weak_areas') || '{}'))
        .sort((a, b) => b[1] - a[1]).slice(0, n || 3).map(e => e[0]);
    } catch (_) { return []; }
  }

  // ── Phase 6+7: Invisible intelligence — dashboard context panel ───────────────
  function injectDashboardIntelligence() {
    try {
      const weakAreas = getTopWeakAreas(3);
      if (!weakAreas.length) return;
      if (document.getElementById('ariaWeakAreasBadge')) return;
      const target = document.querySelector('#screenDash .dash-hero, #screenDash .dc-grid');
      if (!target) return;
      const banner = document.createElement('div');
      banner.id = 'ariaWeakAreasBadge';
      banner.style.cssText = 'max-width:700px;margin:0 auto 14px;padding:0 20px';
      banner.innerHTML = '<div style="background:var(--cream2);border:1px solid var(--border);border-radius:11px;padding:10px 14px;font-size:12.5px;color:var(--text2);display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-weight:600;color:var(--text);flex-shrink:0">Practice focus:</span>'
        + weakAreas.map(a => '<span style="background:var(--orange-pale);color:var(--orange);padding:2px 9px;border-radius:99px;font-weight:600;font-size:11.5px;white-space:nowrap">' + escapeHTML(String(a)) + '</span>').join('')
        + '</div>';
      target.parentNode.insertBefore(banner, target);
    } catch (_) {}
  }

  // ── Phase 7: Emotional continuity — returning-user awareness ─────────────────
  function injectContextualGreeting() {
    try {
      if (document.getElementById('ariaReturnMsg')) return;
      const sessions = JSON.parse(localStorage.getItem('aria_sessions') || '[]');
      if (sessions.length < 2) return;
      const last = sessions[sessions.length - 1];
      if (!last?.timestamp) return;
      const days = Math.floor((Date.now() - last.timestamp) / 86400000);
      let msg = null;
      if (days === 0) msg = 'You already had a session today — great consistency.';
      else if (days === 1) msg = "Yesterday's session laid good groundwork. Let's keep building.";
      else if (days >= 7) msg = "It's been a while — no pressure, just get back into the rhythm.";
      if (!msg) return;
      const anchor = document.querySelector('#screenDash h2, #screenDash .screen-title, #screenDash .dash-hero');
      if (!anchor) return;
      const el = document.createElement('p');
      el.id = 'ariaReturnMsg';
      el.style.cssText = 'font-size:13px;color:var(--text3);margin:2px 0 12px;font-style:italic;padding:0 20px;max-width:700px;margin-left:auto;margin-right:auto';
      el.textContent = msg;
      anchor.parentNode.insertBefore(el, anchor.nextSibling);
    } catch (_) {}
  }

  // Wire up production functions the instant this script executes — before any user
  // interaction, before DOMContentLoaded, before any API call completes.
  installGlobalOverrides();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
