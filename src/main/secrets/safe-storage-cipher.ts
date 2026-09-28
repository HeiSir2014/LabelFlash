import { safeStorage } from 'electron';
import type { SecretCipher } from '../storage/sqlite-secret-store';

/** Electron safeStorage：Windows 用 DPAPI、macOS 用钥匙串里的密钥加密，只有本机本用户能解开。 */
export const safeStorageCipher: SecretCipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (data) => safeStorage.decryptString(Buffer.from(data)),
};
