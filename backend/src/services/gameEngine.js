import { randomInt } from 'node:crypto';
import { COMPETE_QUESTIONS } from '../data/competeQuestions.js';
import { DEBATE_TOPICS } from '../data/debateTopics.js';

export function randomQuestions(count = 8) {
  const copy = COMPETE_QUESTIONS.map((q, idx) => ({ ...q, id: `q_${idx}`, opts: [...q.opts] }));
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

export function createGameState(playerIds, mode = 'quiz', customTopic = '') {
  if (mode === 'debate') {
    const topic = customTopic || DEBATE_TOPICS[randomInt(DEBATE_TOPICS.length)];
    const shuffled = [...playerIds].sort(() => (randomInt(2) ? 1 : -1));
    return {
      mode,
      status: 'active',
      startedAt: new Date().toISOString(),
      topic,
      stanceFor: shuffled[0],
      stanceAgainst: shuffled[1] || shuffled[0],
      questions: [],
      scores: Object.fromEntries(playerIds.map(id => [id, 0])),
      answers: {},
      winner: null,
      version: 1
    };
  }
  const questions = randomQuestions(8);
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
