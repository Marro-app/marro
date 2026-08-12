// ── Support attachments — upload + signed-URL helpers (Slice 10) ────────────
// Objects live in the PRIVATE `support-attachments` bucket under the caller's
// own <uid>/ folder (storage RLS: owner-insert, owner-or-admin read — see
// supabase/support_attachments.sql). Message rows carry lightweight refs in
// `attachments` jsonb: [{ path, type, w, h, name, caption }] (name/caption are
// optional, user-entered in the studio); rendering resolves a short-lived
// signed URL per ref.
import { getSupabase } from './data.js';

const BUCKET = 'support-attachments';
const SIGNED_URL_SECONDS = 3600;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // keep uploads sane

// Upload a PNG blob into the caller's folder. Returns the attachment ref to
// store on the message, or throws with a user-presentable message.
export async function uploadAttachment(blob, { width = null, height = null, name = null, caption = null } = {}) {
  if (!blob) throw new Error('Nothing to upload.');
  if (blob.size > MAX_ATTACHMENT_BYTES) throw new Error('That image is too large (5 MB max).');
  const sb = await getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.id) throw new Error('Not signed in.');
  const path = `${user.id}/${Date.now()}-${Math.random().toString(16).slice(2, 8)}.png`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/png', upsert: false });
  if (error) throw new Error("Couldn't upload the image. Please try again.");
  return { path, type: 'image/png', w: width, h: height, name: name || null, caption: caption || null };
}

// Short-lived viewing URL for one ref. Null on any failure (render falls back
// to a "attachment unavailable" note rather than a broken image).
export async function attachmentUrl(ref) {
  try {
    if (!ref?.path) return null;
    const sb = await getSupabase();
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(ref.path, SIGNED_URL_SECONDS);
    if (error) return null;
    return data?.signedUrl || null;
  } catch {
    return null;
  }
}
