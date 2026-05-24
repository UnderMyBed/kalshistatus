import type { Env } from './types';

const KALSHI_RSS_URL = 'https://kalshi.com/blog/rss.xml';

interface RssItem {
  link: string;
  title: string;
  pubDateTs: number;
  description: string;
}

function stripCdata(s: string): string {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return m ? m[1] : s;
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const link = (/<link>(.*?)<\/link>/.exec(block) ?? [])[1]?.trim() ?? '';
    const title = stripCdata((/<title>(.*?)<\/title>/.exec(block) ?? [])[1]?.trim() ?? '');
    const pubDate = (/<pubDate>(.*?)<\/pubDate>/.exec(block) ?? [])[1]?.trim() ?? '';
    const description = stripCdata(
      (/<description>([\s\S]*?)<\/description>/.exec(block) ?? [])[1]?.trim() ?? '',
    );
    if (!link) continue;
    const ts = pubDate ? new Date(pubDate).getTime() : NaN;
    items.push({ link, title, pubDateTs: Number.isFinite(ts) ? ts : 0, description });
  }

  return items;
}

export async function fetchAndSummarizeChangelog(
  env: Env,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchFn(KALSHI_RSS_URL);
  if (!res.ok) return;

  const xml = await res.text();
  const items = parseRss(xml);

  for (const item of items) {
    const existing = await env.DB.prepare('SELECT link FROM changelog_summaries WHERE link = ?')
      .bind(item.link)
      .first<{ link: string }>();
    if (existing) continue;

    const aiRes = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'user',
          content: `Summarize this API changelog entry in one sentence:\n\nTitle: ${item.title}\n\n${item.description}`,
        },
      ],
    });

    const summary =
      typeof aiRes === 'object' && aiRes !== null && 'response' in aiRes
        ? String((aiRes as { response: unknown }).response)
        : null;

    if (!summary) continue;

    await env.DB.prepare(
      'INSERT INTO changelog_summaries (link, pub_date_ts, title, summary_ai, generated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(item.link, item.pubDateTs, item.title, summary, Date.now())
      .run();
  }
}
