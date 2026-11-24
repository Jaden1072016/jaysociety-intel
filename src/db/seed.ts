import { sql } from "drizzle-orm";
import { db, schema } from "./index";

/**
 * Starting watchlist from the project brief. Handles are best guesses and start UNCONFIRMED:
 * the app looks each one up and shows you the platform's own name + follower count before
 * anything is tracked. Edit or delete freely in the Creators tab.
 */
export const SEED_CREATORS: { name: string; priority: number; disambiguation: string; accounts: [string, string][] }[] = [
  { name: "Raud", priority: 1, disambiguation: "Philly streamer Cheraud Brown, also known as Raud Geez (rap single \"Over\"). Not other artists named Raud. Add his handles after checking his profile.", accounts: [] },
  { name: "DDG", priority: 1, disambiguation: "Pontiac, Michigan rapper/YouTuber (PontiacMadeDDG). Confirm the channel is his main one, not a clips channel.", accounts: [["youtube", "@DDG"], ["twitch", "ddg"]] },
  { name: "Stable Ronaldo", priority: 1, disambiguation: "Streamer Stable Ronaldo. Watch out for fan clip channels with similar names.", accounts: [["twitch", "stableronaldo"], ["youtube", "@StableRonaldo"]] },
  { name: "Kai Cenat", priority: 1, disambiguation: "AMP streamer. He also has a separate clips/live channel; confirm which one you want.", accounts: [["youtube", "@KaiCenat"], ["twitch", "kaicenat"]] },
  { name: "Duke Dennis", priority: 1, disambiguation: "AMP member and gaming/2K creator.", accounts: [["youtube", "@DukeDennis"], ["twitch", "dukedennis"]] },
  { name: "Fanum", priority: 1, disambiguation: "AMP member. Not unrelated 'fanum tax' meme accounts.", accounts: [["youtube", "@Fanum"], ["twitch", "fanum"]] },
  { name: "Lacy", priority: 2, disambiguation: "FaZe streamer Lacy. Common name; confirm follower count looks right.", accounts: [["twitch", "lacy"], ["youtube", "@lacy"]] },
  { name: "PlaqueBoyMax", priority: 1, disambiguation: "Streamer/producer PlaqueBoyMax. Not other creators named Max.", accounts: [["twitch", "plaqueboymax"], ["youtube", "@PlaqueBoyMax"]] },
];

export async function seedIfEmpty() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.creators);
  if (n > 0) return false;
  for (const c of SEED_CREATORS) {
    const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const [row] = await db.insert(schema.creators).values({ name: c.name, slug, priority: c.priority, disambiguation: c.disambiguation }).onConflictDoNothing().returning();
    if (!row) continue;
    for (const [platform, handle] of c.accounts) {
      await db.insert(schema.creatorAccounts).values({ creatorId: row.id, platform, handle }).onConflictDoNothing();
    }
  }
  // Your own public handles (from your link-in-bio). Analytics need OAuth in Settings.
  const [me] = await db.insert(schema.creators).values({ name: "Jay Society", slug: "jay-society", isSelf: true, priority: 0 }).onConflictDoNothing().returning();
  if (me) {
    for (const [platform, handle] of [["youtube", "@jaysociety_"], ["twitch", "jaysociety_"], ["tiktok", "@thejaysociety"], ["instagram", "@jaysociety__"]]) {
      await db.insert(schema.creatorAccounts).values({ creatorId: me.id, platform, handle }).onConflictDoNothing();
    }
  }
  return true;
}
