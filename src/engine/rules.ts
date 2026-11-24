import type { Candidate } from "./candidates";

export type GeneratedIdea = {
  topicKey: string;
  title: string;
  hook: string;
  concept: string;
  livestream: string;
  clips: string[];
  platforms: string[];
  production: string;
  whyFits: string;
  aiNotes: string;
  feasibility: number;
  originality: number;
  collaboration: number;
};

type Angle = "gaming" | "music" | "streaming" | "culture" | "format" | "general";

function angleOf(c: Candidate): Angle {
  if (c.kind === "format_pattern") return "format";
  const m = new Set(c.matched);
  const has = (...w: string[]) => w.some((x) => [...m].some((y) => y.includes(x)));
  if (has("gta", "fortnite", "2k", "madden", "call of duty", "warzone", "minecraft", "roblox", "game", "playstation", "xbox", "nintendo", "rockstar", "valorant")) return "gaming";
  if (has("album", "song", "single", "tour", "rap", "hip hop", "r&b", "rnb", "drake", "cole", "partynextdoor", "bryson", "jhen", "future", "nino", "h.e.r", "sza", "freestyle", "diss", "music")) return "music";
  if (c.kind === "creator_outlier" || has("twitch", "kick", "stream", "subathon", "kai cenat", "duke", "fanum", "lacy", "plaqueboymax", "stable", "ddg", "raud", "amp")) return "streaming";
  if (has("nba", "nfl", "sneaker", "jordan", "nike", "dating", "meme", "funny")) return "culture";
  return "general";
}

const PLATFORMS: Record<Angle, string[]> = {
  gaming: ["Twitch", "YouTube", "TikTok"],
  music: ["TikTok", "Instagram Reels", "YouTube Shorts", "Twitch"],
  streaming: ["TikTok", "YouTube Shorts", "X"],
  culture: ["TikTok", "Instagram Reels", "X"],
  format: ["Twitch", "YouTube", "TikTok"],
  general: ["TikTok", "X"],
};

/**
 * Deterministic templates. No facts are invented: every specific noun comes from the candidate's
 * topic or evidence. Used when Claude is off, unconfigured, over budget, or fails.
 */
export function rulesIdea(c: Candidate): GeneratedIdea {
  const t = c.topic.replace(/\s+/g, " ").trim();
  const angle = angleOf(c);
  const who = c.creators.length ? c.creators.join(", ") : null;
  const base = {
    topicKey: c.topicKey,
    platforms: PLATFORMS[angle],
    aiNotes: "Template-generated (no AI). Wording is a starting point; facts come only from the linked evidence.",
    whyFits: whyFits(c),
  };
  switch (angle) {
    case "gaming":
      return { ...base,
        title: `Jay Society plays/reacts: ${t}`,
        hook: `Everybody's talking about ${t}. Here's my honest take in 30 seconds.`,
        concept: `Quick reaction short on ${t}, then a stream segment where you actually play or break it down with chat.`,
        livestream: `Open with the news/clip (10 min), play or theorycraft with chat (60 min), chat predictions poll, end with your ranking.`,
        clips: ["First reaction moment", "Hot take / prediction", "Funniest chat interaction"],
        production: "OBS stream + 1 vertical short cut from the VOD. Low cost.",
        feasibility: 8, originality: 5, collaboration: 5 };
    case "music":
      return { ...base,
        title: `First listen + ranking: ${t}`,
        hook: `I ranked ${t} so you don't have to. Number one surprised me.`,
        concept: `Listen-through or reaction on ${t} with a tier list at the end. Tie it back to the R&B/hip-hop artists your audience already rides with.`,
        livestream: `Listening segment (no full-song playback on stream, use reaction-friendly clips), chat votes per track, final tier list.`,
        clips: ["Instant reaction to the best moment", "Tier list reveal", "Chat vs Jay disagreement"],
        production: "Phone or desk cam. Mind music copyright: react over short segments, don't replay full tracks.",
        feasibility: 8, originality: 6, collaboration: 6 };
    case "streaming":
      return { ...base,
        title: `My take on ${t}${who ? ` (${who})` : ""}`,
        hook: `${who ?? "This"} just did ${t} and it's working. Here's how I'd do it at my level.`,
        concept: `Don't copy the video. Take the format that's working${who ? ` for ${who}` : ""} and run your own version with your friends and your community.`,
        livestream: `Watch-party a short portion with commentary (short segments only), then do your own version live with chat participation.`,
        clips: ["Your version's best moment", "Side-by-side reaction", "Chat's best suggestion"],
        production: "Needs 1-2 friends on stream for the full version. Can start solo.",
        feasibility: 7, originality: 5, collaboration: 8 };
    case "culture":
      return { ...base,
        title: `${t}: hot take`,
        hook: `Let's talk about ${t}. Am I wrong?`,
        concept: `Short opinion piece on ${t} with a question to your audience to drive comments, then pull the best replies into the next stream.`,
        livestream: `10-minute segment: read chat's takes, debate with a friend on call.`,
        clips: ["The take itself", "Best comment reaction"],
        production: "Phone, one take, captions.",
        feasibility: 9, originality: 5, collaboration: 5 };
    case "format":
      return { ...base,
        title: `Run the ${t.replace(/ format$/, "")} play with your own spin`,
        hook: `Trying the format the big streamers keep winning with. Day 1.`,
        concept: `${who ?? "Watched creators"} are getting above-usual results with this format. Run it as a repeatable Jay Society series using your topics, friends and community.`,
        livestream: `Make it a recurring segment with the same name each week so clips are recognizable.`,
        clips: ["Opening setup", "Peak moment", "Result/reveal"],
        production: "Depends on the format; start with the lowest-cost version.",
        feasibility: 7, originality: 6, collaboration: 7 };
    default:
      return { ...base,
        title: `What I think about ${t}`,
        hook: `${t} is everywhere today. Quick take.`,
        concept: `Short reaction to ${t} only if you have a real angle on it. Skip if it doesn't fit the brand.`,
        livestream: `Optional 5-minute chat segment.`,
        clips: ["The take"],
        production: "Phone, captions.",
        feasibility: 9, originality: 4, collaboration: 3 };
  }
}

export function whyFits(c: Candidate): string {
  const parts: string[] = [];
  if (c.matched.length) parts.push(`Matches your audience profile on: ${c.matched.slice(0, 5).join(", ")}`);
  if (c.creators.length) parts.push(`Already working for creators you watch (${c.creators.join(", ")})`);
  if (c.signals.kinds >= 2) parts.push(`Shows up in ${c.signals.kinds} independent sources`);
  if (c.saturation >= 3) parts.push(`Crowded: ${c.saturation} watched creators already covered it, so you need a distinct angle`);
  return parts.join(". ") + (parts.length ? "." : "Weak fit; included for awareness.");
}
