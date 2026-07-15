// Guess normalization and bilingual matching: English, 中文, and pinyin.

export function normalizeText(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?。！？，,;:'"'"]+$/g, '')
    .trim();
}

// "xiǎo māo", "xiao3 mao1", "xiaomao" all normalize to "xiaomao"
export function normalizePinyin(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip tone marks
    .replace(/[0-9]/g, '') // strip tone numbers
    .replace(/[\s'’]/g, '') // strip spaces and apostrophes
    .replace(/ü/g, 'v')
    .replace(/u:/g, 'v');
}

function stripWhitespace(text) {
  return String(text).replace(/\s+/g, '');
}

// Precompute normalized forms once when a word is selected.
export function prepareWord(word) {
  return {
    en: word.en,
    zh: word.zh,
    pinyin: word.pinyin,
    enNorm: normalizeText(word.en),
    zhNorm: stripWhitespace(word.zh),
    pinyinNorm: normalizePinyin(word.pinyin || ''),
  };
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[n];
}

// Returns 'correct', 'close', or 'wrong'.
export function checkGuess(prepared, rawText) {
  const norm = normalizeText(rawText);
  if (!norm) return 'wrong';

  if (norm === prepared.enNorm) return 'correct';
  if (stripWhitespace(rawText.trim()) === prepared.zhNorm) return 'correct';
  if (prepared.pinyinNorm && normalizePinyin(rawText) === prepared.pinyinNorm) return 'correct';

  const enThreshold = prepared.enNorm.length > 6 ? 2 : 1;
  if (levenshtein(norm, prepared.enNorm) <= enThreshold) return 'close';
  if (prepared.pinyinNorm) {
    const pinyinGuess = normalizePinyin(rawText);
    const pyThreshold = prepared.pinyinNorm.length > 6 ? 2 : 1;
    if (pinyinGuess && levenshtein(pinyinGuess, prepared.pinyinNorm) <= pyThreshold) return 'close';
  }
  return 'wrong';
}
