// Bilingual hint masks. English letters mask to "_" (spaces/hyphens stay visible);
// Chinese characters mask to "□".

export function createHint(word) {
  return {
    en: [...word.en].map((ch) => (/[a-zA-Z]/.test(ch) ? '_' : ch)),
    zh: [...word.zh].map(() => '□'),
  };
}

function hiddenIndices(mask, placeholder) {
  return mask.map((ch, i) => (ch === placeholder ? i : -1)).filter((i) => i >= 0);
}

export function revealEnglishLetter(hint, word) {
  const hidden = hiddenIndices(hint.en, '_');
  // Never reveal the last hidden letter.
  if (hidden.length <= 1) return false;
  const i = hidden[Math.floor(Math.random() * hidden.length)];
  hint.en[i] = [...word.en][i];
  return true;
}

export function revealChineseChar(hint, word) {
  // Revealing a character of a 1-2 char word gives it away.
  if ([...word.zh].length < 3) return false;
  const hidden = hiddenIndices(hint.zh, '□');
  if (hidden.length <= 1) return false;
  const i = hidden[Math.floor(Math.random() * hidden.length)];
  hint.zh[i] = [...word.zh][i];
  return true;
}
