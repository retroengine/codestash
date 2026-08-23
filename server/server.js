import { app } from './app.js';
import { config } from './config.js';
import { startCleanupJob } from './jobs/cleanup.js';

const BANNER = `
   ______          __     _____ __             __
  / ____/___  ____/ /__  / ___// /_____ ______/ /_
 / /   / __ \\/ __  / _ \\ \\__ \\/ __/ __ \`/ ___/ __ \\
/ /___/ /_/ / /_/ /  __/___/ / /_/ /_/ (__  ) / / /
\\____/\\____/\\__,_/\\___//____/\\__/\\__,_/____/_/ /_/

   🦉 owl on the door · 🦦 otter checking bags · 🐢 turtle on cleanup duty
   🐘 elephant remembers everything · 🐿️ squirrel guarding the acorns
`;

console.log(BANNER);
startCleanupJob();
app.listen(config.port, () => console.log(`🐿️ the crew is awake — API on :${config.port}`));
