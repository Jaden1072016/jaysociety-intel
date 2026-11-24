"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { IDEA_STATUSES } from "@/db/schema";
import { attemptLogin, clearSessionCookie, clientIp, requireAuth, setSessionCookie } from "@/lib/auth";
import { getSetting, setSetting, type AudienceProfile } from "@/lib/settings";
import { runNow, type JobName } from "@/jobs";
import { resolveAccount } from "@/ingest/creators";
import { importManual, MANUAL_SOURCES, type ManualSource } from "@/ingest/manual";
import { notify } from "@/notify/push";
import { disconnect, type OAuthProvider } from "@/providers/oauth";
import { normalizeKey } from "@/analysis/normalize";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const back = (path: string, msg: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);

// ---------- auth ----------
export async function login(_: unknown, f: FormData): Promise<{ error?: string }> {
  const r = await attemptLogin(await clientIp(), str(f, "password"));
  if (!r.ok) return { error: r.error };
  await setSessionCookie(r.token);
  redirect("/");
}

export async function logout() {
  await clearSessionCookie();
  redirect("/login");
}

// ---------- refresh ----------
const JOBS: JobName[] = ["trends", "creators", "own", "opportunities", "briefing"];
export async function refreshJob(f: FormData) {
  await requireAuth();
  const job = str(f, "job") as JobName;
  if (!JOBS.includes(job)) back("/", "Unknown job");
  const r = await runNow(job);
  revalidatePath("/", "layout");
  back(str(f, "returnTo") || "/", r === "ok" ? `Refreshed ${job}` : `Refresh ${job} had errors. See Settings > Logs.`);
}

// ---------- opportunities & trends ----------
export async function saveOpportunity(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  const [o] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, id));
  if (!o) back("/", "Not found");
  if (o.ideaId) back(`/ideas/${o.ideaId}`, "Already in your library");
  const [idea] = await db.insert(schema.ideas).values({
    title: o.title, hook: o.hook, platforms: o.platforms, opportunityId: o.id,
    notes: [o.concept, o.livestream ? `Livestream: ${o.livestream}` : "", o.clips.length ? `Clips: ${o.clips.join("; ")}` : "", o.production ? `Production: ${o.production}` : ""].filter(Boolean).join("\n\n"),
    sourceLinks: o.evidence.map((e) => e.url).filter((u): u is string => Boolean(u)),
  }).returning();
  await db.update(schema.opportunities).set({ status: "saved", ideaId: idea.id }).where(eq(schema.opportunities.id, id));
  revalidatePath("/");
  back(`/ideas/${idea.id}`, "Saved to your idea library");
}

export async function dismissOpportunity(f: FormData) {
  await requireAuth();
  await db.update(schema.opportunities).set({ status: "dismissed" }).where(eq(schema.opportunities.id, str(f, "id")));
  revalidatePath("/");
}

export async function dismissTrend(f: FormData) {
  await requireAuth();
  await db.update(schema.trends).set({ dismissed: true }).where(eq(schema.trends.id, str(f, "id")));
  revalidatePath("/trends");
}

// ---------- creators ----------
const PLATFORMS = ["youtube", "twitch", "tiktok", "instagram", "x", "kick"];

export async function addCreator(f: FormData) {
  await requireAuth();
  const name = str(f, "name");
  if (!name) back("/creators", "Name is required");
  const slug = normalizeKey(name).replace(/\s+/g, "-") || `creator-${Date.now()}`;
  const [c] = await db.insert(schema.creators).values({
    name, slug, priority: Number(str(f, "priority") || 2), disambiguation: str(f, "disambiguation") || null, notes: str(f, "notes") || null,
  }).onConflictDoNothing().returning();
  if (!c) back("/creators", "A creator with that name already exists");
  revalidatePath("/creators");
  back(`/creators/${c.id}`, "Creator added. Add their accounts next.");
}

export async function updateCreator(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  await db.update(schema.creators).set({
    name: str(f, "name"), priority: Number(str(f, "priority") || 2), disambiguation: str(f, "disambiguation") || null,
    notes: str(f, "notes") || null, active: f.get("active") === "on",
  }).where(eq(schema.creators.id, id));
  revalidatePath(`/creators/${id}`);
  back(`/creators/${id}`, "Saved");
}

export async function deleteCreator(f: FormData) {
  await requireAuth();
  await db.delete(schema.creators).where(and(eq(schema.creators.id, str(f, "id")), eq(schema.creators.isSelf, false)));
  revalidatePath("/creators");
  back("/creators", "Creator removed");
}

export async function addAccount(f: FormData) {
  await requireAuth();
  const creatorId = str(f, "creatorId"), platform = str(f, "platform"), handle = str(f, "handle");
  if (!PLATFORMS.includes(platform) || !handle) back(`/creators/${creatorId}`, "Pick a platform and enter a handle or URL");
  const url = /^https?:\/\//.test(handle) ? handle : null;
  const [a] = await db.insert(schema.creatorAccounts).values({ creatorId, platform, handle, url }).onConflictDoNothing().returning();
  if (!a) back(`/creators/${creatorId}`, "That account is already tracked");
  if (platform === "youtube" || platform === "twitch") await resolveAccount(a.id);
  revalidatePath(`/creators/${creatorId}`);
  back(`/creators/${creatorId}`, platform === "youtube" || platform === "twitch" ? "Looked it up. Confirm it's the right person." : "Saved (manual platform)");
}

export async function resolveAccountAction(f: FormData) {
  await requireAuth();
  await resolveAccount(str(f, "id"));
  revalidatePath(`/creators/${str(f, "creatorId")}`);
  back(`/creators/${str(f, "creatorId")}`, "Looked up again");
}

export async function setVerified(f: FormData) {
  await requireAuth();
  const v = str(f, "verified") === "1";
  await db.update(schema.creatorAccounts).set({ verified: v, verifiedAt: v ? new Date() : null }).where(eq(schema.creatorAccounts.id, str(f, "id")));
  revalidatePath(`/creators/${str(f, "creatorId")}`);
  back(`/creators/${str(f, "creatorId")}`, v ? "Confirmed. It will be included in the next refresh." : "Marked unconfirmed. It won't be refreshed.");
}

export async function removeAccount(f: FormData) {
  await requireAuth();
  await db.delete(schema.creatorAccounts).where(eq(schema.creatorAccounts.id, str(f, "id")));
  revalidatePath(`/creators/${str(f, "creatorId")}`);
  back(`/creators/${str(f, "creatorId")}`, "Account removed");
}

// ---------- ideas ----------
const IdeaForm = z.object({
  title: z.string().min(1).max(200),
  status: z.enum(IDEA_STATUSES),
  format: z.string().max(80),
  platforms: z.array(z.string()),
  notes: z.string().max(10000),
  script: z.string().max(20000),
  hook: z.string().max(500),
  sourceLinks: z.array(z.string().url()),
  publishedUrl: z.string().max(500),
  experimentId: z.string(),
  experimentArm: z.string(),
});

function numOrUndef(s: string) {
  if (!s) return undefined;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export async function saveIdea(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  const parsed = IdeaForm.safeParse({
    title: str(f, "title"), status: str(f, "status") || "Researching", format: str(f, "format"),
    platforms: f.getAll("platforms").map(String), notes: str(f, "notes"), script: str(f, "script"), hook: str(f, "hook"),
    sourceLinks: list(str(f, "sourceLinks")).filter((u) => /^https?:\/\//.test(u)), publishedUrl: str(f, "publishedUrl"),
    experimentId: str(f, "experimentId"), experimentArm: str(f, "experimentArm"),
  });
  if (!parsed.success) back(id ? `/ideas/${id}` : "/ideas", `Couldn't save: ${parsed.error.issues[0]?.message}`);
  const d = parsed.data!;
  const results = {
    views: numOrUndef(str(f, "r_views")), likes: numOrUndef(str(f, "r_likes")), comments: numOrUndef(str(f, "r_comments")),
    follows: numOrUndef(str(f, "r_follows")), avgWatchSec: numOrUndef(str(f, "r_avgWatchSec")), notes: str(f, "r_notes") || undefined, source: "manual" as const,
  };
  const hasResults = Object.entries(results).some(([k, v]) => k !== "source" && v != null);
  const values = {
    title: d.title, status: d.status, format: d.format || null, platforms: d.platforms, notes: d.notes || null, script: d.script || null,
    hook: d.hook || null, sourceLinks: d.sourceLinks, publishedUrl: d.publishedUrl || null,
    experimentId: d.experimentId || null, experimentArm: d.experimentId ? d.experimentArm || null : null,
    results: hasResults ? results : null, updatedAt: new Date(),
    ...(d.status === "Published" ? { publishedAt: new Date() } : {}),
  };
  if (id) {
    const [prev] = await db.select({ publishedAt: schema.ideas.publishedAt }).from(schema.ideas).where(eq(schema.ideas.id, id));
    await db.update(schema.ideas).set({ ...values, publishedAt: prev?.publishedAt ?? values.publishedAt ?? null }).where(eq(schema.ideas.id, id));
    revalidatePath("/ideas");
    back(`/ideas/${id}`, "Saved");
  }
  const [n] = await db.insert(schema.ideas).values(values).returning();
  revalidatePath("/ideas");
  back(`/ideas/${n.id}`, "Idea created");
}

export async function setIdeaStatus(f: FormData) {
  await requireAuth();
  const status = str(f, "status");
  if (!(IDEA_STATUSES as readonly string[]).includes(status)) return;
  await db.update(schema.ideas).set({ status, updatedAt: new Date(), ...(status === "Published" ? { publishedAt: new Date() } : {}) }).where(eq(schema.ideas.id, str(f, "id")));
  revalidatePath("/ideas");
}

export async function deleteIdea(f: FormData) {
  await requireAuth();
  await db.delete(schema.ideas).where(eq(schema.ideas.id, str(f, "id")));
  revalidatePath("/ideas");
  back("/ideas", "Idea deleted");
}

// ---------- experiments ----------
export async function createExperiment(f: FormData) {
  await requireAuth();
  const variable = str(f, "variable");
  if (!["posting_window", "format"].includes(variable) || !str(f, "armA") || !str(f, "armB")) back("/review", "Fill in both options");
  await db.insert(schema.experiments).values({ name: str(f, "name") || `${str(f, "armA")} vs ${str(f, "armB")}`, variable, armA: str(f, "armA"), armB: str(f, "armB"), hypothesis: str(f, "hypothesis") || null });
  revalidatePath("/review");
  back("/review", "Experiment started. Tag ideas with arm A or B on the idea page.");
}

export async function endExperiment(f: FormData) {
  await requireAuth();
  await db.update(schema.experiments).set({ status: "done", endedAt: new Date() }).where(eq(schema.experiments.id, str(f, "id")));
  revalidatePath("/review");
}

// ---------- import ----------
export async function importAction(f: FormData) {
  await requireAuth();
  const source = str(f, "source") as ManualSource;
  if (!(source in MANUAL_SOURCES)) back("/settings#import", "Pick a source");
  const r = await importManual(source, str(f, "text"));
  revalidatePath("/trends");
  back("/trends", `Imported ${r.lines} lines: ${r.trends} trends, ${r.videos} videos.${r.notes.length ? " " + r.notes.join(" ") : ""}`);
}

// ---------- settings ----------
export async function saveProfile(f: FormData) {
  await requireAuth();
  const topics: AudienceProfile["topics"] = {};
  for (const line of str(f, "topics").split("\n")) {
    const [k, v] = line.split(":");
    if (k?.trim() && v) topics[normalizeKey(k).replace(/\s+/g, "_")] = list(v.toLowerCase());
  }
  await setSetting("audience_profile", {
    summary: str(f, "summary"), topics, musicArtists: list(str(f, "musicArtists").toLowerCase()), exclude: list(str(f, "exclude").toLowerCase()),
  });
  back("/settings", "Audience profile saved. Relevance updates on the next refresh.");
}

export async function saveNotifications(f: FormData) {
  await requireAuth();
  const hhmm = /^\d{1,2}:\d{2}$/;
  const qs = str(f, "quietStart"), qe = str(f, "quietEnd");
  if (!hhmm.test(qs) || !hhmm.test(qe)) back("/settings", "Quiet hours must look like 23:00");
  await setSetting("notifications", {
    categories: { opportunity: f.get("cat_opportunity") === "on", briefing: f.get("cat_briefing") === "on", system: f.get("cat_system") === "on" },
    quietStart: qs, quietEnd: qe,
    opportunityThreshold: Math.max(0, Math.min(100, Number(str(f, "threshold")) || 72)),
    maxOpportunityPushesPerDay: Math.max(0, Math.min(10, Number(str(f, "maxPushes")) || 3)),
  });
  back("/settings", "Notification settings saved");
}

export async function saveAi(f: FormData) {
  await requireAuth();
  const cur = await getSetting("ai");
  await setSetting("ai", {
    enabled: f.get("enabled") === "on", model: str(f, "model") || cur.model,
    monthlyCapUsd: Math.max(0, Number(str(f, "cap")) || 0), maxIdeasPerRun: Math.max(1, Math.min(12, Number(str(f, "maxIdeas")) || 6)),
  });
  back("/settings", "AI settings saved");
}

export async function saveBudgets(f: FormData) {
  await requireAuth();
  await setSetting("budgets", {
    youtubeDailyUnits: Math.max(100, Math.min(9500, Number(str(f, "yt")) || 3000)),
    twitchDailyRequests: Math.max(50, Number(str(f, "tw")) || 2000),
    trendsRefreshMinutes: Math.max(10, Number(str(f, "trendsMin")) || 30),
    creatorRefreshHours: Math.max(1, Math.min(24, Number(str(f, "creatorHours")) || 6)),
  });
  back("/settings", "Budgets saved");
}

export async function testPush() {
  await requireAuth();
  const r = await notify("test", { title: "Jay Society Intel", body: "Test notification. Push is working.", url: "/settings" });
  back("/settings", r.sent ? `Test sent to ${r.sent} device(s)` : `Not sent: ${r.reason}`);
}

export async function disconnectOAuth(f: FormData) {
  await requireAuth();
  const p = str(f, "provider") as OAuthProvider;
  if (p === "google" || p === "twitch") await disconnect(p);
  back("/settings", `Disconnected ${p}`);
}
