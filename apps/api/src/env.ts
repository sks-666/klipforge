import fs from 'fs';
import path from 'path';

/**
 * Loads apps/api/.env (git-ignored local secrets such as YOUTUBE_CLIENT_SECRET) before anything
 * else runs. Values already set in the real environment (e.g. by launchd) win.
 */
const file = path.resolve(__dirname, '../.env');
if (fs.existsSync(file) && process.env.NODE_ENV !== 'test') {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
