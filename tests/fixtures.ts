export const TRENDS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
<channel>
<title>Daily Search Trends</title>
<item>
  <title>gta 6 trailer 3</title>
  <ht:approx_traffic>500K+</ht:approx_traffic>
  <description/>
  <link>https://trends.google.com/trending/rss?geo=US</link>
  <pubDate>Mon, 23 Nov 2026 09:10:00 -0800</pubDate>
  <ht:picture>https://example.com/p.jpg</ht:picture>
  <ht:picture_source>IGN</ht:picture_source>
  <ht:news_item>
    <ht:news_item_title>Rockstar drops GTA 6 trailer 3</ht:news_item_title>
    <ht:news_item_snippet/>
    <ht:news_item_url>https://example.com/gta6-trailer-3</ht:news_item_url>
    <ht:news_item_picture>https://example.com/n.jpg</ht:news_item_picture>
    <ht:news_item_source>IGN</ht:news_item_source>
  </ht:news_item>
  <ht:news_item>
    <ht:news_item_title>Everything in the new GTA VI trailer</ht:news_item_title>
    <ht:news_item_snippet/>
    <ht:news_item_url>https://example.com/gta-vi-breakdown</ht:news_item_url>
    <ht:news_item_source>Polygon</ht:news_item_source>
  </ht:news_item>
</item>
<item>
  <title>mortgage rates</title>
  <ht:approx_traffic>20K+</ht:approx_traffic>
  <pubDate>Mon, 23 Nov 2026 08:00:00 -0800</pubDate>
</item>
<item>
  <title>drake new album</title>
  <ht:approx_traffic>200K+</ht:approx_traffic>
  <pubDate>Mon, 23 Nov 2026 07:00:00 -0800</pubDate>
  <ht:news_item>
    <ht:news_item_title>Drake announces album</ht:news_item_title>
    <ht:news_item_url>https://example.com/drake</ht:news_item_url>
    <ht:news_item_source>Complex</ht:news_item_source>
  </ht:news_item>
</item>
<item>
  <title>GTA 6</title>
  <ht:approx_traffic>100K+</ht:approx_traffic>
  <pubDate>Mon, 23 Nov 2026 09:00:00 -0800</pubDate>
</item>
<item><title></title></item>
</channel>
</rss>`;

export function ytVideo(id: string, title: string, publishedAt: string, views: number, duration = "PT12M3S", extra: Record<string, unknown> = {}) {
  return {
    id,
    snippet: { title, description: "", publishedAt, channelId: "UCxxxxxxxxxxxxxxxxxxxxxx", thumbnails: { medium: { url: `https://i.ytimg.com/${id}.jpg` } } },
    contentDetails: { duration },
    statistics: { viewCount: String(views), likeCount: "10", commentCount: "2" },
    ...extra,
  };
}
