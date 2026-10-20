import { Redis } from "@upstash/redis";

// Public visitor count for the hero stats. Needs Upstash Redis connected to the Vercel project
// (Storage → Upstash for Redis), which sets these env vars. POST counts a new visitor, GET reads the total.
const redis = new Redis({
  url: process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN!,
});
const KEY = "visitors";

export async function GET() {
  const visitors = Number(await redis.get(KEY)) || 0;
  return Response.json({ visitors }, { headers: { "Cache-Control": "public, s-maxage=60" } });
}

export async function POST() {
  return Response.json({ visitors: await redis.incr(KEY) });
}
