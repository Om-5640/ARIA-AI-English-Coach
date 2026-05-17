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
      started: false
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
      const existing = localStorage.getItem('aria_player_id');
      if (existing) return existing;
      const id = 'p_' + crypto.getRandomValues(new Uint32Array(4)).join('_');
      localStorage.setItem('aria_player_id', id);
      return id;
    } catch (_) {
      return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    }
  }

  function getStoredSessionToken() {
    try { return localStorage.getItem('aria_session_token') || ''; } catch (_) { return ''; }
  }

  function storeSessionToken(token) {
    PROD.sessionToken = token || '';
    try { if (token) localStorage.setItem('aria_session_token', token); else localStorage.removeItem('aria_session_token'); } catch (_) {}
  }

  function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    // Attach session token for all authenticated room/webrtc endpoints
    if (PROD.sessionToken && /^\/api\/(rooms\/|webrtc\/rooms\/)/.test(path)) {
      headers['Authorization'] = 'Bearer ' + PROD.sessionToken;
    }
    return originalFetch(path, { ...options, headers }).then(async res => {
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
    });
  }

  async function boot() {
    // These are pure DOM/event-listener work — no backend needed, run immediately.
    patchOnboarding();
    patchPeerUi();
    installLifecycleGuards();
    try {
      PROD.config = await api('/api/config');
      await api('/api/health');
      connectRealtime();
      showProductionNotice('Production realtime backend connected. API keys stay on the server.');
    } catch (error) {
      showProductionNotice('Backend not reachable — start the ARIA backend for realtime rooms, calls, and AI.', true);
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
        if (!name) { alert('Please enter your name!'); if (nameEl) nameEl.focus(); return; }
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

    // Primary dispatch namespace — HTML stubs call through here.
    PROD.fn = {
      startCompeteRoom: productionStartCompeteRoom,
      joinRoom: productionJoinRoom,
      sendCompeteMsg: productionSendCompeteMsg,
      startCompeteGame: productionStartCompeteGame,
      answerCompeteQ: productionAnswerCompeteQ,
      closeCompeteRoom: productionCloseCompeteRoom,
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
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + (PROD.config?.realtimePath || '/realtime'));
    PROD.ws = ws;
    ws.onopen = () => {
      PROD.wsReady = true;
      PROD.wsBackoffMs = 600;
      if (PROD.room?.code) subscribeRoom(PROD.room.code);
      if (PROD.call.room?.code) subscribeRoom(PROD.call.room.code);
      updateNetworkBadge('Realtime connected');
    };
    ws.onmessage = event => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }
      handleRealtimeMessage(msg);
    };
    ws.onclose = () => {
      PROD.wsReady = false;
      updateNetworkBadge('Realtime reconnecting…', true);
      PROD.wsTimer = setTimeout(connectRealtime, PROD.wsBackoffMs);
      PROD.wsBackoffMs = Math.min(PROD.wsBackoffMs * 1.7, 8000);
    };
    ws.onerror = () => updateNetworkBadge('Realtime connection issue', true);
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
      alert('Could not create room: ' + error.message);
    }
  }

  async function productionJoinRoom() {
    const code = (document.getElementById('joinCodeInput')?.value || '').replace(/\D/g, '').slice(0, 8);
    if (code.length !== 8) { alert('Please enter an 8-digit room code.'); return; }
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
      setTextSafe('roomStatus', '✅ Joined! Waiting for host to start the game…');
      setTextSafe('playerSelfName', currentDisplayName());
      renderChatEvents(data.events || []);
      subscribeRoom(code);
      applyCompeteSnapshot(data);
    } catch (error) {
      alert('Room join failed: ' + error.message);
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
      alert('Message failed: ' + error.message);
    }
  }

  async function productionStartCompeteGame() {
    if (!PROD.room?.code) return;
    try {
      await api('/api/rooms/' + PROD.room.code + '/start', {
        method: 'POST',
        body: JSON.stringify({ playerId: PROD.playerId })
      });
    } catch (error) {
      alert('Could not start game: ' + error.message);
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
      await api('/api/rooms/' + PROD.room.code + '/answer', {
        method: 'POST',
        body: JSON.stringify({ playerId: PROD.playerId, answerIdx: idx })
      });
    } catch (error) {
      PROD.answeredQuestions.delete(qIdx);
      opts.forEach(o => { o.disabled = false; });
      alert('Answer rejected: ' + error.message);
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
    try { ACTIVE_ACTIVITY = { type: null, status: 'idle', snapshot: null, updatedAt: Date.now() }; localStorage.removeItem(ACTIVITY_STORAGE_KEY); renderActivityBar(); } catch (_) {}
  }

  function renderRoomCreated(room, mode) {
    document.getElementById('competeModeGrid') && (document.getElementById('competeModeGrid').style.display = 'none');
    document.getElementById('joinRoomPanel')?.classList.remove('active');
    document.getElementById('liveGamePanel')?.classList.remove('active');
    document.getElementById('createRoomPanel')?.classList.add('active');
    setTextSafe('roomCodeDisplay', room.code);
    const labels = { debate: '⚖️ DEBATE BATTLE', quiz: '⚡ QUIZ RACE', vocab: '📚 VOCAB SHOWDOWN' };
    setTextSafe('roomModeLabel', labels[mode] || String(mode).toUpperCase());
    setTextSafe('playerSelfName', currentDisplayName());
    setTextSafe('roomStatus', '⏳ Waiting for your friend to join… Share this code.');
    const btn = document.getElementById('startGameBtn');
    if (btn) { btn.disabled = true; btn.textContent = '▶ Start Game (need 2 players)'; }
    const chat = document.getElementById('competeChat');
    if (chat) chat.innerHTML = '<div class="cc-msg system">Room created! Share code ' + escapeHTML(room.code) + ' with a friend.</div>';
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
      setTextSafe('roomStatus', connected.length >= 2 ? '✅ ' + connected.map(p => p.displayName).join(' & ') + ' are in the room!' : '⏳ Waiting for your friend to join… Share this code.');
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

  function renderAuthoritativeGame(room, players) {
    const gs = room.gameState;
    document.getElementById('createRoomPanel')?.classList.remove('active');
    document.getElementById('liveGamePanel')?.classList.add('active');
    const me = players.find(p => p.playerId === PROD.playerId);
    const friend = players.find(p => p.playerId !== PROD.playerId) || players[0];
    setTextSafe('liveYouName', me?.displayName || currentDisplayName());
    setTextSafe('liveFriendName', friend?.displayName || 'Friend');
    setTextSafe('liveYouScore', String(gs.scores?.[PROD.playerId] || 0));
    setTextSafe('liveFriendScore', String(gs.scores?.[friend?.playerId] || 0));
    setTextSafe('liveGameLabel', ({ quiz: '⚡ QUIZ RACE', debate: '⚖️ DEBATE BATTLE', vocab: '📚 VOCAB SHOWDOWN' }[room.mode] || 'LIVE GAME'));
    const result = document.getElementById('liveGameResult'); if (result) result.style.display = 'none';
    const area = document.getElementById('liveQuestionArea'); if (area) area.style.display = 'block';
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
      showPeerArea(data.room.code, '⏳ Share this call code with your friend…');
      subscribeRoom(data.room.code);
      applyCallSnapshot(data);
    } catch (error) {
      setPeerStatus('Call setup failed: ' + error.message, true);
      await productionEndPeerCall(error.message, true);
    }
  }

  async function productionJoinPeerCall() {
    const code = (document.getElementById('peerAnswerInput')?.value || '').replace(/\D/g, '').slice(0, 8);
    if (code.length !== 8) { alert('Enter the 8-digit call code from your friend.'); return; }
    try {
      // Only tear down a prior call — do NOT touch the UI so peerVideoArea stays visible
      if (PROD.call.room) await productionEndPeerCall('Joining another call', true);

      // Show UI before any async work so status messages are always visible to the user
      var pv = document.getElementById('peerVideoArea');
      if (pv) pv.style.display = 'block';
      setPeerStatus('🔗 Joining call…');

      const data = await api('/api/rooms/' + code + '/join', {
        method: 'POST',
        body: JSON.stringify({ displayName: currentDisplayName(), playerId: PROD.playerId })
      });
      storeSessionToken(data.sessionToken);
      PROD.call.room = data.room;
      PROD.call.mode = data.room.mode === 'call-voice' ? 'voice' : 'video';
      PROD.call.polite = true;
      await prepareLocalMedia(PROD.call.mode);
      showPeerArea(code, '🟡 Joined! Connecting to your friend…');
      applyCallSnapshot(data);
      subscribeRoom(code);
    } catch (error) {
      // alert() is always visible regardless of whether peerVideoArea is shown or hidden
      alert('Could not join call: ' + error.message);
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
        setPeerStatus('⚠️ Camera in use by another app — switching to voice-only.', true);
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
      setPeerStatus('⏳ Waiting for your friend to join — code: ' + data.room.code);
      return;
    }
    if (!PROD.call.localStream) return;
    const remote = players.find(p => p.playerId !== PROD.playerId);
    if (!remote) return;
    setPeerStatus('🟡 Connecting to ' + (remote.displayName || 'your friend') + '…');

    if (PROD.call.pc) {
      // PC already exists. If we are the host (impolite) and the connection is not yet
      // established, re-send the local offer so the joiner — who may have subscribed
      // after the first offer was broadcast — can receive and answer it.
      const state = PROD.call.pc.connectionState;
      if (!PROD.call.polite && state === 'new' && !PROD.call.makingOffer) {
        reOffer(PROD.call.pc, remote.playerId);
      }
      return;
    }
    ensurePeerConnection(remote.playerId).catch(error => setPeerStatus('Peer setup failed: ' + error.message, true));
  }

  // Re-sends the host's existing local offer to the remote peer.
  // Called when a new room snapshot arrives and the host's PC is in 'new' state
  // (offer was sent but joiner had not subscribed yet and missed it).
  async function reOffer(pc, remotePlayerId) {
    try {
      PROD.call.makingOffer = true;
      // Re-use the current local description if present; otherwise create a fresh offer.
      if (pc.localDescription && pc.localDescription.type === 'offer') {
        await sendSignal('offer', { description: pc.localDescription }, remotePlayerId);
      } else {
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
        setPeerStatus('🟢 Connected!');
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
      if (s === 'connecting') setPeerStatus('🟡 Exchanging connection info…');
      if (s === 'connected') {
        setPeerStatus('🟢 Connected!');
        const offerSec = document.getElementById('peerOfferSection');
        if (offerSec) offerSec.style.display = 'none';
        try { updateActiveCall({ status: 'connected', connectedAt: Date.now() }); } catch (_) {}
        try { window.renderCallState(); } catch (_) {}
      }
      if (s === 'disconnected') setPeerStatus('⚠️ Connection interrupted — trying to recover…', true);
      if (s === 'failed') { setPeerStatus('⚠️ Restarting ICE…', true); pc.restartIce(); }
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
    const pc = await ensurePeerConnection(signal.fromPlayerId);
    if (signal.type === 'candidate') {
      try { await pc.addIceCandidate(signal.payload.candidate); } catch (error) { if (!PROD.call.ignoreOffer) throw error; }
      return;
    }
    if (signal.type === 'offer' || signal.type === 'answer') {
      const description = signal.payload.description;
      const readyForOffer = !PROD.call.makingOffer && (pc.signalingState === 'stable' || PROD.call.isSettingRemoteAnswerPending);
      const offerCollision = signal.type === 'offer' && !readyForOffer;
      PROD.call.ignoreOffer = !PROD.call.polite && offerCollision;
      if (PROD.call.ignoreOffer) return;
      PROD.call.isSettingRemoteAnswerPending = description.type === 'answer';
      await pc.setRemoteDescription(description);
      PROD.call.isSettingRemoteAnswerPending = false;
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
    navigator.clipboard?.writeText(code).then(() => setPeerStatus('✅ Call code copied.')).catch(() => alert('Call code: ' + code));
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
      productionEndPeerCall('Page closed', true);
      if (PROD.room?.code) api('/api/rooms/' + PROD.room.code + '/leave', { method: 'POST', body: JSON.stringify({ playerId: PROD.playerId }) }).catch(() => {});
    });
    window.addEventListener('online', () => updateNetworkBadge('Back online'));
    window.addEventListener('offline', () => updateNetworkBadge('Offline — realtime paused', true));
  }

  function updateNetworkBadge(text, warn) {
    let el = document.getElementById('ariaProdNetBadge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ariaProdNetBadge';
      el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;padding:8px 11px;border-radius:999px;background:#fff;border:1px solid var(--border2);font-size:11px;color:var(--text2);box-shadow:0 4px 16px rgba(45,26,14,.08);opacity:.96;transition:opacity .2s';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.borderColor = warn ? 'rgba(192,57,43,.35)' : 'var(--border2)';
    el.style.color = warn ? 'var(--red)' : 'var(--text2)';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.opacity = '.25'; }, 3000);
  }

  function showProductionNotice(text, warn) {
    updateNetworkBadge(text, warn);
  }

  // Wire up production functions the instant this script executes — before any user
  // interaction, before DOMContentLoaded, before any API call completes.
  // This is why the "Realtime calling is still loading" alert was appearing: the
  // overrides were gated behind two awaited API calls, so clicking early showed the stub.
  installGlobalOverrides();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
