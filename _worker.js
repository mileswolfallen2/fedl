const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/stats') {
      return await handleStats(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleStats(request, env) {
  const url = new URL(request.url);
  const minutes = parseInt(url.searchParams.get('minutes') || '1440', 10);
  const clamped = Math.max(5, Math.min(minutes, 43200));
  const since = new Date(Date.now() - clamped * 60000).toISOString();

  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    return json({ error: 'Not configured. Set CF_API_TOKEN and CF_ACCOUNT_ID as Worker vars.' }, 503);
  }

  const query = `query {
    viewer {
      accounts(filter: { accountTag: "${env.CF_ACCOUNT_ID}" }) {
        httpRequests1dGroups(limit: 90, filter: { datetime_geq: "${since}" }) {
          dimensions { date }
          sum { requests pageViews }
          uniq { uniques }
        }
      }
    }
  }`;

  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables: {} })
  });

  const data = await resp.json();

  if (data.errors && data.errors.length) {
    return json({ error: data.errors[0].message }, 502);
  }

  const viewer = (data.data && data.data.viewer) || {};
  const groups = (viewer.accounts && viewer.accounts[0] && viewer.accounts[0].httpRequests1dGroups) || [];

  let totalRequests = 0;
  let totalPageViews = 0;
  let totalUniques = 0;
  for (const g of groups) {
    totalRequests += g.sum.requests || 0;
    totalPageViews += g.sum.pageViews || 0;
    totalUniques += g.uniq.uniques || 0;
  }

  return json({
    generated: new Date().toISOString(),
    range: { minutes: clamped, since },
    hasData: groups.length > 0,
    totals: { totalRequests, totalPageViews, totalUniques },
    daily: groups.map(g => ({
      date: g.dimensions.date,
      requests: g.sum.requests,
      pageViews: g.sum.pageViews,
      uniques: g.uniq.uniques
    })),
    note: groups.length === 0
      ? 'No data returned. Check CF_API_TOKEN has Analytics:Read permission and CF_ACCOUNT_ID is correct.'
      : null
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}