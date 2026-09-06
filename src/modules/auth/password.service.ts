import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  /**
   * Hashes a plaintext password using Argon2id.
   * Never logs passwords or hashes.
   */
  async hash(password: string): Promise<string> {
    try {
      return await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16, // 64 MB
        timeCost: 3,
        parallelism: 1,
      });
    } catch (error) {
      this.logger.error('Failed to hash password with Argon2id');
      throw error;
    }
  }

  /**
   * Verifies a plaintext password against a stored Argon2id hash.
   * Safe against timing attacks.
   */
  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      this.logger.warn('Password verification encountered an error');
      return false;
    }
  }
}
