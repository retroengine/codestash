import { z } from 'zod';

/* 🦦 the otter — cracks every request open on a rock before letting it through.
   if what's inside doesn't look right, it goes back in the river. */

export const validate = (schema) => (req, _res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    const e = new Error(parsed.error.issues[0].message);
    e.status = 400; e.code = 'VALIDATION'; return next(e);
  }
  req.body = parsed.data;
  next();
};

export const credsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const snippetCreateSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  language: z.string().max(50).optional(),
  is_public: z.boolean().optional(),
});

export const snippetUpdateSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  language: z.string().max(50).optional(),
  is_public: z.boolean().optional(),
});
