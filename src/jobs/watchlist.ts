/**
 * One-time watchlist import (2026-11-23) from the owner's researched account list.
 * Runs once (job_runs dedupe). Every YouTube/Twitch account is checked against the platform
 * before it's confirmed; anything that doesn't match stays unconfirmed and is logged.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import * as yt from "@/providers/youtube";
import * as tw from "@/providers/twitch";
import { accessToken } from "@/providers/oauth";
import { refreshAccount } from "@/ingest/creators";

type Role = "main" | "secondary" | "reference";
type Entry = { platform: string; handle: string; url?: string; expectedId?: string; expected?: number; role: Role };

export const WATCHLIST: Record<string, { disambiguation?: string; entries: Entry[]; remove?: [string, string][] }> = {
  Raud: {
    disambiguation: "Philly streamer Cheraud Brown (Raud Geez). Avoid fan/update pages like @RaudUpdates, @raudgeezplug_. Old Twitch handle shelovesraud is outdated.",
    entries: [
      { platform: "youtube", handle: "@shelovesraud", expected: 465_000, role: "main" },
      { platform: "youtube", handle: "@raudlive", expectedId: "UC29OtzBQfYcz2GSZlVlROsQ", expected: 194_000, role: "secondary" },
      { platform: "twitch", handle: "raud", expected: 569_000, role: "main" },
      { platform: "instagram", handle: "@raudxgeez", url: "https://www.instagram.com/raudxgeez/", role: "reference" },
      { platform: "x", handle: "@raudxgeezz", url: "https://x.com/raudxgeezz", role: "reference" },
    ],
  },
  DDG: {
    entries: [
      { platform: "youtube", handle: "@pontiacmadeddgVLOGS", expectedId: "UCDDgfKQE3eaD1H08VHRAfig", expected: 3_580_000, role: "main" },
      { platform: "youtube", handle: "@DDGMusicChannel", expectedId: "UCKqqDlf6lfo3ChRA4-gzusQ", expected: 3_280_000, role: "secondary" },
      { platform: "twitch", handle: "ddg", expected: 2_470_000, role: "main" },
      { platform: "kick", handle: "ddg", url: "https://kick.com/ddg", role: "reference" },
      { platform: "tiktok", handle: "@pontiacmadeddg", url: "https://www.tiktok.com/@pontiacmadeddg", role: "reference" },
      { platform: "instagram", handle: "@ddg", url: "https://www.instagram.com/ddg/", role: "reference" },
      { platform: "x", handle: "@PontiacMadeDDG", url: "https://x.com/PontiacMadeDDG", role: "reference" },
    ],
    remove: [["youtube", "@DDG"]],
  },
  "Stable Ronaldo": {
    entries: [
      { platform: "youtube", handle: "@StableRonaldoYT", expectedId: "UCav7eOwYM9Bwxlgnts0y74Q", expected: 1_170_000, role: "main" },
      { platform: "youtube", handle: "@StableRonaldoLive", expectedId: "UCLldJScHWCtsFlfanYXS8nQ", expected: 1_520_000, role: "secondary" },
      { platform: "youtube", handle: "@TheStableYT", expected: 265_000, role: "secondary" },
      { platform: "twitch", handle: "stableronaldo", expected: 5_430_000, role: "main" },
      { platform: "tiktok", handle: "@realstableronaldo", url: "https://www.tiktok.com/@realstableronaldo", role: "reference" },
      { platform: "instagram", handle: "@stableronaldo", url: "https://www.instagram.com/stableronaldo/", role: "reference" },
      { platform: "x", handle: "@StableRonaldo", url: "https://x.com/StableRonaldo", role: "reference" },
    ],
    remove: [["youtube", "@StableRonaldo"]],
  },
  "Kai Cenat": {
    entries: [
      { platform: "youtube", handle: "@KaiCenat", expectedId: "UCoEmptob-eEGKk18c2VplJg", expected: 8_280_000, role: "main" },
      { platform: "youtube", handle: "@KaiCenatLive", expectedId: "UCvCfpQXRXdJdL07pzTIA6Cw", expected: 16_900_000, role: "secondary" },
      { platform: "twitch", handle: "kaicenat", expected: 22_100_000, role: "main" },
      { platform: "tiktok", handle: "@kai_cenat", url: "https://www.tiktok.com/@kai_cenat", role: "reference" },
      { platform: "instagram", handle: "@kaicenat", url: "https://www.instagram.com/kaicenat/", role: "reference" },
      { platform: "x", handle: "@KaiCenat", url: "https://x.com/KaiCenat", role: "reference" },
    ],
  },
  "Duke Dennis": {
    entries: [
      { platform: "youtube", handle: "@DukeDennisAMP", expectedId: "UCO_RC-EuZVTkxm5e8ek1zvA", expected: 3_630_000, role: "main" },
      { platform: "youtube", handle: "@DukeDennis864", expectedId: "UCspFcBk0XKaSJjZccJkPqnQ", expected: 2_000_000, role: "secondary" },
      { platform: "youtube", handle: "@DukeDennisLive", expected: 1_550_000, role: "secondary" },
      { platform: "twitch", handle: "duke", expected: 3_480_000, role: "main" },
      { platform: "tiktok", handle: "@dukedennis", url: "https://www.tiktok.com/@dukedennis", role: "reference" },
      { platform: "instagram", handle: "@dukedennis", url: "https://www.instagram.com/dukedennis/", role: "reference" },
      { platform: "x", handle: "@ImDukeDennis", url: "https://x.com/ImDukeDennis", role: "reference" },
    ],
    remove: [["youtube", "@DukeDennis"]], // twitch "dukedennis" handled by follower comparison below
  },
  Fanum: {
    entries: [
      { platform: "youtube", handle: "@Fanum", expected: 1_830_000, role: "main" },
      { platform: "youtube", handle: "@FanumLive", expectedId: "UCP45EebTGl1ISj2DX33A2Rg", expected: 3_970_000, role: "secondary" },
      { platform: "youtube", handle: "@FanumGaming", expected: 206_000, role: "secondary" },
      { platform: "twitch", handle: "fanum", expected: 4_040_000, role: "main" },
      { platform: "tiktok", handle: "@elfanum", url: "https://www.tiktok.com/@elfanum", role: "reference" },
      { platform: "instagram", handle: "@elfanum", url: "https://www.instagram.com/elfanum/", role: "reference" },
      { platform: "x", handle: "@FanumTV", url: "https://x.com/FanumTV", role: "reference" },
    ],
  },
  Lacy: {
    entries: [
      { platform: "youtube", handle: "@LacyHimself", expected: 1_040_000, role: "main" },
      { platform: "youtube", handle: "UCeoZXkaJDtdTHafgoZeDcAA", expectedId: "UCeoZXkaJDtdTHafgoZeDcAA", expected: 115_000, role: "secondary" },
      { platform: "twitch", handle: "lacy", expected: 3_600_000, role: "main" },
      { platform: "tiktok", handle: "@lacy", url: "https://www.tiktok.com/@lacy", role: "reference" },
      { platform: "instagram", handle: "@lacy.himself", url: "https://www.instagram.com/lacy.himself/", role: "reference" },
      { platform: "x", handle: "@LacyHimself", url: "https://x.com/LacyHimself", role: "reference" },
    ],
    remove: [["youtube", "@lacy"]],
  },
  PlaqueBoyMax: {
    entries: [
      { platform: "youtube", handle: "@PlaqueBoyMaxLive", expectedId: "UCKDBMEtklUsdH-xJIyrBG7A", expected: 1_890_000, role: "main" },
      { platform: "youtube", handle: "@PlaqueBoyMax", expected: 251_000, role: "secondary" },
      { platform: "youtube", handle: "@maxplug5", role: "secondary" },
      { platform: "twitch", handle: "plaqueboymax", expected: 2_880_000, role: "main" },
      { platform: "tiktok", handle: "@plaqueboymax555", url: "https://www.tiktok.com/@plaqueboymax555", role: "reference" },
      { platform: "instagram", handle: "@plaqueboymax", url: "https://www.instagram.com/plaqueboymax/", role: "reference" },
      { platform: "x", handle: "@PlaqueBoyMax", url: "https://x.com/PlaqueBoyMax", role: "reference" },
    ],
  },
};

/** Within ±40% of the researched count (counts drift and sources round). */
export function countMatches(actual: number | null | undefined, expected: number | undefined): boolean | null {
  if (expected == null || actual == null) return null;
  return actual >= expected * 0.6 && actual <= expected * 1.4;
}

const out = (s: string) => console.log(`[watchlist] ${s}`);

async function creatorId(name: string, disambiguation?: string) {
  const [c] = await db.select().from(schema.creators).where(eq(schema.creators.name, name));
  if (c) {
    if (disambiguation) await db.update(schema.creators).set({ disambiguation }).where(eq(schema.creators.id, c.id));
    return c.id;
  }
  const [n] = await db.insert(schema.creators).values({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), priority: 1, disambiguation: disambiguation ?? null }).returning();
  return n.id;
}

async function upsertAccount(cid: string, e: Entry) {
  const [existing] = await db.select().from(schema.creatorAccounts)
    .where(and(eq(schema.creatorAccounts.platform, e.platform), eq(schema.creatorAccounts.handle, e.handle)));
  if (existing) {
    await db.update(schema.creatorAccounts).set({ creatorId: cid, url: e.url ?? existing.url }).where(eq(schema.creatorAccounts.id, existing.id));
    return existing.id;
  }
  const [row] = await db.insert(schema.creatorAccounts).values({ creatorId: cid, platform: e.platform, handle: e.handle, url: e.url ?? null }).returning();
  return row.id;
}

export async function applyWatchlist(): Promise<string> {
  const twitchUser = await accessToken("twitch").catch(() => null);
  const summary = { confirmed: 0, flagged: 0, saved: 0, removed: 0, refreshed: 0 };
  const toRefresh: string[] = [];

  for (const [name, spec] of Object.entries(WATCHLIST)) {
    const cid = await creatorId(name, spec.disambiguation);
    for (const [platform, handle] of spec.remove ?? []) {
      const r = await db.delete(schema.creatorAccounts).where(and(eq(schema.creatorAccounts.platform, platform), eq(schema.creatorAccounts.handle, handle))).returning();
      if (r.length) { summary.removed++; out(`${name}: removed wrong ${platform} ${handle}`); }
    }
    for (const e of spec.entries) {
      const id = await upsertAccount(cid, e);
      if (e.role === "reference") { summary.saved++; continue; }
      try {
        let ok = false, detail = "";
        if (e.platform === "youtube") {
          const ch = await yt.resolveChannel(e.handle);
          if (!ch) { detail = "not found on YouTube"; }
          else {
            await db.update(schema.creatorAccounts).set({ externalId: ch.id, displayName: ch.title, followerCount: ch.subscribers, url: ch.url, uploadsPlaylist: ch.uploadsPlaylist, resolveError: null }).where(eq(schema.creatorAccounts.id, id));
            const idOk = e.expectedId ? ch.id === e.expectedId : null;
            const countOk = countMatches(ch.subscribers, e.expected);
            ok = idOk === true || (idOk === null && countOk === true);
            detail = `"${ch.title}" ${ch.id} subs=${ch.subscribers ?? "hidden"} (expected ~${e.expected ?? "?"}${e.expectedId ? `, id ${idOk ? "matches" : "DIFFERS"}` : ""})`;
          }
        } else if (e.platform === "twitch") {
          const u = await tw.resolveUser(e.handle);
          if (!u) { detail = "not found on Twitch"; }
          else {
            const followers = twitchUser ? await tw.followerTotal(u.id, twitchUser).catch(() => null) : null;
            await db.update(schema.creatorAccounts).set({ externalId: u.id, displayName: u.displayName, followerCount: followers, url: u.url, resolveError: null }).where(eq(schema.creatorAccounts.id, id));
            const countOk = countMatches(followers, e.expected);
            ok = countOk === true;
            detail = `"${u.displayName}" id=${u.id} followers=${followers ?? "unknown"} (expected ~${e.expected ?? "?"})`;
          }
        }
        const confirm = ok && e.role === "main";
        await db.update(schema.creatorAccounts).set({ verified: confirm, verifiedAt: confirm ? new Date() : null }).where(eq(schema.creatorAccounts.id, id));
        if (confirm) { summary.confirmed++; toRefresh.push(id); out(`${name}: CONFIRMED ${e.platform} ${e.handle} ${detail}`); }
        else if (ok) { summary.saved++; out(`${name}: saved (secondary, not tracked) ${e.platform} ${e.handle} ${detail}`); }
        else { summary.flagged++; out(`${name}: FLAGGED, left unconfirmed ${e.platform} ${e.handle} ${detail}`); }
      } catch (err) {
        summary.flagged++;
        out(`${name}: FLAGGED ${e.platform} ${e.handle} lookup error: ${(err as Error).message.slice(0, 150)}`);
      }
    }
  }

  // Duke Dennis Twitch: keep whichever of duke / dukedennis is actually his (by followers).
  const duke = await db.select().from(schema.creatorAccounts).where(and(eq(schema.creatorAccounts.platform, "twitch"), eq(schema.creatorAccounts.handle, "duke")));
  const dd = await db.select().from(schema.creatorAccounts).where(and(eq(schema.creatorAccounts.platform, "twitch"), eq(schema.creatorAccounts.handle, "dukedennis")));
  if (dd[0]) {
    const dukeVerified = duke[0]?.verified;
    let ddFollowers: number | null = null;
    if (dd[0].externalId && twitchUser) ddFollowers = await tw.followerTotal(dd[0].externalId, twitchUser).catch(() => null);
    out(`Duke Dennis twitch check: duke=${duke[0]?.followerCount ?? "?"} (${dukeVerified ? "confirmed" : "not confirmed"}), dukedennis=${ddFollowers ?? "?"}`);
    if (dukeVerified && (ddFollowers == null || ddFollowers < (duke[0].followerCount ?? 0) / 3)) {
      await db.delete(schema.creatorAccounts).where(eq(schema.creatorAccounts.id, dd[0].id));
      summary.removed++; out("Duke Dennis: removed twitch dukedennis (duke is the real account)");
    } else {
      await db.update(schema.creatorAccounts).set({ followerCount: ddFollowers }).where(eq(schema.creatorAccounts.id, dd[0].id));
      out("Duke Dennis: kept twitch dukedennis for your review (couldn't rule it out)");
    }
  }

  for (const id of toRefresh) {
    try { const r = await refreshAccount(id, { max: 30 }); summary.refreshed++; out(`refreshed ${id}: ${r.stored} videos`); }
    catch (err) { out(`refresh failed ${id}: ${(err as Error).message.slice(0, 150)}`); }
  }
  const msg = `confirmed ${summary.confirmed}, flagged ${summary.flagged}, saved ${summary.saved}, removed ${summary.removed}, refreshed ${summary.refreshed}`;
  out(`DONE ${msg}`);
  return msg;
}

// ---------- Research workbook import (2026-11-23, "Jay_Society_Creator_Research_Watchlist.xlsx") ----------
import research from "./watchlist-research.json";

type ResearchRow = { name: string; cohort: string; priority: number; url: string | null; estimate: string | null; format: string | null; learn: string | null; adapt: string | null; caution: string | null };

export function parseEstimate(s: string | null): number | null {
  const m = /([\d.]+)\s*([KM])/i.exec(s ?? "");
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2].toUpperCase() === "M" ? 1e6 : 1e3));
}

export function researchNotes(r: ResearchRow): string {
  return [
    r.format && `Format: ${r.format}`,
    r.learn && `Learn: ${r.learn}`,
    r.adapt && `Jay Society version: ${r.adapt}`,
    r.caution && `Caution: ${r.caution}`,
  ].filter(Boolean).join("\n");
}

/** Adds new names as CANDIDATES only (never confirmed here), and attaches research notes to everyone. */
export async function applyResearchList(): Promise<string> {
  const twitchUser = await accessToken("twitch").catch(() => null);
  let added = 0, updated = 0, looked = 0;
  for (const r of research as ResearchRow[]) {
    const [existing] = await db.select().from(schema.creators).where(eq(schema.creators.name, r.name));
    const notes = researchNotes(r);
    const tags = [r.cohort];
    let cid: string;
    if (existing) {
      await db.update(schema.creators).set({ notes, tags }).where(eq(schema.creators.id, existing.id));
      cid = existing.id; updated++;
      continue; // core creators already have confirmed accounts
    }
    const [n] = await db.insert(schema.creators).values({
      name: r.name, slug: r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), priority: r.priority, notes, tags,
      disambiguation: r.caution ?? null,
    }).onConflictDoNothing().returning();
    if (!n) continue;
    cid = n.id; added++;
    if (!r.url) { out(`${r.name} (${r.cohort}, P${r.priority}): added, no handle yet`); continue; }
    const platform = /twitch\.tv/.test(r.url) ? "twitch" : /kick\.com/.test(r.url) ? "kick" : "web";
    const handle = r.url.replace(/\/+$/, "").split("/").pop()!;
    const [acc] = await db.insert(schema.creatorAccounts).values({ creatorId: cid, platform, handle, url: r.url }).onConflictDoNothing().returning();
    if (!acc || platform !== "twitch") { out(`${r.name}: added ${platform} ${handle} as a reference link`); continue; }
    try {
      const u = await tw.resolveUser(handle);
      if (!u) { await db.update(schema.creatorAccounts).set({ resolveError: `No Twitch user "${handle}"` }).where(eq(schema.creatorAccounts.id, acc.id)); out(`${r.name}: twitch ${handle} NOT FOUND`); continue; }
      const followers = twitchUser ? await tw.followerTotal(u.id, twitchUser).catch(() => null) : null;
      await db.update(schema.creatorAccounts).set({ externalId: u.id, displayName: u.displayName, followerCount: followers, url: u.url }).where(eq(schema.creatorAccounts.id, acc.id));
      looked++;
      const est = parseEstimate(r.estimate);
      const m = countMatches(followers, est ?? undefined);
      out(`${r.name} (${r.cohort}, P${r.priority}): twitch "${u.displayName}" followers=${followers ?? "?"} vs prior estimate ${r.estimate ?? "none"} -> ${m === true ? "consistent" : m === false ? "DIFFERENT, check" : "no estimate"} (left unconfirmed)`);
    } catch (e) {
      out(`${r.name}: twitch ${handle} lookup error ${(e as Error).message.slice(0, 120)}`);
    }
  }
  const msg = `research list: ${added} candidates added, ${updated} core creators annotated, ${looked} Twitch lookups`;
  out(msg);
  return msg;
}
