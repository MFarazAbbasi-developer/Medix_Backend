import { describe, it, expect, beforeEach } from 'vitest';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let passwordService: PasswordService;

  beforeEach(() => {
    passwordService = new PasswordService();
  });

  it('should securely hash a password using Argon2id', async () => {
    const rawPassword = 'SecurePharmaPassword2026!';
    const hash = await passwordService.hash(rawPassword);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(rawPassword);
    expect(hash).toContain('$argon2id$');
  });

  it('should verify a valid password against its hash', async () => {
    const rawPassword = 'CorrectPassword123#';
    const hash = await passwordService.hash(rawPassword);

    const isValid = await passwordService.verify(hash, rawPassword);
    expect(isValid).toBe(true);
  });

  it('should reject an incorrect password', async () => {
    const rawPassword = 'CorrectPassword123#';
    const hash = await passwordService.hash(rawPassword);

    const isValid = await passwordService.verify(hash, 'WrongPassword456!');
    expect(isValid).toBe(false);
  });
});
