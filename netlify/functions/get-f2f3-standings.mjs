// On-demand endpoint the page calls when the F2 or F3 standings tab is opened:
// /.netlify/functions/get-f2f3-standings
//
// FIA's standings pages used to embed a __NEXT_DATA__ JSON blob, but that's
// gone now — the page ships a real server-rendered <table> instead (Driver /
// SR / FR... / Points columns). This parses that table directly: find the
// table whose header mentions "Driver" and "Points", pull each row's first
// cell (name) and last cell (points total), and keep rows that look like an
// actual driver line (e.g. "N. Tsolov") with a numeric points total.
//
// No database/cache needed — this just scrapes fresh on every call. A
// Cache-Control header lets Netlify's CDN serve repeat requests within the
// same 30-minute window without re-hitting FIA's site every time.

function parseHtmlTable(html) {
  const tableMatches = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
  for (const tm of tableMatches) {
    const tableHtml = tm[0];
    const rowMatches = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
    const rows = [];
    for (const rm of rowMatches) {
      const cellMatches = [...rm[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
      const cells = cellMatches.map((cm) =>
        cm[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
      );
      if (cells.length) rows.push(cells);
    }
    const headerText = rows.slice(0, 2).flat().join(" ").toLowerCase();
    if (headerText.includes("driver") && headerText.includes("points")) {
      return { rows, tableCount: tableMatches.length };
    }
  }
  return { rows: null, tableCount: tableMatches.length };
}

function extractStandings(rows) {
  const out = [];
  for (const cells of rows) {
    const name = cells[0];
    const last = cells[cells.length - 1];
    const points = parseInt(last, 10);
    if (
      name &&
      /^[A-Z]\.\s*[A-Za-zÀ-ÿ'’-]+/.test(name) &&
      !isNaN(points) &&
      String(points) === last.trim()
    ) {
      out.push({ name, points });
    }
  }
  return out.map((r, i) => ({ position: i + 1, name: r.name, team: "", points: r.points }));
}

async function getFiaStandings(seriesUrl, seriesLabel) {
  try {
    const res = await fetch(seriesUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(seriesLabel + " page fetch failed: " + res.status);
    const html = await res.text();

    const { rows, tableCount } = parseHtmlTable(html);
    if (!rows) {
      throw new Error(
        seriesLabel + " standings table not found. html length=" + html.length +
        " tablesOnPage=" + tableCount
      );
    }

    const standings = extractStandings(rows);
    if (!standings.length) {
      throw new Error(
        seriesLabel + " table found but no driver rows matched. rowCount=" + rows.length +
        " sampleRow=" + JSON.stringify(rows[Math.min(2, rows.length - 1)] || [])
      );
    }

    return { ok: true, rows: standings };
  } catch (err) {
    console.error(seriesLabel + " standings lookup failed:", err);
    return { ok: false, error: err.message };
  }
}

export default async (req) => {
  const [f2Result, f3Result] = await Promise.all([
    getFiaStandings("https://www.fiaformula2.com/en/standings/2026/drivers", "F2"),
    getFiaStandings("https://www.fiaformula3.com/en/standings/2026/drivers", "F3"),
  ]);

  return new Response(JSON.stringify({
    f2: f2Result.ok ? f2Result.rows : null,
    f3: f3Result.ok ? f3Result.rows : null,
    f2Error: f2Result.ok ? null : f2Result.error,
    f3Error: f3Result.ok ? null : f3Result.error,
    fetchedAt: new Date().toISOString(),
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=1800", // 30 min — CDN-cached, not re-scraped every load
    },
  });
};
