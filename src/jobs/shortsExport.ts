/**
 * One-time export of YouTube Shorts posting times for every approved creator YouTube channel.
 * Pulls up to 150 recent uploads per channel (official API), keeps videos of 3 minutes or less from the
 * last 90 days, stores them in the app (adds history), and writes compact JSON lines to the log so the
 * owner can get a spreadsheet. No scraping; TikTok isn't available through any permitted API.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import * as yt from "@/providers/youtube";
import { storeVideos } from "@/ingest/creators";

export async function exportShorts(): Promise<string> {
  const accs = await db.select({
    id: schema.creatorAccounts.id, handle: schema.creatorAccounts.handle, name: schema.creatorAccounts.displayName,
    playlist: schema.creatorAccounts.uploadsPlaylist, subs: schema.creatorAccounts.followerCount, role: schema.creatorAccounts.role,
    creator: schema.creators.name, tags: schema.creators.tags,
  }).from(schema.creatorAccounts).innerJoin(schema.creators, eq(schema.creators.id, schema.creatorAccounts.creatorId))
    .where(and(eq(schema.creatorAccounts.platform, "youtube"), eq(schema.creatorAccounts.verified, true), eq(schema.creators.isSelf, false)));
  const since = Date.now() - 90 * 86400_000;
  let total = 0;
  for (const a of accs) {
    if (!a.playlist) continue;
    try {
      const vids = await yt.getVideos(await yt.recentUploadIds(a.playlist, 150));
      await storeVideos("youtube", a.id, vids);
      const shorts = vids.filter((v) => v.durationSec != null && v.durationSec <= 180 && v.publishedAt.getTime() >= since);
      console.log(`[shortsmeta] ${JSON.stringify({ c: a.creator, ch: a.name, h: a.handle, role: a.role, cohort: a.tags[0] ?? "Core", subs: a.subs, uploads: vids.length, shorts: shorts.length })}`);
      for (let i = 0; i < shorts.length; i += 20) {
        const rows = shorts.slice(i, i + 20).map((v) => [v.externalId, v.publishedAt.toISOString(), v.durationSec, v.views, v.likes, v.comments, v.title.replace(/\s+/g, " ").slice(0, 60)]);
        console.log(`[shortsjson] ${JSON.stringify({ c: a.creator, h: a.handle, r: rows })}`);
      }
      total += shorts.length;
    } catch (e) {
      console.log(`[shortsmeta] ${JSON.stringify({ c: a.creator, h: a.handle, error: (e as Error).message.slice(0, 120) })}`);
    }
  }
  console.log(`[shortsdone] ${accs.length} channels, ${total} shorts`);
  return `${accs.length} channels, ${total} shorts`;
}
