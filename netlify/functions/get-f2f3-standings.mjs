// On-demand endpoint the page calls when the F2 or F3 standings tab is opened:
// /.netlify/functions/get-f2f3-standings
//
// FIA's standings pages ship a real server-rendered <table> (Driver / SR / FR
// per round / Points). This parses that table directly and returns the FULL
// per-round SR/FR breakdown (not just totals), matching F1's per-round grid.
//
// Round columns are derived from each data row's OWN cell count rather than
// the header row — the header uses colspan + decorative "scroll" cells that
// are unreliable to parse exactly, but every driver row has a clean, fixed
// number of numeric cells (or "-" for a round not yet run). The most common
// cell-count across rows wins, so one malformed row can't break the rest.
// Round names come from our own known calendar order, not the scraped page.
//
// No database/cache needed — this just scrapes fresh on every call. A
// Cache-Control header lets Netlify's CDN serve repeat requests within the
// same 30-minute window without re-hitting FIA's site every time.

const F2_ROUND_NAMES = ["Melbourne","Miami","Montréal","Monaco","Barcelona","Austria","Silverstone","Belgium","Hungary","Italy","Spain","Azerbaijan","Qatar","Abu Dhabi"];
const F3_ROUND_NAMES = ["Melbourne","Monaco","Barcelona","Austria","Silverstone","Belgium","Hungary","Italy","Spain"];

// FIA's live standings table (parsed above) has no nationality data at all —
// only the separate driver-bio listing pages (fiaformula2.com/en/drivers,
// fiaformula3.com/en/drivers) show a "Flag of <country>" per driver. That
// roster is stable for the season, so it's hardcoded here rather than
// scraping a second page on every request. Keyed by the exact "X. Surname"
// string FIA's standings table itself uses, so no name-matching logic needed.
const F2_FLAGS = {
  "N. Tsolov": "🇧🇬", "G. Mini": "🇮🇹", "R. Câmara": "🇧🇷", "A. Dunne": "🇮🇪",
  "N. Leon": "🇲🇽", "K. Maini": "🇮🇳", "D. Beganovic": "🇸🇪", "M. Stenshorne": "🇳🇴",
  "L. van Hoepen": "🇳🇱", "J. Dürksen": "🇵🇾", "R. Villagomez": "🇲🇽", "R. Miyata": "🇯🇵",
  "O. Goethe": "🇩🇪", "S. Montoya": "🇨🇴", "T. Inthraphuvasak": "🇹🇭", "R. Bilinski": "🇵🇱",
  "C. Herta": "🇺🇸", "J. Bennett": "🇬🇧", "N. Varrone": "🇦🇷", "E. Fittipaldi": "🇧🇷",
  "C. Shields": "🇬🇧", "M. Boya": "🇪🇸",
};
// A few F3 entries (Benavides, Heuzenroeder, Hanna) are one-off substitute
// drivers not listed on FIA's official roster page — left without a flag.
const F3_FLAGS = {
  "U. Ugochukwu": "🇺🇸", "F. Slater": "🇬🇧", "T. Naël": "🇫🇷", "N. Stromsted": "🇩🇰",
  "B. Badoer": "🇮🇹", "B. Del Pino": "🇪🇸", "P. Clerot": "🇧🇷", "M. Gladysz": "🇵🇱",
  "H. Yamakoshi": "🇯🇵", "T. Kato": "🇯🇵", "J. Nakamura": "🇯🇵", "E. Rivera": "🇲🇽",
  "E. Deligny": "🇫🇷", "T. Taponen": "🇫🇮", "G. Xie": "🇨🇳", "J. Wharton": "🇦🇺",
  "L. Sharp": "🇳🇿", "Y. David": "🇱🇰", "A. Giusti": "🇫🇷", "K. Le": "🇯🇵",
  "M. Colnaghi": "🇦🇷", "M. De Palo": "🇮🇹", "N. Lacorte": "🇮🇹", "F. Mclaughlin": "🇮🇪",
  "J. Garfias": "🇲🇽", "C. Ho": "🇸🇬", "N. Bhirombhakdi": "🇹🇭", "F. Barrichello": "🇧🇷",
  "W. Shin": "🇰🇷", "R. Escotto": "🇲🇽",
};

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

function extractFullStandings(rows, knownRoundNames, flagMap) {
  const drivers = [];
  for (const cells of rows) {
    const name = cells[0];
    const last = cells[cells.length - 1];
    const points = parseInt(last, 10);
    if (
      !name ||
      !/^[A-Z]\.\s*[A-Za-zÀ-ÿ'’-]+/.test(name) ||
      isNaN(points) ||
      String(points) !== last.trim()
    ) {
      continue;
    }
    const roundCells = cells.slice(1, cells.length - 1);
    drivers.push({ name, points, roundCells });
  }
  if (!drivers.length) return null;

  // Most common round-cell width across rows wins (guards against one stray row).
  const counts = {};
  drivers.forEach((d) => { counts[d.roundCells.length] = (counts[d.roundCells.length] || 0) + 1; });
  const bestWidth = parseInt(
    Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0],
    10
  );

  if (isNaN(bestWidth) || bestWidth === 0) {
    // Couldn't make sense of round columns — fall back to totals-only.
    return {
      roundNames: [],
      drivers: drivers.map((d, i) => ({ position: i + 1, name: d.name, points: d.points, rounds: [] })),
    };
  }

  // Normally every round is an SR+FR pair, but some series' pages have a
  // trailing unpaired column (observed on F3's page — one extra FR-only
  // column past the last named round). Handle both: pair up what divides
  // evenly, then tack on one single-column "round" for any odd remainder
  // rather than discarding the whole row's data.
  const roundPairCount = Math.floor(bestWidth / 2);
  const hasTrailingSingle = bestWidth % 2 === 1;
  const totalRounds = roundPairCount + (hasTrailingSingle ? 1 : 0);
  const roundNames = knownRoundNames.slice(0, totalRounds);
  while (roundNames.length < totalRounds) roundNames.push("Round " + (roundNames.length + 1));

  const out = drivers
    .filter((d) => d.roundCells.length === bestWidth)
    .map((d, i) => {
      const rounds = [];
      for (let r = 0; r < roundPairCount; r++) {
        const sr = d.roundCells[r * 2];
        const fr = d.roundCells[r * 2 + 1];
        rounds.push({
          sr: sr === "-" || sr === "" || sr === undefined ? null : parseInt(sr, 10),
          fr: fr === "-" || fr === "" || fr === undefined ? null : parseInt(fr, 10),
        });
      }
      if (hasTrailingSingle) {
        const fr = d.roundCells[bestWidth - 1];
        rounds.push({
          sr: null,
          fr: fr === "-" || fr === "" || fr === undefined ? null : parseInt(fr, 10),
        });
      }
      return { position: i + 1, name: d.name, flag: flagMap[d.name] || "", points: d.points, rounds };
    });

  return { roundNames, drivers: out };
}

async function getFiaStandings(seriesUrl, seriesLabel, roundNames, flagMap) {
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

    const result = extractFullStandings(rows, roundNames, flagMap);
    if (!result || !result.drivers.length) {
      throw new Error(seriesLabel + " table found but no driver rows matched. rowCount=" + rows.length);
    }

    return { ok: true, roundNames: result.roundNames, drivers: result.drivers };
  } catch (err) {
    console.error(seriesLabel + " standings lookup failed:", err);
    return { ok: false, error: err.message };
  }
}

export default async (req) => {
  const [f2Result, f3Result] = await Promise.all([
    getFiaStandings("https://www.fiaformula2.com/en/standings/2026/drivers", "F2", F2_ROUND_NAMES, F2_FLAGS),
    getFiaStandings("https://www.fiaformula3.com/en/standings/2026/drivers", "F3", F3_ROUND_NAMES, F3_FLAGS),
  ]);

  return new Response(JSON.stringify({
    f2: f2Result.ok ? { roundNames: f2Result.roundNames, drivers: f2Result.drivers } : null,
    f3: f3Result.ok ? { roundNames: f3Result.roundNames, drivers: f3Result.drivers } : null,
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
