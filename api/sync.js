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
  if (req.method === "GET") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing id" });
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
