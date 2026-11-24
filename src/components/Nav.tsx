"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const I = {
  today: <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />,
  trends: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  creators: <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.74" />,
  ideas: <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />,
  review: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />,
};

const LINKS: [string, string, keyof typeof I][] = [
  ["/", "Today", "today"], ["/trends", "Trends", "trends"], ["/creators", "Creators", "creators"],
  ["/ideas", "Ideas", "ideas"], ["/review", "Review", "review"], ["/settings", "Settings", "settings"],
];

export function Nav() {
  const path = usePathname();
  if (path?.startsWith("/login")) return null;
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map(([href, label, icon]) => {
        const on = href === "/" ? path === "/" : path?.startsWith(href);
        return (
          <Link key={href} href={href} className={on ? "on" : ""}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{I[icon]}</svg>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
