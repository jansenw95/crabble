import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pinyin } from 'pinyin-pro';

function toPinyin(zh) {
  return pinyin(zh, { toneType: 'symbol', type: 'string' });
}

function loadBuiltin() {
  const path = fileURLToPath(new URL('./data/words.json', import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  for (const category of data.categories) {
    for (const word of category.words) {
      if (!word.pinyin) word.pinyin = toPinyin(word.zh);
    }
  }
  return data.categories;
}

export const builtinCategories = loadBuiltin();

// Parses teacher-pasted lines: "english,中文" or "english,中文,pinyin".
// Separators: half-width comma, full-width comma, or tab.
export function parseCustomList(text) {
  const words = [];
  const skippedLines = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/[,，\t]/).map((p) => p.trim());
    const [en, zh, py] = parts;
    if (!en || !zh || parts.length > 3) {
      skippedLines.push(i + 1);
      return;
    }
    if (en.length > 40 || zh.length > 20) {
      skippedLines.push(i + 1);
      return;
    }
    words.push({ en, zh, pinyin: py || toPinyin(zh) });
  });
  return { words, skippedLines };
}

export function buildPool(categoryIds, customWords) {
  const pool = [];
  const ids = new Set(categoryIds || []);
  for (const category of builtinCategories) {
    if (ids.has(category.id)) pool.push(...category.words);
  }
  if (Array.isArray(customWords)) pool.push(...customWords);
  return pool;
}

// Picks `count` distinct words not yet used this game; resets `used` if the
// pool is exhausted.
export function pickChoices(pool, used, count = 3) {
  let available = pool.filter((w) => !used.has(w.en + '|' + w.zh));
  if (available.length < count) {
    used.clear();
    available = [...pool];
  }
  const choices = [];
  while (choices.length < count && available.length > 0) {
    const i = Math.floor(Math.random() * available.length);
    choices.push(available.splice(i, 1)[0]);
  }
  return choices;
}

export function markUsed(used, word) {
  used.add(word.en + '|' + word.zh);
}
