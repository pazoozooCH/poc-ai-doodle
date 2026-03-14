/**
 * Shared canvas drawing module.
 * Sets up a drawing canvas with mouse/touch support.
 *
 * Usage:
 *   const drawer = initCanvas(document.getElementById('canvas'));
 *   drawer.onClear = () => { ... };  // optional callback
 *   drawer.clear();
 */

export function initCanvas(canvas, { lineWidth = 16, clearButton = null } = {}) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000';

  const state = { isDrawing: false, hasStrokes: false, lastX: 0, lastY: 0 };
  let onClear = null;
  let onDrawStart = null;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function startDraw(e) {
    e.preventDefault();
    if (onDrawStart) onDrawStart();
    state.isDrawing = true;
    const pos = getPos(e);
    state.lastX = pos.x;
    state.lastY = pos.y;
  }

  function draw(e) {
    e.preventDefault();
    if (!state.isDrawing) return;
    state.hasStrokes = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(state.lastX, state.lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    state.lastX = pos.x;
    state.lastY = pos.y;
  }

  function endDraw(e) {
    e.preventDefault();
    state.isDrawing = false;
  }

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.hasStrokes = false;
    if (onClear) onClear();
  }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseleave', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', draw, { passive: false });
  canvas.addEventListener('touchend', endDraw, { passive: false });

  if (clearButton) {
    clearButton.addEventListener('click', clear);
  }

  return {
    canvas,
    ctx,
    state,
    clear,
    getPos,
    set onClear(fn) { onClear = fn; },
    set onDrawStart(fn) { onDrawStart = fn; },
  };
}
