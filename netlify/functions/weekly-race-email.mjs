// Runs every 5 minutes (see netlify.toml) and checks whether an F1 race just
// finished. Only sends an email when a GP ended 1-6 minutes ago; if no GP is
// happening this weekend, the check simply finds nothing and no email goes out.
// Emails gelumbauskas@gmail.com via EmailJS (sends through Nicole's connected
// Gmail, so it can reach any recipient without a verified domain).

const SITE_URL = "https://majestic-tanuki-dc34b4.netlify.app/";
const TO_EMAIL = "gelumbauskas@gmail.com";

// We only know each race's scheduled START time, not its actual finish, so we
// estimate the end as start + 2 hours (covers a full-distance GP plus formation
// lap; a long red-flag delay could occasionally push the real finish later,
// which would mean this misses that week's window — acceptable edge case).
const RACE_DURATION_MS = 2 * 60 * 60 * 1000;
// Matches the 5-minute cron cadence below: a race that ended 1-6 minutes ago
// falls in exactly one 5-minute tick, so this fires once per race, not more.
const TRIGGER_WINDOW_START_MS = 1 * 60 * 1000;
const TRIGGER_WINDOW_END_MS = 6 * 60 * 1000;

// F1 schedule: name, location, first-session (fp1) and race (gp) start in UTC
const F1_ROUNDS = [
  { name: "Australian", location: "Melbourne", start: "2026-03-06T01:30:00Z", gp: "2026-03-08T04:00:00Z" },
  { name: "Chinese", location: "Shanghai", start: "2026-03-13T03:30:00Z", gp: "2026-03-15T07:00:00Z" },
  { name: "Japanese", location: "Suzuka", start: "2026-03-27T02:30:00Z", gp: "2026-03-29T05:00:00Z" },
  { name: "Miami", location: "Miami", start: "2026-05-01T16:00:00Z", gp: "2026-05-03T17:00:00Z" },
  { name: "Canadian", location: "Montreal", start: "2026-05-22T16:30:00Z", gp: "2026-05-24T20:00:00Z" },
  { name: "Monaco", location: "Monte Carlo", start: "2026-06-05T11:30:00Z", gp: "2026-06-07T13:00:00Z" },
  { name: "Barcelona-Catalunya", location: "Barcelona", start: "2026-06-12T11:30:00Z", gp: "2026-06-14T13:00:00Z" },
  { name: "Austrian", location: "Spielberg", start: "2026-06-26T11:30:00Z", gp: "2026-06-28T13:00:00Z" },
  { name: "British", location: "Silverstone", start: "2026-07-03T11:30:00Z", gp: "2026-07-05T14:00:00Z" },
  { name: "Belgian", location: "Spa-Francorchamps", start: "2026-07-17T11:30:00Z", gp: "2026-07-19T13:00:00Z" },
  { name: "Hungarian", location: "Budapest", start: "2026-07-24T11:30:00Z", gp: "2026-07-26T13:00:00Z" },
  { name: "Dutch", location: "Zandvoort", start: "2026-08-21T10:30:00Z", gp: "2026-08-23T13:00:00Z" },
  { name: "Italian", location: "Monza", start: "2026-09-04T10:30:00Z", gp: "2026-09-06T13:00:00Z" },
  { name: "Spanish", location: "Madrid", start: "2026-09-11T11:30:00Z", gp: "2026-09-13T13:00:00Z" },
  { name: "Azerbaijan", location: "Baku", start: "2026-09-24T08:30:00Z", gp: "2026-09-26T11:00:00Z" },
  { name: "Singapore", location: "Singapore", start: "2026-10-09T08:30:00Z", gp: "2026-10-11T12:00:00Z" },
  { name: "United States", location: "Austin", start: "2026-10-23T17:30:00Z", gp: "2026-10-25T20:00:00Z" },
  { name: "Mexican", location: "Mexico City", start: "2026-10-30T18:30:00Z", gp: "2026-11-01T20:00:00Z" },
  { name: "Brazilian", location: "Sao Paulo", start: "2026-11-06T15:30:00Z", gp: "2026-11-08T17:00:00Z" },
  { name: "Las Vegas", location: "Las Vegas", start: "2026-11-20T00:30:00Z", gp: "2026-11-22T04:00:00Z" },
  { name: "Qatar", location: "Doha", start: "2026-11-27T13:30:00Z", gp: "2026-11-29T16:00:00Z" },
  { name: "Abu Dhabi", location: "Yas Marina", start: "2026-12-04T09:30:00Z", gp: "2026-12-06T13:00:00Z" },
];

// Only need locations here — used to check whether F2/F3 race the same weekend as F1
const F2_LOCATIONS = ["Melbourne", "Miami", "Montréal", "Monte Carlo", "Barcelona", "Spielberg", "Silverstone", "Spa-Francorchamps", "Budapest", "Monza", "Madrid", "Baku", "Doha", "Yas Marina"];
const F3_LOCATIONS = ["Melbourne", "Monte Carlo", "Catalunya", "Spielberg", "Silverstone", "Spa-Francorchamps", "Budapest", "Monza", "Madrid"];
const LOCATION_ALIASES = { catalunya: "barcelona" };

function norm(s) {
  const n = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return LOCATION_ALIASES[n] || n;
}

const monthDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const monthFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short" });
const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

function fmtDateRange(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameMonth = monthFmt.format(start) === monthFmt.format(end);
  if (sameMonth) return `${monthFmt.format(start)} ${dayFmt.format(start)}-${dayFmt.format(end)}`;
  return `${monthDayFmt.format(start)}-${monthDayFmt.format(end)}`;
}

function fmtWhen(isoString) {
  const d = new Date(isoString);
  const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
  return `${dateFmt.format(d)}, ${timeFmt.format(d)} ET`;
}

// ---------- F1 standings (reliable, official-data-backed public API) ----------
async function getF1Standings() {
  try {
    const res = await fetch("https://api.jolpi.ca/ergast/f1/current/driverStandings.json");
    if (!res.ok) throw new Error("F1 standings fetch failed: " + res.status);
    const json = await res.json();
    const list = json?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings;
    if (!list || !list.length) throw new Error("no F1 standings data");
    return list.map((d) => ({
      position: d.position,
      name: `${d.Driver.givenName} ${d.Driver.familyName}`,
      team: d.Constructors?.[0]?.name || "",
      points: d.points,
    }));
  } catch (err) {
    console.error("F1 standings lookup failed:", err);
    return null;
  }
}

// ---------- F2/F3 standings: best-effort, no official public API exists ----------
// FIA's own standings pages are the only source; if their site structure changes
// this will fail gracefully and the section is simply omitted from the email.
async function getFiaStandings(seriesUrl, seriesLabel) {
  try {
    const res = await fetch(seriesUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(seriesLabel + " page fetch failed: " + res.status);
    const html = await res.text();

    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) throw new Error(seriesLabel + " __NEXT_DATA__ not found");
    const data = JSON.parse(match[1]);

    // Structure of FIA's Next.js props isn't publicly documented, so search for
    // the standings array wherever it lives rather than hardcoding a deep path.
    const found = findStandingsArray(data);
    if (!found) throw new Error(seriesLabel + " standings array not found in page data");

    return found.slice(0, 10).map((row, i) => ({
      position: row.position || row.rank || i + 1,
      name: row.driverName || row.name || row.driver || "Unknown",
      team: row.teamName || row.team || "",
      points: row.points ?? row.totalPoints ?? "?",
    }));
  } catch (err) {
    console.error(seriesLabel + " standings lookup failed:", err);
    return null;
  }
}

// Recursively search a parsed object for something that looks like a driver
// standings array (a list of objects each having a name-like and points-like field).
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

function standingsTableHtml(title, standings) {
  if (!standings || !standings.length) {
    return `
      <h3 style="font-family:sans-serif;margin:22px 0 6px;font-size:16px;">${title}</h3>
      <p style="font-family:sans-serif;color:#888;font-size:13px;margin:0;">Standings unavailable this week.</p>
    `;
  }
  const rows = standings
    .map(
      (s) => `
      <tr>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-family:sans-serif;font-size:13px;">${s.position}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-family:sans-serif;font-size:13px;">${s.name}${s.team ? ` <span style="color:#888;">(${s.team})</span>` : ""}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-family:sans-serif;font-size:13px;text-align:right;">${s.points}</td>
      </tr>`
    )
    .join("");
  return `
    <h3 style="font-family:sans-serif;margin:22px 0 6px;font-size:16px;">${title}</h3>
    <table style="border-collapse:collapse;width:100%;">
      <tr>
        <th style="text-align:left;padding:5px 8px;font-family:sans-serif;font-size:11px;color:#888;">#</th>
        <th style="text-align:left;padding:5px 8px;font-family:sans-serif;font-size:11px;color:#888;">Driver</th>
        <th style="text-align:right;padding:5px 8px;font-family:sans-serif;font-size:11px;color:#888;">Pts</th>
      </tr>
      ${rows}
    </table>
  `;
}

// Returns the F1 round whose estimated finish falls 1-6 minutes before `now`,
// or null if no race just ended (including "no F1 race this weekend at all").
function findJustFinishedRound(now) {
  const nowMs = now.getTime();
  for (const r of F1_ROUNDS) {
    const raceEndMs = new Date(r.gp).getTime() + RACE_DURATION_MS;
    const elapsed = nowMs - raceEndMs;
    if (elapsed >= TRIGGER_WINDOW_START_MS && elapsed < TRIGGER_WINDOW_END_MS) {
      return r;
    }
  }
  return null;
}

function buildSubjectAndContext(now) {
  const upcoming = F1_ROUNDS
    .map((r) => ({ ...r, gpDate: new Date(r.gp) }))
    .filter((r) => r.gpDate > now)
    .sort((a, b) => a.gpDate - b.gpDate);

  if (upcoming.length === 0) return null; // season's over

  const next = upcoming[0];
  const dateRange = fmtDateRange(next.start, next.gp);

  const hasF2 = F2_LOCATIONS.some((loc) => norm(loc) === norm(next.location));
  const hasF3 = F3_LOCATIONS.some((loc) => norm(loc) === norm(next.location));
  const series = ["F1"];
  if (hasF2) series.push("F2");
  if (hasF3) series.push("F3");
  const seriesList =
    series.length === 1 ? series[0] : series.length === 2 ? series.join(" & ") : `${series.slice(0, -1).join(", ")} & ${series[series.length - 1]}`;

  const subject = `Next GP: ${dateRange} — ${next.location}: ${seriesList}`;

  return { next, hasF2, hasF3, subject, whenText: fmtWhen(next.gp) };
}

export default async (req) => {
  try {
    const now = new Date();

    const justFinished = findJustFinishedRound(now);
    if (!justFinished) {
      console.log("No GP just finished (or no race this weekend) — skipping email.");
      return new Response("No GP just finished, nothing to send.", { status: 200 });
    }

    const ctx = buildSubjectAndContext(now);

    if (!ctx) {
      console.log("No upcoming race — season complete, skipping email.");
      return new Response("Season complete, nothing to send.", { status: 200 });
    }

    const [f1Standings, f2Standings, f3Standings] = await Promise.all([
      getF1Standings(),
      ctx.hasF2 ? getFiaStandings("https://www.fiaformula2.com/en/standings/2026/drivers", "F2") : Promise.resolve(null),
      ctx.hasF3 ? getFiaStandings("https://www.fiaformula3.com/en/standings/2026/drivers", "F3") : Promise.resolve(null),
    ]);

    let bodyHtml = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <p style="font-size:14px;">${ctx.next.name} GP — ${ctx.next.location}<br>Race: ${ctx.whenText}</p>
        ${standingsTableHtml("F1 Driver's Championship Standings", f1Standings)}
        ${ctx.hasF2 ? standingsTableHtml("F2 Driver's Championship Standings", f2Standings) : ""}
        ${ctx.hasF3 ? standingsTableHtml("F3 Driver's Championship Standings", f3Standings) : ""}
        <p style="font-family:sans-serif;font-size:13px;margin-top:24px;">
          <a href="${SITE_URL}">Open Race Tracker →</a>
        </p>
      </div>
    `;

    const emailjsRes = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        accessToken: process.env.EMAILJS_PRIVATE_KEY,
        template_params: {
          to_email: TO_EMAIL,
          subject: ctx.subject,
          body_html: bodyHtml,
        },
      }),
    });

    if (!emailjsRes.ok) {
      const errText = await emailjsRes.text();
      console.error("EmailJS send failed:", emailjsRes.status, errText);
      return new Response("Email send failed: " + errText, { status: 500 });
    }

    console.log("Email sent:", ctx.subject);
    return new Response("Email sent: " + ctx.subject, { status: 200 });
  } catch (err) {
    console.error("Function error:", err);
    return new Response("Function error: " + err.message, { status: 500 });
  }
};
