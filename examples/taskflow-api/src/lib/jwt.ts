import { SignJWT, jwtVerify } from 'jose';

const alg = 'HS256';

function secretKey(): Uint8Array {
  const s = process.env.TASKFLOW_JWT_SECRET ?? 'dev-secret-change-me';
  return new TextEncoder().encode(s);
}

export interface JwtPayload {
  sub: string;
  email: string;
}

export async function signToken(userId: number, email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey());
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secretKey(), { algorithms: [alg] });
  const sub = payload.sub;
  const email = payload.email;
  if (!sub || typeof email !== 'string') throw new Error('Invalid token payload');
  return { sub, email };
}
