import { randomBytes } from 'node:crypto';
import { customAlphabet } from 'nanoid';

const digits = customAlphabet('0123456789', 8);
const playerAlphabet = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 24);

export function newRoomCode() { return digits(); }
export function newPlayerId() { return `p_${playerAlphabet()}`; }
export function cleanRoomCode(code) { return String(code || '').replace(/\D/g, '').slice(0, 8); }
export function newSessionToken() { return randomBytes(32).toString('hex'); }
