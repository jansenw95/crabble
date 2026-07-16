// Chat log rendering, including bilingual system messages.

const log = document.getElementById('chat-log');

function append(el) {
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.appendChild(el);
  if (atBottom) log.scrollTop = log.scrollHeight;
  while (log.children.length > 200) log.removeChild(log.firstChild);
}

function line(cls, html) {
  const div = document.createElement('div');
  div.className = 'chat-msg ' + cls;
  div.innerHTML = html;
  return div;
}

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const SYSTEM_TEXT = {
  joined: (p) => `👋 ${esc(p.name)} joined! 加入了!`,
  left: (p) => `${esc(p.name)} left 离开了`,
  rejoined: (p) => `🔄 ${esc(p.name)} is back! 回来了!`,
  kicked: (p) => `${esc(p.name)} was removed 被移除了`,
  drawerLeft: () => `The artist left 画画的人离开了 😢`,
  settings: (p) => `⚙️ Settings updated 设置已更新: ${p.drawSeconds}s · ${p.rounds} rounds 轮`,
};

export function addChat(msg) {
  if (msg.system) {
    const render = SYSTEM_TEXT[msg.kind];
    if (render) append(line('system', render(msg)));
    return;
  }
  const cls = msg.channel === 'guessed' ? 'guessed-channel' : '';
  append(line(cls, `<span class="who">${esc(msg.name)}:</span> ${esc(msg.text)}`));
}

export function addCorrectGuess(name, points) {
  append(line('correct', `🎉 ${esc(name)} guessed it! 猜对了! (+${points})`));
}

export function addCloseGuess() {
  append(line('close', `🔥 Close! 很接近!`));
}

export function addWordReveal(word) {
  append(
    line('reveal', `The word was 答案是: ${esc(word.en)} · ${esc(word.zh)} (${esc(word.pinyin)})`)
  );
}

export function addNotice(text) {
  append(line('system', esc(text)));
}
