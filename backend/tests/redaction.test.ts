import { describe, it, expect } from 'vitest';
import pino from 'pino';

describe('Logger Redaction Unit Tests', () => {
  it('should redact sensitive password and token fields in pino output stream', () => {
    let logOutput = '';

    const testLogger = pino(
      {
        level: 'info',
        redact: {
          paths: ['password', 'token', 'Password', 'Token'],
          censor: '[REDACTED]',
        },
      },
      {
        write: (msg: string) => {
          logOutput += msg;
        },
      }
    );

    testLogger.info({
      password: 'super-secret-password',
      token: 'secret-bearer-jwt-token',
      normalField: 'public-data',
    });

    expect(logOutput).not.toContain('super-secret-password');
    expect(logOutput).not.toContain('secret-bearer-jwt-token');
    expect(logOutput).toContain('[REDACTED]');
    expect(logOutput).toContain('public-data');
  });
});
