import { COMPETE_QUESTIONS } from '../data/competeQuestions.js';

function seededRandom(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += h << 13; h ^= h >>> 7;
    h += h << 3; h ^= h >>> 17;
    h += h << 5;
    return (h >>> 0) / 4294967296;
  };
}

export function deterministicQuestions(roomCode, count = 8) {
  const rng = seededRandom(String(roomCode));
  const copy = COMPETE_QUESTIONS.map((q, idx) => ({ ...q, id: `q_${idx}` }));
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count).map(q => ({ ...q, opts: [...q.opts] }));
}

export function createGameState(roomCode, playerIds, mode = 'quiz') {
  const questions = deterministicQuestions(roomCode, mode === 'vocab' ? 8 : 8);
  return {
    mode,
    status: 'active',
    startedAt: new Date().toISOString(),
    currentQuestionIdx: 0,
    questionStartedAt: new Date().toISOString(),
    questionDurationMs: 20000,
    questions,
    scores: Object.fromEntries(playerIds.map(id => [id, 0])),
    answers: {},
    winner: null,
    version: 1
  };
}

export function currentQuestion(gameState) {
  if (!gameState || !Array.isArray(gameState.questions)) return null;
  return gameState.questions[gameState.currentQuestionIdx] || null;
}

export function answerQuestion(gameState, playerId, answerIdx) {
  if (!gameState || gameState.status !== 'active') return { gameState, accepted: false, reason: 'Game is not active.' };
  const q = currentQuestion(gameState);
  if (!q) return { gameState, accepted: false, reason: 'No active question.' };
  const idx = gameState.currentQuestionIdx;
  const answers = { ...(gameState.answers || {}) };
  const key = String(idx);
  answers[key] = { ...(answers[key] || {}) };
  if (answers[key][playerId]) return { gameState, accepted: false, reason: 'Answer already submitted.' };
  const correct = Number(answerIdx) === Number(q.correct);
  answers[key][playerId] = {
    answerIdx: Number(answerIdx),
    correct,
    at: new Date().toISOString()
  };
  const scores = { ...(gameState.scores || {}) };
  if (correct) scores[playerId] = Number(scores[playerId] || 0) + 1;
  const next = { ...gameState, answers, scores, version: Number(gameState.version || 0) + 1 };
  return { gameState: next, accepted: true, correct };
}

export function advanceGame(gameState) {
  if (!gameState || gameState.status !== 'active') return gameState;
  const nextIdx = Number(gameState.currentQuestionIdx || 0) + 1;
  if (nextIdx >= (gameState.questions || []).length) {
    const scores = gameState.scores || {};
    const sorted = Object.entries(scores).sort((a, b) => Number(b[1]) - Number(a[1]));
    const winner = sorted.length > 1 && sorted[0][1] === sorted[1][1] ? null : sorted[0]?.[0] || null;
    return {
      ...gameState,
      status: 'finished',
      finishedAt: new Date().toISOString(),
      winner,
      version: Number(gameState.version || 0) + 1
    };
  }
  return {
    ...gameState,
    currentQuestionIdx: nextIdx,
    questionStartedAt: new Date().toISOString(),
    version: Number(gameState.version || 0) + 1
  };
}
