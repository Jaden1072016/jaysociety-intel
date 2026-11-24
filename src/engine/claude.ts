import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addCost, log, recordFailure, recordSuccess } from "@/lib/ops";
import { etDate } from "@/lib/time";
import type { AiSettings, AudienceProfile } from "@/lib/settings";
import type { Candidate } from "./candidates";
import type { GeneratedIdea } from "./rules";

/** USD per million tokens (input, output). Haiku 5.5 rates apply to prompts under 100K tokens; ours are far smaller. */
export const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-4-6": [3, 15],
};

export function costOf(model: string, inTok: number, outTok: number): number {
  const [i, o] = PRICES[model] ?? [2, 10]; // unknown model: assume Sonnet-class so the cap stays conservative
  return (inTok * i + outTok * o) / 1_000_000;
}

const IdeaSchema = z.object({
  topicKey: z.string(),
  title: z.string().min(3).max(140),
  hook: z.string().min(3).max(240),
  concept: z.string().min(10).max(900),
  livestream: z.string().max(700),
  clips: z.array(z.string().max(160)).max(6),
  platforms: z.array(z.string().max(30)).max(6),
  production: z.string().max(400),
  whyFits: z.string().max(500),
  aiNotes: z.string().max(500),
  feasibility: z.number().min(0).max(10),
  originality: z.number().min(0).max(10),
  collaboration: z.number().min(0).max(10),
});
const ResponseSchema = z.object({ ideas: z.array(IdeaSchema) });

export function buildPrompt(cands: Candidate[], profile: AudienceProfile) {
  const system = [
    "You are the content strategist for Jay Society, a smaller, personality-driven creator (gaming, streaming culture, reactions, hip-hop/R&B, humor, lifestyle) on TikTok, Twitch, YouTube, Instagram and X.",
    `Ideal viewer: ${profile.summary}`,
    `Music influences: ${profile.musicArtists.slice(0, 10).join(", ")}.`,
    "Rules:",
    "- Use ONLY facts present in the evidence. Do not invent numbers, quotes, dates, events or claims about real people.",
    "- Anything you infer or assume goes in aiNotes, not in concept or whyFits.",
    "- Ideas must be original takes for Jay Society, not copies of another creator's video.",
    "- Be realistic for a smaller creator: low budget, friends on stream, no celebrity access assumed.",
    "- Never imply a posting time or score guarantees views.",
    "- Plain, human wording. No em dashes. No hashtags like #fyp or #viral.",
    "- feasibility/originality/collaboration are 0-10 judgments for a smaller creator.",
    "Return JSON only: {\"ideas\":[{topicKey,title,hook,concept,livestream,clips[],platforms[],production,whyFits,aiNotes,feasibility,originality,collaboration}]} with one idea per candidate, same topicKey.",
  ].join("\n");
  const user = JSON.stringify(cands.map((c) => ({
    topicKey: c.topicKey, topic: c.topic, kind: c.kind, matchedAudienceKeywords: c.matched.slice(0, 8),
    watchedCreatorsInvolved: c.creators, formats: c.formats, crowdedness: c.saturation,
    evidence: c.evidence.slice(0, 6).map((e) => e.label),
  })));
  return { system, user };
}

export function parseIdeas(text: string): GeneratedIdea[] {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object in model output");
  const parsed = ResponseSchema.parse(JSON.parse(text.slice(start, end + 1)));
  return parsed.ideas.map((i) => ({ ...i, title: dash(i.title), hook: dash(i.hook), concept: dash(i.concept), livestream: dash(i.livestream), whyFits: dash(i.whyFits) }));
}

const dash = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

export type ClaudeClient = { messages: { create: (p: any) => Promise<any> } };

const MAX_OUTPUT_TOKENS = 4000;
const CAP_LOCK = 724_310_992;

/**
 * Atomically check the month's spend and reserve a worst-case cost for this call.
 * Worst case = every character a token (input can't exceed that) + max_tokens output,
 * so actual cost can never be higher than the reservation and the cap is a hard ceiling.
 * Serialized with an advisory lock so the worker and a manual refresh can't both slip under.
 */
export async function reserveSpend(month: string, day: string, worstCase: number, capUsd: number): Promise<{ ok: boolean; spent: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CAP_LOCK})`);
    const [r] = await tx.select({ c: sql<number>`coalesce(sum(${schema.apiUsage.costUsd}),0)::float` }).from(schema.apiUsage)
      .where(and(eq(schema.apiUsage.provider, "claude"), sql`${schema.apiUsage.day} like ${month + "%"}`));
    const spent = r?.c ?? 0;
    if (spent + worstCase > capUsd) return { ok: false, spent };
    await tx.insert(schema.apiUsage).values({ provider: "claude", day, costUsd: worstCase, requests: 1 })
      .onConflictDoUpdate({
        target: [schema.apiUsage.provider, schema.apiUsage.day],
        set: { costUsd: sql`${schema.apiUsage.costUsd} + ${worstCase}`, requests: sql`${schema.apiUsage.requests} + 1` },
      });
    return { ok: true, spent };
  });
}

/** Returns null (caller falls back to rules) when disabled, unconfigured, over the monthly cap, or on failure. */
export async function claudeIdeas(cands: Candidate[], profile: AudienceProfile, ai: AiSettings, client?: ClaudeClient): Promise<GeneratedIdea[] | null> {
  if (!ai.enabled || !cands.length) return null;
  if (!client && !process.env.ANTHROPIC_API_KEY) return null;
  const day = etDate();
  const month = day.slice(0, 7);
  const { system, user } = buildPrompt(cands, profile);
  const worstIn = system.length + user.length + 50; // a token is never shorter than one character
  if (worstIn > 90_000) { await log("claude", "warn", "Prompt too large; skipping AI to stay in the low-price tier."); return null; }
  const worstCase = costOf(ai.model, worstIn, MAX_OUTPUT_TOKENS);
  const res0 = await reserveSpend(month, day, worstCase, ai.monthlyCapUsd);
  if (!res0.ok) {
    await log("claude", "warn", `Monthly AI cap reached ($${res0.spent.toFixed(4)} of $${ai.monthlyCapUsd}). Using rules generator.`);
    return null;
  }
  let settled = false;
  try {
    const c = client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await c.messages.create({
      model: ai.model, max_tokens: MAX_OUTPUT_TOKENS, system,
      messages: [{ role: "user", content: `Candidates:\n${user}` }],
    });
    const inTok = res.usage?.input_tokens ?? worstIn, outTok = res.usage?.output_tokens ?? MAX_OUTPUT_TOKENS;
    // Settle the reservation down to the real cost (never up: real <= worst case).
    await addCost("claude", day, Math.min(0, costOf(ai.model, inTok, outTok) - worstCase), false);
    settled = true;
    const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const ideas = parseIdeas(text);
    await recordSuccess("claude", `${ideas.length} ideas, ${inTok}+${outTok} tokens`);
    return ideas;
  } catch (e) {
    // A request that errored before producing usage isn't billed; release the reservation.
    if (!settled) await addCost("claude", day, -worstCase, false).catch(() => {});
    await recordFailure("claude", e);
    return null;
  }
}
