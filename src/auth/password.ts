import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
const KEY_LENGTH = 64;

/** Băm mật khẩu: `scrypt$<salt base64>$<hash base64>` (scrypt mặc định N=16384, r=8, p=1). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(
    password,
    Buffer.from(salt, 'base64'),
    expected.length,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
