export function getIceServers() {
  const urls = (process.env.TURN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const turnUrls = urls.filter(u => /^turns?:/i.test(u));
  const stunUrls = urls.filter(u => /^stuns?:/i.test(u));
  const iceServers = [];
  if (stunUrls.length) iceServers.push({ urls: stunUrls });
  if (turnUrls.length) {
    iceServers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME || undefined,
      credential: process.env.TURN_CREDENTIAL || undefined
    });
  }
  if (!iceServers.length) iceServers.push({ urls: ['stun:stun.l.google.com:19302'] });
  return { iceServers, ttlSeconds: 3600 };
}
