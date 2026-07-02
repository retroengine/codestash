import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate, snippetCreateSchema, snippetUpdateSchema } from '../middleware/validate.js';
import * as ctrl from '../controllers/snippets.controller.js';

// 🐿️ squirrel territory below — bury, dig up, rearrange, or throw out an acorn.
const r = Router();
r.get('/', ctrl.list);                                            // public feed / search — no auth
r.get('/mine', requireAuth, ctrl.mine);                            // own snippets, cursor-paginated
r.post('/', requireAuth, validate(snippetCreateSchema), ctrl.create);
r.patch('/:id', requireAuth, validate(snippetUpdateSchema), ctrl.update); // ownership enforced in the service
r.delete('/:id', requireAuth, ctrl.remove);                        // ownership enforced in the service
export default r;
