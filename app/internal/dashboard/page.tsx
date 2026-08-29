import type { CSSProperties } from 'react';
import { fetchEvents, isRange, type Range } from '@/lib/dashboard/blob-source';
import { computeFunnel, computeOutcomes, computeSessions, computeFeatureEngagement } from '@/lib/dashboard/aggregate';

// Reads live external data on every request -- must never be statically
// prerendered at build time, and there's nothing here worth caching given
// how little traffic this route gets.
export const dynamic = 'force-dynamic';

const RANGES: Range[] = ['24h', '7d', '30d'];
const RANGE_LABEL: Record<Range, string> = { '24h': '24h', '7d': '7d', '30d': '30d' };

function fmtPct(n: number | null): string {
  return n === null ? '—' : `${n.toFixed(1)}%`;
}

function fmtMs(n: number | null): string {
  if (n === null) return '—';
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

const th: CSSProperties = { textAlign: 'left', padding: '0.4rem 0.8rem 0.4rem 0', borderBottom: '1px solid #444' };
const td: CSSProperties = { padding: '0.3rem 0.8rem 0.3rem 0', borderBottom: '1px solid #2a2a2a' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const range: Range = isRange(params.range) ? params.range : '7d';

  const events = await fetchEvents(range);
  const funnel = computeFunnel(events);
  const outcomes = computeOutcomes(events);
  const sessions = computeSessions(events);
  const featureEngagement = computeFeatureEngagement(events);

  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#111',
        color: '#e8e8e8',
        minHeight: '100vh',
        padding: '2rem',
      }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Lullwood — Internal Analytics</h1>
        <p style={{ color: '#999', marginTop: 0 }}>
          {fmtNum(events.length)} event{events.length === 1 ? '' : 's'} in range.
        </p>

        <nav style={{ marginBottom: '2rem' }}>
          {RANGES.map((r) => (
            <a
              key={r}
              href={`/internal/dashboard?range=${r}`}
              style={{
                marginRight: '1rem',
                color: r === range ? '#fff' : '#8ab4f8',
                fontWeight: r === range ? 700 : 400,
                textDecoration: r === range ? 'underline' : 'none',
              }}
            >
              {RANGE_LABEL[r]}
            </a>
          ))}
        </nav>

        <section style={{ marginBottom: '2.5rem' }}>
          <h2>Funnel</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>Step</th>
                <th style={th}>Count</th>
                <th style={th}>% of page_view</th>
                <th style={th}>% of previous step</th>
              </tr>
            </thead>
            <tbody>
              {funnel.map((step) => (
                <tr key={step.event}>
                  <td style={td}>{step.event}</td>
                  <td style={td}>{fmtNum(step.count)}</td>
                  <td style={td}>{fmtPct(step.pctOfFirst)}</td>
                  <td style={td}>{step.pctOfPrev === null ? '—' : fmtPct(step.pctOfPrev)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section style={{ marginBottom: '2.5rem' }}>
          <h2>Outcomes</h2>
          <p>
            Win rate: <strong>{fmtPct(outcomes.winRatePct)}</strong> ({fmtNum(outcomes.winCount)} wins /{' '}
            {fmtNum(outcomes.lossCount)} losses)
          </p>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '1rem' }}>
            <thead>
              <tr>
                <th style={th}>Predator</th>
                <th style={th}>Losses</th>
                <th style={th}>% of losses</th>
              </tr>
            </thead>
            <tbody>
              {(Object.entries(outcomes.lossByPredator) as [string, number][]).map(([kind, count]) => (
                <tr key={kind}>
                  <td style={td}>{kind}</td>
                  <td style={td}>{fmtNum(count)}</td>
                  <td style={td}>{fmtPct(outcomes.lossCount === 0 ? null : (count / outcomes.lossCount) * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>Time survived</th>
                <th style={th}>n</th>
                <th style={th}>P50</th>
                <th style={th}>P90</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={td}>Win</td>
                <td style={td}>{fmtNum(outcomes.timeSurvivedMs.win.n)}</td>
                <td style={td}>{fmtMs(outcomes.timeSurvivedMs.win.p50)}</td>
                <td style={td}>{fmtMs(outcomes.timeSurvivedMs.win.p90)}</td>
              </tr>
              <tr>
                <td style={td}>Loss</td>
                <td style={td}>{fmtNum(outcomes.timeSurvivedMs.loss.n)}</td>
                <td style={td}>{fmtMs(outcomes.timeSurvivedMs.loss.p50)}</td>
                <td style={td}>{fmtMs(outcomes.timeSurvivedMs.loss.p90)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section style={{ marginBottom: '2.5rem' }}>
          <h2>Sessions</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              <tr>
                <td style={td}>Sessions</td>
                <td style={td}>{fmtNum(sessions.sessionCount)}</td>
              </tr>
              <tr>
                <td style={td}>Reached gameplay</td>
                <td style={td}>{fmtPct(sessions.reachedGameplayRatePct)}</td>
              </tr>
              <tr>
                <td style={td}>Session length P50 / P90</td>
                <td style={td}>
                  {fmtMs(sessions.durationMs.p50)} / {fmtMs(sessions.durationMs.p90)}
                </td>
              </tr>
              <tr>
                <td style={td}>D1 return</td>
                <td style={td}>{fmtPct(sessions.d1ReturnPct)}</td>
              </tr>
              <tr>
                <td style={td}>D7 return</td>
                <td style={td}>{fmtPct(sessions.d7ReturnPct)}</td>
              </tr>
            </tbody>
          </table>
          <p style={{ color: '#777', fontSize: '0.85rem' }}>
            D1/D7 return is computed only from anon_id sightings inside the selected range, so it undercounts near the
            edges of the window (a sighting from before the window starts is invisible to it).
          </p>
        </section>

        <section>
          <h2>Feature engagement</h2>
          {featureEngagement.length === 0 ? (
            <p style={{ color: '#999' }}>No feature_engagement events in range.</p>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Feature</th>
                  <th style={th}>Action</th>
                  <th style={th}>Count</th>
                </tr>
              </thead>
              <tbody>
                {featureEngagement.map((row) => (
                  <tr key={`${row.feature}:${row.action}`}>
                    <td style={td}>{row.feature}</td>
                    <td style={td}>{row.action}</td>
                    <td style={td}>{fmtNum(row.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
