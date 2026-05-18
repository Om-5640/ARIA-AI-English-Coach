import { logger } from '../utils/logger.js';

export class LocalPubSub {
  publish() {}
  onMessage() {}
  async close() {}
}

export class RedisPubSub {
  constructor(pub, sub) {
    this._pub = pub;
    this._sub = sub;
  }

  publish(channel, message) {
    this._pub.publish(channel, JSON.stringify(message)).catch(err =>
      logger.warn('Redis publish failed', { channel, error: err.message })
    );
  }

  onMessage(handler) {
    this._sub.on('pmessage', (_pattern, channel, data) => {
      try { handler(channel, JSON.parse(data)); } catch {}
    });
    this._sub.psubscribe('room:*').catch(err =>
      logger.warn('Redis psubscribe failed', { error: err.message })
    );
  }

  async close() {
    await Promise.all([this._pub.quit(), this._sub.quit()]).catch(() => {});
  }
}

export async function createPubSub() {
  const url = process.env.REDIS_URL;
  if (!url) return new LocalPubSub();
  try {
    const { default: Redis } = await import('ioredis');
    const opts = { lazyConnect: true, maxRetriesPerRequest: 3, enableReadyCheck: true };
    const pub = new Redis(url, opts);
    const sub = new Redis(url, opts);
    await Promise.all([pub.connect(), sub.connect()]);
    logger.info('Redis pub/sub connected', { url: url.replace(/:[^:@]+@/, ':***@') });
    pub.on('error', err => logger.warn('Redis pub error', { error: err.message }));
    sub.on('error', err => logger.warn('Redis sub error', { error: err.message }));
    return new RedisPubSub(pub, sub);
  } catch (err) {
    logger.warn('Redis unavailable — single-instance mode', { error: err.message });
    return new LocalPubSub();
  }
}
