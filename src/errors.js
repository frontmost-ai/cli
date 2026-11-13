/** A wrong command, flag, or setting. Exit code 2. No request was sent. */
export class UsageError extends Error {}

/** The API refused the request, or the network failed. Exit code 1. */
export class ApiError extends Error {
  /** @param {string} message @param {{ code?: string, request_id?: string, body?: unknown }} [info] */
  constructor(message, info = {}) {
    super(message);
    this.code = info.code;
    this.requestId = info.request_id;
    this.body = info.body;
  }
}
