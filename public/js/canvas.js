// Drawing engine: local strokes + socket sync. Coordinates travel normalized
// (0-1); the canvas renders at a fixed logical 800x600.

const LOGICAL_W = 800;
const LOGICAL_H = 600;
const FLUSH_MS = 40;
const ERASER_COLOR = '#ffffff';

export const COLORS = [
  '#2d3142', '#95a5a6', '#e74c3c', '#e67e22', '#f1c40f',
  '#2ecc71', '#3498db', '#9b59b6', '#ff7bac', '#8d5a3b',
];

export const SIZES = [4, 9, 18];

export function createCanvas(canvasEl, socket) {
  const ctx = canvasEl.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvasEl.width = LOGICAL_W * dpr;
  canvasEl.height = LOGICAL_H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let strokes = [];
  let enabled = false;
  let tool = 'brush';
  let color = COLORS[0];
  let size = SIZES[1];
  let activeStroke = null;
  let pending = [];
  let flushTimer = null;

  function strokeStyle(s) {
    ctx.strokeStyle = s.tool === 'eraser' ? ERASER_COLOR : s.color;
    ctx.lineWidth = s.tool === 'eraser' ? s.size * 2.5 : s.size;
  }

  function drawSegments(s, fromIndex) {
    const pts = s.points;
    if (pts.length < 2) return;
    strokeStyle(s);
    ctx.beginPath();
    const start = Math.max(0, fromIndex - 2);
    ctx.moveTo(pts[start] * LOGICAL_W, pts[start + 1] * LOGICAL_H);
    for (let i = start + 2; i < pts.length - 1; i += 2) {
      ctx.lineTo(pts[i] * LOGICAL_W, pts[i + 1] * LOGICAL_H);
    }
    ctx.stroke();
  }

  function drawDot(s) {
    strokeStyle(s);
    ctx.beginPath();
    ctx.arc(s.points[0] * LOGICAL_W, s.points[1] * LOGICAL_H, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }

  function redrawAll() {
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    for (const s of strokes) {
      drawDot(s);
      drawSegments(s, 2);
    }
  }

  function toNormalized(e) {
    const rect = canvasEl.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return [x, y];
  }

  function flush() {
    if (pending.length > 0) {
      socket.emit('draw:points', { points: pending });
      pending = [];
    }
  }

  // --- local drawing (drawer only) ---

  canvasEl.addEventListener('pointerdown', (e) => {
    if (!enabled || activeStroke) return;
    e.preventDefault();
    canvasEl.setPointerCapture(e.pointerId);
    const [x, y] = toNormalized(e);
    activeStroke = { color, size, tool, points: [x, y] };
    strokes.push(activeStroke);
    drawDot(activeStroke);
    socket.emit('draw:start', { x, y, color, size, tool });
    flushTimer = setInterval(flush, FLUSH_MS);
  });

  canvasEl.addEventListener('pointermove', (e) => {
    if (!activeStroke) return;
    e.preventDefault();
    const [x, y] = toNormalized(e);
    const pts = activeStroke.points;
    // Skip points closer than ~1.5px to keep payloads small.
    const lastX = pts[pts.length - 2];
    const lastY = pts[pts.length - 1];
    if (Math.abs(x - lastX) * LOGICAL_W < 1.5 && Math.abs(y - lastY) * LOGICAL_H < 1.5) return;
    pts.push(x, y);
    pending.push(x, y);
    drawSegments(activeStroke, pts.length - 2);
  });

  function endStroke() {
    if (!activeStroke) return;
    clearInterval(flushTimer);
    flush();
    socket.emit('draw:end', {});
    activeStroke = null;
  }

  canvasEl.addEventListener('pointerup', endStroke);
  canvasEl.addEventListener('pointercancel', endStroke);

  // --- remote strokes ---

  socket.on('draw:start', (p) => {
    const s = { color: p.color, size: p.size, tool: p.tool, points: [p.x, p.y] };
    strokes.push(s);
    drawDot(s);
  });

  socket.on('draw:points', (p) => {
    const s = strokes[strokes.length - 1];
    if (!s || !Array.isArray(p.points)) return;
    const from = s.points.length;
    s.points.push(...p.points);
    drawSegments(s, from);
  });

  socket.on('draw:undo', () => {
    strokes.pop();
    redrawAll();
  });

  socket.on('draw:clear', () => {
    strokes = [];
    redrawAll();
  });

  return {
    setEnabled(on) {
      enabled = on;
      canvasEl.classList.toggle('drawing', on);
      if (!on) endStroke();
    },
    setStrokes(newStrokes) {
      endStroke();
      strokes = (newStrokes || []).map((s) => ({ ...s, points: [...s.points] }));
      redrawAll();
    },
    clearLocal() {
      endStroke();
      strokes = [];
      redrawAll();
      socket.emit('draw:clear', {});
    },
    undoLocal() {
      endStroke();
      strokes.pop();
      redrawAll();
      socket.emit('draw:undo', {});
    },
    setColor(c) { color = c; tool = 'brush'; },
    setSize(s) { size = s; },
    setTool(t) { tool = t; },
    getTool: () => tool,
  };
}
