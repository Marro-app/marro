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
// Annotation on a <canvas>: highlight box · arrow · freehand · text · BLUR
// (pixelate — the user's own redaction control, §4/§8) + undo. Every tool is
// a real labeled button; the whole flow is skippable in favor of upload.
//
// Returns via onDone({ blob, width, height }) — the caller uploads.

const TOOLS = [
  { key: 'box', label: 'Highlight box', icon: 'toolBox' },
  { key: 'arrow', label: 'Arrow', icon: 'toolArrow' },
  { key: 'draw', label: 'Draw', icon: 'toolDraw' },
  { key: 'text', label: 'Text', icon: 'toolText' },
  { key: 'blur', label: 'Blur / redact', icon: 'toolBlur' },
];
// Swatches only set the color for what's drawn NEXT — recoloring something
// already on the canvas needs the same per-shape object model as drag/delete
// (deferred, see FUTURE_WORK.md), since strokes are raster pixels, not
// editable objects.
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
  const canvasRef = useRef(null);
  const undoStack = useRef([]);
  const dragRef = useRef(null);
  const baseSnapshot = useRef(null); // pre-drag pixels for live preview
  const fileRef = useRef(null);
  const captureSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  // ── load an image (from capture or file) onto the canvas ──────────────────
  const loadImage = useCallback((source) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = canvasRef.current;
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      undoStack.current = [];
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

  // ── annotation ─────────────────────────────────────────────────────────────
  const pushUndo = () => {
    const c = canvasRef.current;
    undoStack.current.push(c.getContext('2d').getImageData(0, 0, c.width, c.height));
    if (undoStack.current.length > UNDO_DEPTH) undoStack.current.shift();
  };
  const undo = () => {
    const snap = undoStack.current.pop();
    if (snap) canvasRef.current.getContext('2d').putImageData(snap, 0, 0);
  };

  const canvasPoint = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return { x: cx * (canvasRef.current.width / rect.width), y: cy * (canvasRef.current.height / rect.height) };
  };

  const strokeStyle = () => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(3, canvasRef.current.width / 400);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  };

  const drawArrow = (ctx, x1, y1, x2, y2) => {
    const head = Math.max(12, ctx.lineWidth * 4);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };

  const pixelate = (ctx, x, y, w, h) => {
    if (w < 4 || h < 4) return;
    const block = 12;
    // Draw the region tiny, then scale it back up — classic mosaic redaction.
    const tiny = document.createElement('canvas');
    tiny.width = Math.max(1, Math.round(w / block));
    tiny.height = Math.max(1, Math.round(h / block));
    const tctx = tiny.getContext('2d');
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(canvasRef.current, x, y, w, h, 0, 0, tiny.width, tiny.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  };

  const onPointerDown = (e) => {
    if (stage !== 'edit' || textEntry) return;
    e.preventDefault();
    const p = canvasPoint(e);
    if (tool === 'text') { setTextEntry({ x: p.x, y: p.y, value: '' }); return; }
    pushUndo();
    const c = canvasRef.current;
    baseSnapshot.current = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    dragRef.current = { start: p, last: p };
    if (tool === 'draw') { const ctx = strokeStyle(); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const p = canvasPoint(e);
    const { start } = dragRef.current;
    const ctx = strokeStyle();
    if (tool === 'draw') {
      ctx.lineTo(p.x, p.y); ctx.stroke();
    } else {
      // live preview: restore pre-drag pixels, then draw the current shape
      ctx.putImageData(baseSnapshot.current, 0, 0);
      strokeStyle();
      if (tool === 'box') ctx.strokeRect(Math.min(start.x, p.x), Math.min(start.y, p.y), Math.abs(p.x - start.x), Math.abs(p.y - start.y));
      if (tool === 'arrow') drawArrow(ctx, start.x, start.y, p.x, p.y);
      if (tool === 'blur') { ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeRect(Math.min(start.x, p.x), Math.min(start.y, p.y), Math.abs(p.x - start.x), Math.abs(p.y - start.y)); ctx.restore(); }
    }
    dragRef.current.last = p;
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    const { start, last } = dragRef.current;
    dragRef.current = null;
    const ctx = strokeStyle();
    if (tool === 'blur') {
      // replace the dashed preview with the actual pixelation
      ctx.putImageData(baseSnapshot.current, 0, 0);
      pixelate(ctx, Math.min(start.x, last.x), Math.min(start.y, last.y), Math.abs(last.x - start.x), Math.abs(last.y - start.y));
    }
    baseSnapshot.current = null;
  };

  const commitText = () => {
    if (!textEntry) return;
    const value = textEntry.value.trim();
    if (value) {
      pushUndo();
      const ctx = strokeStyle();
      const size = Math.max(18, Math.round(canvasRef.current.width / 45));
      ctx.font = `700 ${size}px system-ui, sans-serif`;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = Math.max(3, size / 6);
      ctx.strokeText(value, textEntry.x, textEntry.y);
      ctx.fillText(value, textEntry.x, textEntry.y);
    }
    setTextEntry(null);
  };

  const finish = () => {
    setBusy(true);
    const c = canvasRef.current;
    c.toBlob((blob) => {
      setBusy(false);
      if (!blob) { setError("Couldn't export the image."); return; }
      onDone({ blob, width: c.width, height: c.height });
    }, 'image/png', 0.92);
  };

  // Esc backs out (text entry first, then the studio itself).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (textEntry) setTextEntry(null); else onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [textEntry, onCancel]);

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
                style={{ display: 'block', width: '100%', height: 'auto', touchAction: 'none', cursor: 'crosshair' }}
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
              Tip: the <strong>Blur / redact</strong> tool hides anything you don&apos;t want us to see — drag it over private numbers before attaching.
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
