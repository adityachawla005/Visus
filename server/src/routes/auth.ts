import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { hashPassword, verifyPassword, signToken, requireAuth } from '../auth';
import { rateLimit, clientIp } from '../security';

const router = Router();

// Throttle credential endpoints per IP to blunt brute-force / credential stuffing.
const AUTH_MAX = 10;
const AUTH_WINDOW_MS = 5 * 60_000;
function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!rateLimit(`auth:${clientIp(req)}`, AUTH_MAX, AUTH_WINDOW_MS)) {
    res.status(429).json({ error: 'Too many attempts — please try again in a few minutes.' });
    return;
  }
  next();
}

const credsSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name:     z.string().min(1).optional(),
});

// Login only needs a well-formed email + a non-empty password; length rules are
// a registration concern. This keeps wrong-password attempts at 401, not 400.
const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// POST /auth/register
router.post('/register', authRateLimit, async (req: Request, res: Response): Promise<void> => {
  const parsed = credsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }
  const { email, password, name } = parsed.data;

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'An account with that email already exists' });
      return;
    }

    const user = await prisma.user.create({
      data: { email, name: name ?? null, passwordHash: await hashPassword(password) },
    });

    const token = signToken({ id: user.id, email: user.email });
    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/login
router.post('/login', authRateLimit, async (req: Request, res: Response): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }
  const { email, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    // Same response whether the email is unknown or the password is wrong.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken({ id: user.id, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /auth/me — current user (validates the token)
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, name: true },
  });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ user });
});

export default router;
