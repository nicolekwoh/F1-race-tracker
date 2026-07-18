// On-demand endpoint the page calls when the F2 or F3 standings tab is opened:
// /.netlify/functions/get-f2f3-standings
//
// Reuses the same FIA-page-parsing approach already proven in
// weekly-race-email.mjs (parses the embedded __NEXT_DATA__ JSON rather than
// scraping rendered HTML tables, which is more robust to layout changes).
//
// No database/cache needed — this just scrapes fresh on every call. A
// Cache-Control header lets Netlify's CDN serve repeat requests within the
// same 30-minute window without re-hitting FIA's site every time.

async function getFiaStandings(seriesUrl, seriesLabel) {
  try {
    const res = await fetch(seriesUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(seriesLabel + " page fetch failed: " + res.status);
    const html = await res.text();

    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) {
      // TEMP DEBUG: report back what the page actually looked like instead of
      // just failing silently, so we can see why the expected script tag is missing.
      throw new Error(
        seriesLabel + " __NEXT_DATA__ not found. html length=" + html.length +
        " snippet=" + html.slice(0, 300).replace(/\s+/g, " ")
      );
    }
    const data = JSON.parse(match[1]);

    const found = findStandingsArray(data);
    if (!found) throw new Error(seriesLabel + " standings array not found in page data");

    // Full list this time (the email version only needed the top 10).
    return { ok: true, rows: found.map((row, i) => ({
      position: row.position || row.rank || i + 1,
      name: row.driverName || row.name || row.driver || "Unknown",
      team: row.teamName || row.team || "",
      points: row.points ?? row.totalPoints ?? "?",
    })) };
  } catch (err) {
    console.error(seriesLabel + " standings lookup failed:", err);
    return { ok: false, error: err.message };
  }
}

function findStandingsArray(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    if (
      obj.length > 3 &&
      typeof obj[0] === "object" &&
      obj[0] !== null &&
      Object.keys(obj[0]).some((k) => /name|driver/i.test(k)) &&
      Object.keys(obj[0]).some((k) => /point/i.test(k))
    ) {
      return obj;
    }
    for (const item of obj) {
      const found = findStandingsArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(obj)) {
    const found = findStandingsArray(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
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
