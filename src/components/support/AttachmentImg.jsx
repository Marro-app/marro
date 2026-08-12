import React, { useEffect, useState } from 'react';
import { C } from '../../lib/theme.js';
import { attachmentUrl } from '../../lib/supportAttachments.js';

// Renders one message-attachment ref ({path, w, h, name, caption}) via a
// short-lived signed URL (the bucket is private — storage RLS decides who
// can mint the URL). Shared by the user panel's bubbles and the admin thread
// (same component, so the optional name/caption render on both sides). Fails
// to a quiet text note rather than a broken image.
export default function AttachmentImg({ refObj, alt = 'Attached screenshot' }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    attachmentUrl(refObj).then((u) => {
      if (!alive) return;
      if (u) setUrl(u); else setFailed(true);
    });
    return () => { alive = false; };
  }, [refObj]);

  if (failed) {
    return <div style={{ fontSize: 11.5, color: C.textMid, fontStyle: 'italic' }}>Attachment unavailable</div>;
  }
  if (!url) {
    return <div role="status" style={{ fontSize: 11.5, color: C.textMid }}>Loading attachment…</div>;
  }
  const effectiveAlt = refObj?.name ? `${refObj.name} — attached screenshot` : alt;
  return (
    <div style={{ maxWidth: 260 }}>
      <a href={url} target="_blank" rel="noreferrer" aria-label={`${effectiveAlt} — open full size`} style={{ display: 'block', borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}` }}>
        <img src={url} alt={effectiveAlt} style={{ display: 'block', width: '100%', height: 'auto' }} />
      </a>
      {refObj?.caption && (
        <div style={{ fontSize: 11, color: C.textMid, marginTop: 4, lineHeight: 1.4 }}>{refObj.caption}</div>
      )}
    </div>
  );
}
