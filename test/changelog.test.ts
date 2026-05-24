import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { fetchAndSummarizeChangelog } from '../src/changelog';

const SCHEMA_SNAPSHOTS = `CREATE TABLE IF NOT EXISTS snapshots (ts INTEGER NOT NULL, environment TEXT NOT NULL CHECK (environment IN ('prod', 'demo')), payload TEXT NOT NULL, PRIMARY KEY (environment, ts))`;
const SCHEMA_CHANGELOG = `CREATE TABLE IF NOT EXISTS changelog_summaries (link TEXT PRIMARY KEY, pub_date_ts INTEGER NOT NULL, title TEXT NOT NULL, summary_ai TEXT NOT NULL, generated_at INTEGER NOT NULL)`;

function makeRssFeed(items: { link: string; title: string; pubDate: string; description: string }[]): string {
  const itemsXml = items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.pubDate}</pubDate><description>${i.description}</description></item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Kalshi API</title>${itemsXml}</channel></rss>`;
}

beforeEach(async () => {
  await env.DB.exec(SCHEMA_SNAPSHOTS);
  await env.DB.exec(SCHEMA_CHANGELOG);
  await env.DB.prepare('DELETE FROM changelog_summaries').run();
});

describe('fetchAndSummarizeChangelog', () => {
  it('stores a summary for a new changelog entry', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        makeRssFeed([
          {
            link: 'https://kalshi.com/changelog/1',
            title: 'New feature',
            pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT',
            description: 'We added a new feature to the API.',
          },
        ]),
        { headers: { 'Content-Type': 'application/rss+xml' } },
      ),
    );

    await fetchAndSummarizeChangelog(env, mockFetch);

    const row = await env.DB.prepare('SELECT * FROM changelog_summaries WHERE link = ?')
      .bind('https://kalshi.com/changelog/1')
      .first<{ link: string; title: string; summary_ai: string; pub_date_ts: number; generated_at: number }>();

    expect(row).not.toBeNull();
    expect(row!.title).toBe('New feature');
    expect(row!.summary_ai).toBeTruthy();
    expect(row!.pub_date_ts).toBeGreaterThan(0);
    expect(row!.generated_at).toBeGreaterThan(0);
  });

  it('does not re-summarize an existing entry', async () => {
    const existingLink = 'https://kalshi.com/changelog/1';
    await env.DB.prepare(
      'INSERT INTO changelog_summaries (link, pub_date_ts, title, summary_ai, generated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(existingLink, 1704067200000, 'Old feature', 'cached summary', Date.now())
      .run();

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        makeRssFeed([
          {
            link: existingLink,
            title: 'Old feature',
            pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT',
            description: 'An old feature.',
          },
        ]),
        { headers: { 'Content-Type': 'application/rss+xml' } },
      ),
    );

    const aiRunSpy = vi.spyOn(env.AI, 'run');
    await fetchAndSummarizeChangelog(env, mockFetch);
    expect(aiRunSpy).not.toHaveBeenCalled();
  });
});
