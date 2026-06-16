'use strict';

/**
 * Recent-projects list for the desktop app. Stored as a small JSON file in the
 * OS app-data dir (NOT inside any project), so it persists across launches and
 * survives deleting/moving individual projects.
 *
 * Entry shape: { path, name, lastOpenedAt }. Most-recent first, de-duplicated by
 * path, capped at MAX_RECENTS. listRecents() drops entries whose folder is gone.
 */

const path = require('path');
const fs = require('fs/promises');
const { app } = require('electron');

const MAX_RECENTS = 10;
const PROJECT_FILE = 'viz-project.json';

function recentsFilePath() {
  return path.join(app.getPath('userData'), 'recent-projects.json');
}

async function readRecents() {
  try {
    const raw = await fs.readFile(recentsFilePath(), 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeRecents(list) {
  try {
    await fs.writeFile(recentsFilePath(), JSON.stringify(list, null, 2), 'utf-8');
  } catch {
    /* best-effort: a missing recents file is non-fatal */
  }
}

/** Record (or bump to the top) a project that was just opened/created. */
async function recordRecent(projectRoot, name) {
  if (!projectRoot) return;
  const root = path.resolve(projectRoot);
  const entry = {
    path: root,
    name: name || path.basename(root),
    lastOpenedAt: new Date().toISOString()
  };
  const list = await readRecents();
  const deduped = list.filter((e) => e && e.path && path.resolve(e.path) !== root);
  deduped.unshift(entry);
  await writeRecents(deduped.slice(0, MAX_RECENTS));
}

/** List recent projects whose folder still contains a project file. */
async function listRecents() {
  const list = await readRecents();
  const checked = await Promise.all(
    list.map(async (e) => {
      if (!e || !e.path) return null;
      try {
        await fs.access(path.join(e.path, PROJECT_FILE));
        return e;
      } catch {
        return null; // folder moved/deleted — drop it
      }
    })
  );
  return checked.filter(Boolean);
}

module.exports = { recordRecent, listRecents };
