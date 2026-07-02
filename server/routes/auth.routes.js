import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { registerCtrl, loginCtrl } from '../controllers/auth.controller.js';
import { validate, credsSchema } from '../middleware/validate.js';

// 🦥 the sloth — deliberately, personally responsible for making your 11th login
// attempt in 15 minutes take forever. not sorry.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }); // 10 tries / 15 min / IP
const r = Router();
r.post('/register', validate(credsSchema), registerCtrl);
r.post('/login', loginLimiter, validate(credsSchema), loginCtrl);
export default r;
