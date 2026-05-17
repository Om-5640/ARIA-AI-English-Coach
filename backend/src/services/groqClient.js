import { HttpError } from '../utils/errors.js';

const GROQ_BASE = 'https://api.groq.com/openai/v1';

function requireKey() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new HttpError(503, 'Server AI key is not configured.', 'ai_not_configured');
  return key;
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) throw new HttpError(400, 'messages must be an array.', 'invalid_messages');
  return messages.slice(-24).map(m => ({
    role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user',
    content: String(m.content || '').slice(0, 12000)
  })).filter(m => m.content.trim());
}

export async function proxyChatCompletion(body = {}) {
  const key = requireKey();
  const payload = {
    model: body.model || process.env.GROQ_CHAT_MODEL || 'llama-3.3-70b-versatile',
    messages: sanitizeMessages(body.messages),
    temperature: Number.isFinite(Number(body.temperature)) ? Math.min(1.5, Math.max(0, Number(body.temperature))) : 0.5,
    max_tokens: Number.isFinite(Number(body.max_tokens)) ? Math.min(1200, Math.max(1, Number(body.max_tokens))) : 500,
    response_format: body.response_format && typeof body.response_format === 'object' ? body.response_format : undefined
  };
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, data?.error?.message || 'AI provider error.', 'ai_provider_error', data);
  return data;
}

export async function proxyTranscription(file) {
  const key = requireKey();
  if (!file?.buffer?.length) throw new HttpError(400, 'Audio file is required.', 'missing_audio');
  if (file.size > 25 * 1024 * 1024) throw new HttpError(413, 'Audio file is too large.', 'audio_too_large');
  const form = new FormData();
  const blob = new Blob([file.buffer], { type: file.mimetype || 'audio/webm' });
  form.append('file', blob, file.originalname || 'audio.webm');
  form.append('model', process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo');
  form.append('language', 'en');
  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, data?.error?.message || 'Transcription provider error.', 'stt_provider_error', data);
  return data;
}
