
import express from 'express';
import { prisma } from '../prisma';
import { z } from 'zod';

const router = express.Router();

const sessionSchema = z.object({
  session_id: z.string().min(1, 'session_id is required'),
  site_id: z.string().optional(),
  page: z.string().min(1, 'page is required'),
  events: z.array(z.any()),
});


router.post('/', async (req, res): Promise<void> => {
  try {
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorMessages = parsed.error.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      res.status(400).json({ error: errorMessages });
      return;
    }

    const { session_id, site_id, page, events } = parsed.data;
    const newSession = await prisma.session.create({
      data: { session_id, siteId: site_id ?? null, page, events },
    });

    res.status(201).json(newSession);
  } catch (err) {
    console.error('Error saving session:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


router.get('/sessions', async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      prisma.session.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.session.count(),
    ]);

    res.status(200).json({
      page,
      limit,
      totalSessions: total,
      totalPages: Math.ceil(total / limit),
      sessions,
    });
  } catch (err) {
    console.error('Error fetching sessions:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/session/:sessionId', async (req, res): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const session = await prisma.session.findFirst({
      where: { session_id: sessionId },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json(session);
  } catch (err) {
    console.error('Error fetching session:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;