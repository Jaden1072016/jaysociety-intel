import webpush from "web-push";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSetting, type NotificationSettings } from "@/lib/settings";
import { etMinutes, inQuietHours, parseHHMM } from "@/lib/time";
import { log, recordFailure, recordSuccess } from "@/lib/ops";

export type Category = "opportunity" | "briefing" | "test" | "system";
export type PushPayload = { title: string; body: string; url?: string };

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let configured = false;
function setup() {
  if (configured || !pushConfigured()) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:owner@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

/** Decide whether to send. Test pushes ignore quiet hours so you can check setup any time. */
export function shouldSend(category: Category, s: NotificationSettings, now = new Date()): { send: boolean; reason?: string } {
  if (category === "test") return { send: true };
  if (category !== "system" && !s.categories[category]) return { send: false, reason: `${category} notifications are off` };
  if (category === "system" && !s.categories.system) return { send: false, reason: "system notifications are off" };
  if (inQuietHours(etMinutes(now), parseHHMM(s.quietStart), parseHHMM(s.quietEnd))) return { send: false, reason: "quiet hours" };
  return { send: true };
}

export type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;

export async function notify(category: Category, payload: PushPayload, opts: { now?: Date; sender?: Sender } = {}) {
  const s = await getSetting("notifications");
  const decision = shouldSend(category, s, opts.now);
  const [rec] = await db.insert(schema.notifications).values({
    category, title: payload.title, body: payload.body, url: payload.url ?? null, sent: false, reason: decision.reason ?? null,
  }).returning({ id: schema.notifications.id });
  if (!decision.send) return { sent: 0, reason: decision.reason };
  if (!opts.sender && !pushConfigured()) {
    await db.update(schema.notifications).set({ reason: "push not configured (VAPID keys missing)" }).where(eq(schema.notifications.id, rec.id));
    return { sent: 0, reason: "push not configured" };
  }
  setup();
  const send: Sender = opts.sender ?? ((sub, p) => webpush.sendNotification(sub, p, { TTL: 3600 }));
  const subs = await db.select().from(schema.pushSubscriptions);
  let sent = 0;
  for (const sub of subs) {
    try {
      await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id)); // expired device
        await log("web_push", "info", "Removed expired push subscription");
      } else {
        await recordFailure("web_push", e);
      }
    }
  }
  await db.update(schema.notifications).set({ sent: sent > 0, reason: sent ? null : subs.length ? "all deliveries failed" : "no devices subscribed" })
    .where(eq(schema.notifications.id, rec.id));
  if (sent) await recordSuccess("web_push");
  return { sent, reason: sent ? undefined : subs.length ? "delivery failed" : "no devices subscribed" };
}

export async function opportunityPushesToday(dayStart: Date): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.notifications)
    .where(and(eq(schema.notifications.category, "opportunity"), eq(schema.notifications.sent, true), gte(schema.notifications.createdAt, dayStart)));
  return r?.n ?? 0;
}
