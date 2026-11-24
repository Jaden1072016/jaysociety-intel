import { vi } from "vitest";

// Test database: TEST_DATABASE_URL, else the local default. Never point this at production.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://jay:jay@localhost:5432/jayintel_test";
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123";
process.env.APP_PASSWORD = "correct horse battery staple";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.YOUTUBE_API_KEY;
delete process.env.TWITCH_CLIENT_ID;
delete process.env.VAPID_PUBLIC_KEY;

// next/headers isn't available outside a request; tests use attemptLogin() directly.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Map() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect:${u}`); } }));
