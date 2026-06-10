const GIST_FILE = "wcm_budget_v1.json";

export default async function handler(req, res) {
  const token = process.env.GIST_TOKEN;
  if (!token) return res.status(500).json({ error: "GIST_TOKEN not configured" });

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "wcm-budget-app",
  };

  // GET /api/sync?id=<gistId>  → fetch gist content
  // GET /api/sync               → discover WCM gist by listing user's gists
  if (req.method === "GET") {
    const { id } = req.query;

    if (!id) {
      // Discovery: find the WCM gist across devices by scanning the user's gist list
      let page = 1;
      while (page <= 5) {
        const r = await fetch(`https://api.github.com/gists?per_page=100&page=${page}`, { headers });
        if (!r.ok) return res.status(r.status).json({ error: "Gist list failed" });
        const list = await r.json();
        if (!list.length) break;
        const found = list.find(g => g.files?.[GIST_FILE]);
        if (found) {
          // Fetch full content for this gist
          const r2 = await fetch(`https://api.github.com/gists/${found.id}`, { headers });
          if (!r2.ok) return res.status(r2.status).json({ error: "Gist fetch failed" });
          const j = await r2.json();
          const content = j.files?.[GIST_FILE]?.content || null;
          return res.status(200).json({ id: found.id, content });
        }
        page++;
      }
      return res.status(200).json({ id: null, content: null });
    }

    const r = await fetch(`https://api.github.com/gists/${id}`, { headers });
    if (!r.ok) return res.status(r.status).json({ error: "Gist fetch failed" });
    const j = await r.json();
    const content = j.files?.[GIST_FILE]?.content || null;
    return res.status(200).json({ content });
  }

  // POST /api/sync  body: { id?, content }  → create or update gist
  if (req.method === "POST") {
    const { id, content } = req.body;
    if (!content) return res.status(400).json({ error: "Missing content" });

    if (!id) {
      // Create new gist
      const r = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers,
        body: JSON.stringify({
          description: "WCM Budget Planner data",
          public: false,
          files: { [GIST_FILE]: { content } },
        }),
      });
      if (!r.ok) return res.status(r.status).json({ error: "Gist create failed" });
      const j = await r.json();
      return res.status(200).json({ id: j.id });
    } else {
      // Update existing gist
      const r = await fetch(`https://api.github.com/gists/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ files: { [GIST_FILE]: { content } } }),
      });
      if (!r.ok) return res.status(r.status).json({ error: "Gist update failed" });
      return res.status(200).json({ ok: true });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
