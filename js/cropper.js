// A tiny circular cropper: drag to move, slider or pinch to zoom.
// Produces a square JPEG data URL small enough for localStorage.

const OUTPUT = 480;

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad image'));
    };
    img.src = url;
  });
}

/**
 * Mounts the cropper into `frame` (a square element) with `zoomInput` (range).
 * Returns { exportDataUrl(), destroy() }.
 */
export function createCropper(frame, zoomInput, img) {
  const view = document.createElement('img');
  view.src = img.src;
  view.alt = '';
  view.draggable = false;
  view.className = 'crop-img';
  frame.querySelector('.crop-img')?.remove();
  frame.prepend(view);

  const size = () => frame.clientWidth;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  let zoom = 1; // 1 = image just covers the circle
  let cx = iw / 2; // image point shown at the centre of the frame
  let cy = ih / 2;

  const coverScale = () => size() / Math.min(iw, ih);
  const scale = () => coverScale() * zoom;

  function clamp() {
    const half = size() / 2 / scale();
    cx = Math.min(Math.max(cx, half), iw - half);
    cy = Math.min(Math.max(cy, half), ih - half);
  }

  function render() {
    clamp();
    const s = scale();
    view.style.width = iw * s + 'px';
    view.style.height = ih * s + 'px';
    view.style.transform = `translate(${size() / 2 - cx * s}px, ${size() / 2 - cy * s}px)`;
  }

  // Dragging and pinching with pointer events.
  const pointers = new Map();
  let pinchStart = null;

  function onDown(e) {
    frame.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }

  function onMove(e) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, next);

    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setZoom(pinchStart.zoom * (dist / pinchStart.dist));
      return;
    }
    const s = scale();
    cx -= (next.x - prev.x) / s;
    cy -= (next.y - prev.y) / s;
    render();
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
  }

  function onWheel(e) {
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  }

  function setZoom(z) {
    zoom = Math.min(Math.max(z, 1), 4);
    zoomInput.value = String(zoom);
    render();
  }

  const onZoomInput = () => setZoom(parseFloat(zoomInput.value));
  const onResize = () => render();

  frame.addEventListener('pointerdown', onDown);
  frame.addEventListener('pointermove', onMove);
  frame.addEventListener('pointerup', onUp);
  frame.addEventListener('pointercancel', onUp);
  frame.addEventListener('wheel', onWheel, { passive: false });
  zoomInput.addEventListener('input', onZoomInput);
  window.addEventListener('resize', onResize);

  zoomInput.value = '1';
  render();

  return {
    exportDataUrl() {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = OUTPUT;
      const c = canvas.getContext('2d');
      const side = size() / scale(); // source pixels visible across the frame
      c.drawImage(img, cx - side / 2, cy - side / 2, side, side, 0, 0, OUTPUT, OUTPUT);
      return canvas.toDataURL('image/jpeg', 0.86);
    },
    destroy() {
      frame.removeEventListener('pointerdown', onDown);
      frame.removeEventListener('pointermove', onMove);
      frame.removeEventListener('pointerup', onUp);
      frame.removeEventListener('pointercancel', onUp);
      frame.removeEventListener('wheel', onWheel);
      zoomInput.removeEventListener('input', onZoomInput);
      window.removeEventListener('resize', onResize);
      view.remove();
    },
  };
}
