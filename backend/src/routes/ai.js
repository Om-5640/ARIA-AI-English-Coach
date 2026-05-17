import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { proxyChatCompletion, proxyTranscription } from '../services/groqClient.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

export function aiRouter() {
  const router = express.Router();
  const aiLimit = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    limit: Number(process.env.AI_RATE_LIMIT_MAX || 30),
    standardHeaders: 'draft-8',
    legacyHeaders: false
  });

  router.post('/chat', aiLimit, async (req, res, next) => {
    try {
      const data = await proxyChatCompletion(req.body || {});
      res.json(data);
    } catch (error) { next(error); }
  });

  router.post('/transcribe', aiLimit, upload.single('file'), async (req, res, next) => {
    try {
      const data = await proxyTranscription(req.file);
      res.json(data);
    } catch (error) { next(error); }
  });

  return router;
}
