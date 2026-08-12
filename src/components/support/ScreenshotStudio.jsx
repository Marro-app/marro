import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { C } from '../../lib/theme.js';
import { XBtn } from '../primitives.jsx';
import { Icon } from '../icons.jsx';

// ── Screenshot + annotate studio (Slice 10, plan §8) ────────────────────────
// LAZY-LOADED (React.lazy in SupportPanel) — none of this ships in the main
// chunk. Two capture paths:
//   1. PRIMARY — real screen capture via getDisplayMedia (ask permission,
//      grab one frame, stop the tracks immediately).
//   2. FALLBACK — plain file upload (also the non-visual path; always shown).
//      (The plan's render-from-code middle path is deferred: html2canvas
//      mangles the app's glass/canvas surfaces and adds a heavy dep — upload
//      covers denied/unsupported capture, incl. all mobile browsers.)
//
// Annotations are an OBJECT MODEL, not raster pixels: `shapes` is an array of
// {id, type, color, ...geometry}, and the canvas is fully redrawn (base image
// + every shape, in order) on every change. That's what makes Select (click a
// shape → highlight it → Delete) and Move (click+drag to reposition) possible
// — a shape is addressable data, not baked-in pixels. Blur/redact stays
// non-destructive under this model too: its pixelation is recomputed from the
// base image + shapes-so-far every redraw, so a redaction can be moved or
// deleted before "Attach this image" like any other shape. Undo snapshots the
// shape array (12 deep) rather than ImageData.
//
// Returns via onDone({ blob, width, height, name, caption }) — the caller uploads.

const TOOLS = [
  { key: 'select', label: 'Select', icon: 'toolSelect' },
  { key: 'move', label: 'Move', icon: 'toolMove' },
  { key: 'box', label: 'Highlight box', icon: 'toolBox' },
  { key: 'arrow', label: 'Arrow', icon: 'toolArrow' },
  { key: 'draw', label: 'Draw', icon: 'toolDraw' },
  { key: 'text', label: 'Text', icon: 'toolText' },
  { key: 'blur', label: 'Blur / redact', icon: 'toolBlur' },
];
// Swatches only set the color for what's drawn NEXT — recoloring an existing
// shape isn't wired up yet (selection + move + delete were the ask for this
// pass; recolor-on-select is a natural follow-up now that shapes are objects).
const COLORS = [
  { key: 'red', hex: '#E5484D' },
  { key: 'blue', hex: '#3B82F6' },
  { key: 'green', hex: '#22C55E' },
  { key: 'amber', hex: '#F59E0B' },
  { key: 'white', hex: '#F6EFDD' },
];
const MAX_DIM = 1600;   // downscale captures so uploads stay small
const UNDO_DEPTH = 12;
const TEXT_INPUT_FONT = '13px system-ui, sans-serif';
const TEXT_INPUT_MIN = 44, TEXT_INPUT_MAX = 280;
const NAME_MAX = 80, CAPTION_MAX = 200;
let measureCtx = null;
// Input starts pill-small and grows with what's typed, rather than a fixed
// wide box sitting mostly empty — measured against the same font the input
// renders in, so the box always just barely fits the text plus padding.
function measureTextInputWidth(text) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = TEXT_INPUT_FONT;
  const textWidth = measureCtx.measureText(text || 'Type…').width;
  return Math.min(TEXT_INPUT_MAX, Math.max(TEXT_INPUT_MIN, textWidth + 32));
}

// ── shape geometry helpers (module-level: pure, no component state) ────────
function normRect(x1, y1, x2, y2) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}
function translateShape(s, dx, dy) {
  if (s.type === 'box' || s.type === 'blur' || s.type === 'text') return { ...s, x: s.x + dx, y: s.y + dy };
  if (s.type === 'arrow') return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
  if (s.type === 'draw') return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  return s;
}
function shapeBBox(s, ctx) {
  if (s.type === 'box' || s.type === 'blur') return { x: s.x, y: s.y, w: s.w, h: s.h };
  if (s.type === 'arrow') return normRect(s.x1, s.y1, s.x2, s.y2);
  if (s.type === 'draw') {
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (s.type === 'text') {
    ctx.font = `700 ${s.size}px system-ui, sans-serif`;
    const w = ctx.measureText(s.value).width;
    return { x: s.x, y: s.y - s.size, w, h: s.size * 1.25 };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}
function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
// Topmost-first hit test. box/blur/text = bounding-box containment; arrow =
// distance to the line segment; draw = distance to the nearest path segment.
function hitTestShapes(shapes, p, ctx, tolerance) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type === 'box' || s.type === 'blur' || s.type === 'text') {
      const b = shapeBBox(s, ctx);
      const pad = s.type === 'text' ? 3 : tolerance;
      if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) return s.id;
    } else if (s.type === 'arrow') {
      if (distToSegment(p, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }) <= tolerance) return s.id;
    } else if (s.type === 'draw') {
      if (s.points.length === 1) {
        if (Math.hypot(p.x - s.points[0].x, p.y - s.points[0].y) <= tolerance) return s.id;
      } else {
        for (let j = 1; j < s.points.length; j++) {
          if (distToSegment(p, s.points[j - 1], s.points[j]) <= tolerance) return s.id;
        }
      }
    }
  }
  return null;
}
const getLineWidth = (canvas) => Math.max(3, canvas.width / 400);

function drawArrow(ctx, x1, y1, x2, y2) {
  const head = Math.max(12, ctx.lineWidth * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}
// Draw the region tiny, then scale it back up — classic mosaic redaction.
// Reads FROM the canvas itself, so it picks up the base image plus whatever
// shapes were already drawn earlier in this same redraw pass.
function pixelate(ctx, canvas, x, y, w, h) {
  const cx = Math.max(0, Math.round(x));
  const cy = Math.max(0, Math.round(y));
  const cw = Math.max(0, Math.min(Math.round(w), canvas.width - cx));
  const ch = Math.max(0, Math.min(Math.round(h), canvas.height - cy));
  if (cw < 4 || ch < 4) return;
  const block = 12;
  const tiny = document.createElement('canvas');
  tiny.width = Math.max(1, Math.round(cw / block));
  tiny.height = Math.max(1, Math.round(ch / block));
  const tctx = tiny.getContext('2d');
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, tiny.width, tiny.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, cx, cy, cw, ch);
  ctx.imageSmoothingEnabled = true;
}
function drawShape(ctx, canvas, s, isDraft) {
  if (s.type === 'blur') {
    if (isDraft) {
      // Cheap dashed preview while dragging — the real (expensive) pixelation
      // only happens once the region is committed to `shapes`.
      ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = C.text; ctx.lineWidth = getLineWidth(canvas);
      ctx.strokeRect(s.x, s.y, s.w, s.h); ctx.restore();
    } else {
      pixelate(ctx, canvas, s.x, s.y, s.w, s.h);
    }
    return;
  }
  ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
  ctx.lineWidth = getLineWidth(canvas);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (s.type === 'box') {
    ctx.strokeRect(s.x, s.y, s.w, s.h);
  } else if (s.type === 'arrow') {
    drawArrow(ctx, s.x1, s.y1, s.x2, s.y2);
  } else if (s.type === 'draw') {
    if (s.points.length < 2) return;
    ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
  } else if (s.type === 'text') {
    ctx.font = `700 ${s.size}px system-ui, sans-serif`;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(3, s.size / 6);
    ctx.strokeText(s.value, s.x, s.y);
    ctx.fillStyle = s.color;
    ctx.fillText(s.value, s.x, s.y);
  }
}
function drawSelectionOutline(ctx, bbox) {
  const pad = 4;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = C.sel;
  ctx.strokeRect(bbox.x - pad, bbox.y - pad, bbox.w + pad * 2, bbox.h + pad * 2);
  ctx.restore();
}

export default function ScreenshotStudio({ onDone, onCancel, onCaptureStart, onCaptureEnd }) {
  const [stage, setStage] = useState('pick'); // 'pick' | 'edit'
  const [error, setError] = useState(null);
  const [tool, setTool] = useState('box');
  const [color, setColor] = useState(COLORS[0].hex);
  const [busy, setBusy] = useState(false);
  // Hidden (not unmounted -- capture keeps running) for the capture window
  // itself, so this studio's own "Add a screenshot" dialog isn't what ends
  // up in the shot, same reasoning as the parent's `capturing` state.
  const [hiddenForCapture, setHiddenForCapture] = useState(false);
  const [textEntry, setTextEntry] = useState(null); // {x, y, value} while typing
  const [shapes, setShapes] = useState([]);         // committed annotation objects
  const [selectedId, setSelectedId] = useState(null);
  const [draftShape, setDraftShape] = useState(null); // in-progress box/arrow/draw/blur, not yet committed
  const [name, setName] = useState('');
  const [caption, setCaption] = useState('');
  const canvasRef = useRef(null);
  const baseImgRef = useRef(null); // the loaded base image — every redraw starts here
  const undoStack = useRef([]);    // stack of past `shapes` arrays
  const dragRef = useRef(null);    // {mode:'draw'} | {mode:'move', id, last}
  const idSeq = useRef(1);
  const fileRef = useRef(null);
  const captureSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  // Switching tools clears any selection so a stale highlight doesn't linger
  // while the user starts drawing something new.
  useEffect(() => { setSelectedId(null); }, [tool]);

  // ── load an image (from capture or file) onto the canvas ──────────────────
  const loadImage = useCallback((source) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = canvasRef.current;
      canvas.width = w; canvas.height = h;
      baseImgRef.current = img;
      undoStack.current = [];
      setShapes([]);
      setSelectedId(null);
      setDraftShape(null);
      setStage('edit');
      if (source.revoke) URL.revokeObjectURL(img.src);
    };
    img.onerror = () => setError("Couldn't read that image.");
    img.src = source.url;
  }, []);

  const captureScreen = useCallback(async () => {
    setError(null); setBusy(true);
    try {
      // preferCurrentTab (Chrome-only, silently ignored elsewhere) swaps the
      // full "pick any tab/window/screen" picker for a much shorter "share
      // this tab?" confirmation — still one required browser-mediated click
      // (no site can skip or auto-answer this prompt), just far less
      // alarming than scrolling through a list of the user's other open tabs.
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true });
      // Permission granted, capture about to actually happen — hide our own
      // UI (this dialog + the parent panel behind it) so the settle wait
      // below gives the browser time to repaint WITHOUT us in the shot,
      // rather than capturing our own "Capturing…" dialog.
      onCaptureStart?.();
      setHiddenForCapture(true);
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 350)); // let the frame settle
      const grab = document.createElement('canvas');
      grab.width = video.videoWidth; grab.height = video.videoHeight;
      grab.getContext('2d').drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop()); // stop sharing immediately
      loadImage({ url: grab.toDataURL('image/png') });
    } catch {
      // Denied / cancelled — not an error state worth alarming over.
      setError('Screen capture was cancelled. You can upload an image instead.');
    } finally {
      setBusy(false);
      setHiddenForCapture(false);
      onCaptureEnd?.();
    }
  }, [loadImage]);

  const onFile = useCallback((e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { setError('Please choose an image file.'); return; }
    setError(null);
    loadImage({ url: URL.createObjectURL(f), revoke: true });
  }, [loadImage]);

  // ── redraw: base image + every shape, in order, every time anything changes.
  // This is what makes blur non-destructive (its pixelation is recomputed
  // from the base + shapes-so-far each pass) and selection cheap (just a
  // dashed outline drawn on top, no separate overlay canvas needed).
  useEffect(() => {
    const canvas = canvasRef.current;
    const baseImg = baseImgRef.current;
    if (!canvas || !baseImg) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
    for (const s of shapes) drawShape(ctx, canvas, s, false);
    if (draftShape) drawShape(ctx, canvas, draftShape, true);
    if (selectedId != null) {
      const sel = shapes.find((s) => s.id === selectedId);
      if (sel) drawSelectionOutline(ctx, shapeBBox(sel, ctx));
    }
  }, [shapes, draftShape, selectedId, stage]);

  // ── annotation ─────────────────────────────────────────────────────────────
  const pushUndo = () => {
    undoStack.current.push(shapes);
    if (undoStack.current.length > UNDO_DEPTH) undoStack.current.shift();
  };
  const undo = () => {
    const snap = undoStack.current.pop();
    if (snap) { setShapes(snap); setSelectedId(null); setDraftShape(null); }
  };
  const deleteSelected = () => {
    if (selectedId == null) return;
    pushUndo();
    setShapes((prev) => prev.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  };

  const canvasPoint = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return { x: cx * (canvasRef.current.width / rect.width), y: cy * (canvasRef.current.height / rect.height) };
  };

  const onPointerDown = (e) => {
    if (stage !== 'edit' || textEntry) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const p = canvasPoint(e);

    if (tool === 'text') { setTextEntry({ x: p.x, y: p.y, value: '' }); return; }

    if (tool === 'select') {
      setSelectedId(hitTestShapes(shapes, p, ctx, getLineWidth(canvas) + 8));
      return;
    }
    if (tool === 'move') {
      const hitId = hitTestShapes(shapes, p, ctx, getLineWidth(canvas) + 8);
      if (hitId == null) { setSelectedId(null); return; }
      pushUndo();
      setSelectedId(hitId);
      dragRef.current = { mode: 'move', id: hitId, last: p };
      return;
    }

    const id = idSeq.current++;
    let shape;
    if (tool === 'box') shape = { id, type: 'box', color, x: p.x, y: p.y, w: 0, h: 0 };
    else if (tool === 'arrow') shape = { id, type: 'arrow', color, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    else if (tool === 'draw') shape = { id, type: 'draw', color, points: [p] };
    else if (tool === 'blur') shape = { id, type: 'blur', x: p.x, y: p.y, w: 0, h: 0 };
    else return;
    dragRef.current = { mode: 'draw', start: p };
    setDraftShape(shape);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const p = canvasPoint(e);

    if (dragRef.current.mode === 'move') {
      const { id, last } = dragRef.current;
      const dx = p.x - last.x, dy = p.y - last.y;
      setShapes((prev) => prev.map((s) => (s.id === id ? translateShape(s, dx, dy) : s)));
      dragRef.current.last = p;
      return;
    }

    const { start } = dragRef.current;
    setDraftShape((s) => {
      if (!s) return s;
      if (s.type === 'box' || s.type === 'blur') return { ...s, ...normRect(start.x, start.y, p.x, p.y) };
      if (s.type === 'arrow') return { ...s, x2: p.x, y2: p.y };
      if (s.type === 'draw') return { ...s, points: [...s.points, p] };
      return s;
    });
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    const mode = dragRef.current.mode;
    dragRef.current = null;
    if (mode === 'move') return; // shapes already updated live; undo snapshot taken at drag start

    if (draftShape) {
      const s = draftShape;
      const valid =
        (s.type === 'box' && s.w > 2 && s.h > 2) ||
        (s.type === 'blur' && s.w > 4 && s.h > 4) ||
        (s.type === 'arrow' && (Math.abs(s.x2 - s.x1) > 2 || Math.abs(s.y2 - s.y1) > 2)) ||
        (s.type === 'draw' && s.points.length > 1);
      if (valid) {
        pushUndo();
        setShapes((prev) => [...prev, s]);
      }
      setDraftShape(null);
    }
  };

  const commitText = () => {
    if (!textEntry) return;
    const value = textEntry.value.trim();
    if (value) {
      const size = Math.max(18, Math.round(canvasRef.current.width / 45));
      pushUndo();
      setShapes((prev) => [...prev, { id: idSeq.current++, type: 'text', color, x: textEntry.x, y: textEntry.y, value, size }]);
    }
    setTextEntry(null);
  };

  const finish = () => {
    setBusy(true);
    const c = canvasRef.current;
    c.toBlob((blob) => {
      setBusy(false);
      if (!blob) { setError("Couldn't export the image."); return; }
      onDone({ blob, width: c.width, height: c.height, name: name.trim() || null, caption: caption.trim() || null });
    }, 'image/png', 0.92);
  };

  // Esc backs out (text entry first, then the studio itself). Delete/Backspace
  // removes the selected shape — guarded against firing while a real text
  // field has focus (the studio's own annotation-text input, or Name/Summary).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (textEntry) setTextEntry(null); else onCancel();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = document.activeElement;
        if (textEntry || (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'))) return;
        if (selectedId == null) return;
        e.preventDefault();
        deleteSelected();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [textEntry, onCancel, selectedId, shapes]);

  const btnStyle = (active) => ({
    minHeight: 36, padding: '7px 12px', borderRadius: 9, fontSize: 12, fontWeight: active ? 700 : 500,
    cursor: 'pointer', border: `1px solid ${active ? C.sel : C.border}`,
    background: active ? C.selBg : 'transparent', color: C.text,
  });

  // Rendering nothing here does NOT unmount this component (React keeps the
  // instance alive across a null render), so captureScreen()'s in-flight
  // async work — refs, undo stack, the whole capture promise chain —
  // continues untouched. It just means nothing of ours is on screen for the
  // moment the browser actually captures the tab.
  if (hiddenForCapture) return null;

  return createPortal((
    <div role="dialog" aria-modal="true" aria-label="Screenshot and annotation"
      // Portal caveat: React bubbles synthetic events along the REACT tree,
      // so without this stop, any click in the studio reaches SupportPanel's
      // close-on-scrim handler and closes the whole panel underneath.
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: C.scrim, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}>
      <div className="mm" style={{ position: 'relative', width: stage === 'edit' ? 'min(720px, 100%)' : 'min(360px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 12, padding: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.text }}>
            {stage === 'pick' ? 'Add a screenshot' : 'Annotate — draw on the image'}
          </div>
          <XBtn label="Close screenshot tool" onClick={onCancel} size={32} iconSize={14} />
        </div>
        {error && <div role="alert" style={{ fontSize: 12, color: C.danger }}>{error}</div>}

        {stage === 'pick' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '6px 0 4px' }}>
            {captureSupported && (
              <button type="button" onClick={captureScreen} disabled={busy} className="btn-fill"
                style={{ padding: '12px', borderRadius: 10, border: 'none', background: C.teal, color: C.bg, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', minHeight: 44, opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Capturing…' : 'Capture my screen'}
              </button>
            )}
            <button type="button" onClick={() => fileRef.current?.click()} className="btn-pop"
              style={{ padding: '12px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', minHeight: 44 }}>
              Upload an image instead
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} aria-label="Upload an image file" style={{ display: 'none' }} />
            <div style={{ fontSize: 11.5, color: C.textMid, lineHeight: 1.5 }}>
              {captureSupported
                ? 'Capture asks your browser for permission and takes a single frame — nothing is recorded. You can blur out anything private before sending.'
                : "This browser can't capture the screen — upload a screenshot from your device instead."}
            </div>
          </div>
        )}
        {/* The canvas stays MOUNTED through both stages (hidden during pick) —
            loadImage() draws into it before flipping to 'edit', so the ref
            must exist while the picker is still showing. */}
        <div style={{ display: stage === 'edit' ? 'contents' : 'none' }}>
          <>
            <div role="group" aria-label="Annotation tools" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {TOOLS.map((t) => (
                <button key={t.key} type="button" aria-pressed={tool === t.key} onClick={() => setTool(t.key)} className="hit-slop"
                  style={{ ...btnStyle(tool === t.key), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name={t.icon} size={15} />
                  {t.label}
                </button>
              ))}
              <button type="button" onClick={undo} className="btn-pop hit-slop"
                style={{ ...btnStyle(false), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="toolUndo" size={15} />
                Undo
              </button>
              <button type="button" onClick={deleteSelected} disabled={selectedId == null} className="btn-pop hit-slop"
                style={{ ...btnStyle(false), opacity: selectedId == null ? 0.45 : 1, cursor: selectedId == null ? 'default' : 'pointer' }}>
                Delete
              </button>
              <div role="group" aria-label="Annotation color" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 4 }}>
                {COLORS.map((c) => (
                  <button key={c.key} type="button" aria-label={`Color: ${c.key}`} aria-pressed={color === c.hex} onClick={() => setColor(c.hex)}
                    className="hit-slop"
                    style={{ width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', background: c.hex,
                      border: color === c.hex ? `2px solid ${C.text}` : `1px solid ${C.border}`, padding: 0 }} />
                ))}
              </div>
            </div>
            <div style={{ position: 'relative', overflow: 'auto', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, maxHeight: '55vh' }} className="themed-scroll">
              <canvas
                ref={canvasRef}
                onMouseDown={onPointerDown} onMouseMove={onPointerMove} onMouseUp={onPointerUp} onMouseLeave={onPointerUp}
                onTouchStart={onPointerDown} onTouchMove={onPointerMove} onTouchEnd={onPointerUp}
                style={{ display: 'block', width: '100%', height: 'auto', touchAction: 'none', cursor: tool === 'select' ? 'default' : tool === 'move' ? 'grab' : 'crosshair' }}
              />
              {textEntry && (() => {
                // textEntry.{x,y} are in CANVAS pixel space (canvasPoint()'s
                // scale-corrected coords, used later to draw the real text in
                // commitText()) — this overlay input needs the same point in
                // CSS/display space instead. Both the canvas and this input
                // share the same positioned ancestor (the wrapping div), so
                // the canvas's own offset within it (normally just its
                // border) plus the canvas→display scale gets the input to
                // sit exactly where the user clicked, not a fixed corner.
                const canvas = canvasRef.current;
                const container = canvas?.parentElement;
                let left = textEntry.x, top = textEntry.y;
                if (canvas && container) {
                  const canvasRect = canvas.getBoundingClientRect();
                  const containerRect = container.getBoundingClientRect();
                  const scaleX = canvasRect.width / canvas.width;
                  const scaleY = canvasRect.height / canvas.height;
                  left = (canvasRect.left - containerRect.left) + textEntry.x * scaleX;
                  top = (canvasRect.top - containerRect.top) + textEntry.y * scaleY;
                }
                return (
                  <input
                    autoFocus
                    aria-label="Annotation text"
                    value={textEntry.value}
                    onChange={(e) => setTextEntry((t) => ({ ...t, value: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitText(); } }}
                    onBlur={commitText}
                    placeholder="Type…"
                    style={{ position: 'absolute', left, top, minHeight: 36, padding: '7px 11px', font: TEXT_INPUT_FONT, borderRadius: 9, border: `2px solid ${color}`, background: C.bg, color: C.text, outline: 'none', width: measureTextInputWidth(textEntry.value) }}
                  />
                );
              })()}
            </div>
            <div style={{ fontSize: 11.5, color: C.textMid }}>
              Tip: the <strong>Blur / redact</strong> tool hides anything you don&apos;t want us to see — drag it over private numbers before attaching. Use <strong>Select</strong> to pick an annotation and delete it, or <strong>Move</strong> to drag it.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: C.textMid }}>
                Name (optional)
                <input type="text" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Budget tab"
                  style={{ padding: '8px 10px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: C.textMid }}>
                Summary (optional)
                <input type="text" value={caption} maxLength={CAPTION_MAX} onChange={(e) => setCaption(e.target.value)}
                  placeholder="What's wrong here?"
                  style={{ padding: '8px 10px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13 }} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setStage('pick'); setError(null); }} className="btn-pop"
                style={{ padding: '10px 16px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 44 }}>
                Start over
              </button>
              <button type="button" onClick={finish} disabled={busy} className="btn-fill"
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: C.teal, color: C.bg, fontSize: 13, fontWeight: 700, cursor: 'pointer', minHeight: 44, opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Preparing…' : 'Attach this image'}
              </button>
            </div>
          </>
        </div>
      </div>
    </div>
  ), document.body);
}
