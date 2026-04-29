type AuthEnv = {
  ADMIN_PASSWORD?: string;
  AUTH_SECRET?: string;
};

const cookieName = 'imagedock_session';
const sessionMaxAge = 60 * 60 * 12;

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function base64UrlEncode(value: string | ArrayBuffer) {
  const bytes = typeof value === 'string' ? textBytes(value) : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textBytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, textBytes(value));
  return base64UrlEncode(signature);
}

function getSecret(env: AuthEnv) {
  return env.AUTH_SECRET || env.ADMIN_PASSWORD || '';
}

export function getSessionCookieName() {
  return cookieName;
}

export function clearSessionCookie() {
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createSessionCookie(env: AuthEnv) {
  const secret = getSecret(env);
  if (!secret) throw new Error('ADMIN_PASSWORD 尚未設定。');

  const payload = base64UrlEncode(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + sessionMaxAge,
    }),
  );
  const signature = await sign(payload, secret);

  return `${cookieName}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionMaxAge}`;
}

export async function isAuthenticated(request: Request, env: AuthEnv) {
  const secret = getSecret(env);
  if (!secret) return false;

  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));

  if (!cookie) return false;

  const token = cookie.slice(cookieName.length + 1);
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expectedSignature = await sign(payload, secret);
  if (signature !== expectedSignature) return false;

  try {
    const session = JSON.parse(base64UrlDecode(payload)) as { exp?: number };
    return typeof session.exp === 'number' && session.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
