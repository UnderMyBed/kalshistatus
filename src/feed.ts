import type { Env } from './types';

interface ChangelogRow {
  link: string;
  title: string;
  summary_ai: string;
  pub_date_ts: number;
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
  );
}

function rfc822(ts: number): string {
  return new Date(ts).toUTCString();
}

export async function handleFeed(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT link, title, summary_ai, pub_date_ts FROM changelog_summaries ORDER BY pub_date_ts DESC LIMIT 50',
  ).all<ChangelogRow>();

  const items = results
    .map(
      (r) => `<item>
      <title>${escapeXml(r.title)}</title>
      <link>${escapeXml(r.link)}</link>
      <guid isPermaLink="true">${escapeXml(r.link)}</guid>
      <description>${escapeXml(r.summary_ai)}</description>
      <pubDate>${rfc822(r.pub_date_ts)}</pubDate>
    </item>`,
    )
    .join('\n    ');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>kalshistatus.dev — Kalshi API changelog</title>
    <link>https://kalshistatus.dev</link>
    <atom:link href="https://kalshistatus.dev/feed.xml" rel="self" type="application/rss+xml"/>
    <description>AI-summarized changelog entries from the Kalshi API.</description>
    <language>en-us</language>
    <lastBuildDate>${rfc822(Date.now())}</lastBuildDate>
    ${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
}
