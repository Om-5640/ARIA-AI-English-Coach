export class HttpError extends Error {
  constructor(status, message, code = 'error', details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function assertOrThrow(condition, status, message, code = 'invalid_request', details = undefined) {
  if (!condition) throw new HttpError(status, message, code, details);
}
