// Local dev stand-in for Vercel's serverless functions — mounts the same
// api/admin/*.js handlers directly so the backend can be tested without a
// Vercel login. Not deployed; Vercel runs api/**/*.js as functions natively.
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import login from './api/admin/login.js';
import siteSettings from './api/admin/site-settings.js';
import users from './api/admin/users.js';
import userById from './api/admin/users/[id].js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.post('/api/admin/login', login);
app.get('/api/admin/site-settings', siteSettings);
app.patch('/api/admin/site-settings', siteSettings);
app.get('/api/admin/users', users);
app.patch('/api/admin/users/:id', (req, res) => {
  req.query.id = req.params.id;
  return userById(req, res);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CodeStash dev server running at http://localhost:${PORT}`));
