export default async () => {
  const base = (process.env.URL || process.env.APP_URL || "").replace(/\/$/, "");
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) throw new Error("URL and CRON_SECRET are required");
  const res = await fetch(`${base}/api/cron/tick`, { headers: { Authorization: `Bearer ${secret}` } });
  if (!res.ok) throw new Error(`cron tick failed (${res.status})`);
  return new Response(await res.text());
};
