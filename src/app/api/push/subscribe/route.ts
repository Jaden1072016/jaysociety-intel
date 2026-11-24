import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { isAuthed } from "@/lib/auth";

const Sub = z.object({ endpoint: z.string().url().startsWith("https://"), keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(4) }) });

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Sub.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  await db.insert(schema.pushSubscriptions).values({ endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { endpoint?: string } | null;
  if (body?.endpoint) await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, body.endpoint));
  return NextResponse.json({ ok: true });
}
