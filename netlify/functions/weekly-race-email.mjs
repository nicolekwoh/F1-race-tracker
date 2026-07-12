// Runs every Sunday at 23:00 UTC (see netlify.toml). Emails a weekly race-weekend
// status update to gelumbauskas@gmail.com via EmailJS (sends through Nicole's
// connected Gmail, so it can reach any recipient without a verified domain).

const SITE_URL = "https://majestic-tanuki-dc34b4.netlify.app/";
const TO_EMAIL = "gelumbauskas@gmail.com";

// Same F1 schedule as the site (only what's needed here: name, location, race start in UTC)
const F1_ROUNDS = [
  { name: "Australian", location: "Melbourne", gp: "2026-03-08T04:00:00Z" },
  { name: "Chinese", location: "Shanghai", gp: "2026-03-15T07:00:00Z" },
  { name: "Japanese", location: "Suzuka", gp: "2026-03-29T05:00:00Z" },
  { name: "Miami", location: "Miami", gp: "2026-05-03T17:00:00Z" },
  { name: "Canadian", location: "Montreal", gp: "2026-05-24T20:00:00Z" },
  { name: "Monaco", location: "Monte Carlo", gp: "2026-06-07T13:00:00Z" },
  { name: "Barcelona-Catalunya", location: "Barcelona", gp: "2026-06-14T13:00:00Z" },
  { name: "Austrian", location: "Spielberg", gp: "2026-06-28T13:00:00Z" },
  { name: "British", location: "Silverstone", gp: "2026-07-05T14:00:00Z" },
  { name: "Belgian", location: "Spa-Francorchamps", gp: "2026-07-19T13:00:00Z" },
  { name: "Hungarian", location: "Budapest", gp: "2026-07-26T13:00:00Z" },
  { name: "Dutch", location: "Zandvoort", gp: "2026-08-23T13:00:00Z" },
  { name: "Italian", location: "Monza", gp: "2026-09-06T13:00:00Z" },
  { name: "Spanish", location: "Madrid", gp: "2026-09-13T13:00:00Z" },
  { name: "Azerbaijan", location: "Baku", gp: "2026-09-26T11:00:00Z" },
  { name: "Singapore", location: "Singapore", gp: "2026-10-11T12:00:00Z" },
  { name: "United States", location: "Austin", gp: "2026-10-25T20:00:00Z" },
  { name: "Mexican", location: "Mexico City", gp: "2026-11-01T20:00:00Z" },
  { name: "Brazilian", location: "Sao Paulo", gp: "2026-11-08T17:00:00Z" },
  { name: "Las Vegas", location: "Las Vegas", gp: "2026-11-22T04:00:00Z" },
  { name: "Qatar", location: "Doha", gp: "2026-11-29T16:00:00Z" },
  { name: "Abu Dhabi", location: "Yas Marina", gp: "2026-12-06T13:00:00Z" },
];

function fmtET(isoString) {
  const d = new Date(isoString);
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateFmt.format(d)}, ${timeFmt.format(d)} ET`;
}

async function getChampionshipLeader() {
  try {
    const res = await fetch("https://api.jolpi.ca/ergast/f1/current/driverStandings.json");
    if (!res.ok) throw new Error("standings fetch failed: " + res.status);
    const json = await res.json();
    const list = json?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings;
    if (!list || !list.length) throw new Error("no standings data");
    const leader = list[0];
    const name = `${leader.Driver.givenName} ${leader.Driver.familyName}`;
    const team = leader.Constructors?.[0]?.name || "";
    return `${name}${team ? ` (${team})` : ""} — ${leader.points} points`;
  } catch (err) {
    console.error("Standings lookup failed:", err);
    return "unavailable this week";
  }
}

function buildMessage(now) {
  const upcoming = F1_ROUNDS
    .map((r) => ({ ...r, gpDate: new Date(r.gp) }))
    .filter((r) => r.gpDate > now)
    .sort((a, b) => a.gpDate - b.gpDate);

  if (upcoming.length === 0) {
    return null; // season's over, nothing to send
  }

  const next = upcoming[0];
  const daysUntil = Math.ceil((next.gpDate - now) / 86400000);
  const whenText = fmtET(next.gp);

  let subjectPrefix, statusLine;
  if (daysUntil <= 8) {
    subjectPrefix = "Race THIS weekend";
    statusLine = "There's a race this coming weekend.";
  } else if (daysUntil <= 15) {
    subjectPrefix = "No race this weekend — next up in 2 weeks";
    statusLine = "No race this weekend — the next one is two weekends away.";
  } else {
    const weeks = Math.round(daysUntil / 7);
    subjectPrefix = `No race this weekend — next up in ~${weeks} weeks`;
    statusLine = `No race this weekend — the next one is about ${weeks} weeks away.`;
  }

  const subject = `🏁 ${subjectPrefix}: ${next.name} GP — ${next.location}, ${whenText}`;
  return { subject, statusLine, raceName: `${next.name} GP`, location: next.location, whenText };
}

export default async (req) => {
  try {
    const now = new Date();
    const msg = buildMessage(now);

    if (!msg) {
      console.log("No upcoming race — season complete, skipping email.");
      return new Response("Season complete, nothing to send.", { status: 200 });
    }

    const leaderLine = await getChampionshipLeader();

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
          subject: msg.subject,
          status_line: msg.statusLine,
          race_name: msg.raceName,
          location: msg.location,
          when_text: msg.whenText,
          leader_line: leaderLine,
          site_url: SITE_URL,
        },
      }),
    });

    if (!emailjsRes.ok) {
      const errText = await emailjsRes.text();
      console.error("EmailJS send failed:", emailjsRes.status, errText);
      return new Response("Email send failed: " + errText, { status: 500 });
    }

    console.log("Email sent:", msg.subject);
    return new Response("Email sent: " + msg.subject, { status: 200 });
  } catch (err) {
    console.error("Function error:", err);
    return new Response("Function error: " + err.message, { status: 500 });
  }
};
