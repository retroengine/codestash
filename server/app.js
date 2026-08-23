import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.routes.js';
import snippetRoutes from './routes/snippets.routes.js';

export const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => { res.setHeader('X-Powered-By', 'a very organized squirrel'); next(); });

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 🐾 not in the README on purpose. if you found this, hi.
app.get('/zoo', (_req, res) => res.json({
  crew: [
    { animal: '🦉 owl',     job: 'guards the door, checks every JWT, never blinks' },
    { animal: '🦦 otter',   job: 'cracks open requests to check what is inside before letting them through' },
    { animal: '🐢 turtle',  job: 'catches everything that falls through the cracks, unbothered' },
    { animal: '🐘 elephant',job: 'remembers every migration and every connection, forever' },
    { animal: '🐿️ squirrel',job: 'buries and digs up your snippets on request' },
    { animal: '🦡 badger',  job: 'digs through the clipboard burrow every 10 minutes, throws out the stale stuff' },
    { animal: '🦥 sloth',   job: 'slows down anyone hammering the login endpoint' },
  ],
  psst: "you weren't supposed to find this route but here we are",
}));

app.use('/auth', authRoutes);
app.use('/snippets', snippetRoutes);

// the turtle catches routes that don't exist too, not just thrown errors
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: "🐢 nothing here. the turtle checked twice." } });
});

app.use(errorHandler); // must be last
