// Bilingual hint masks. Hidden slots are '_' (English/pinyin letters) or '□'
// (Chinese characters); spaces and punctuation stay visible. The client turns
// these into styled blanks/boxes.

// Covers a-z plus the accented pinyin tone letters (ā, ǎ, ǚ, ...).
const LETTER = /[a-zA-ZÀ-ɏ]/;

export function createHint(word) {
  return {
    en: [...word.en].map((ch) => (LETTER.test(ch) ? '_' : ch)),
    py: [...(word.pinyin || '')].map((ch) => (LETTER.test(ch) ? '_' : ch)),
    zh: [...word.zh].map(() => '□'),
  };
}

export function countLetters(str) {
  return [...str].filter((ch) => LETTER.test(ch)).length;
}

// Reveals one random hidden slot of hint[key] from the source string.
// Never reveals the last hidden slot.
export function revealSlot(hint, key, source) {
  const mask = hint[key];
  const hidden = mask
    .map((ch, i) => (ch === '_' || ch === '□' ? i : -1))
    .filter((i) => i >= 0);
  if (hidden.length <= 1) return false;
  const i = hidden[Math.floor(Math.random() * hidden.length)];
  mask[i] = [...source][i];
  return true;
}
