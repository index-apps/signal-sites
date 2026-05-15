// Verification endpoint
if (req.method === 'GET') {
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
    <html>
    <head>
    <meta name="google-site-verification" 
    content="<meta name="google-site-verification" content="QvJCWKw5e7-N9B0MKUDHQz6jaXpvh9fWLBh4ml_p-EI" />">
    </head>
    <body>Signal Site</body>
    </html>
  `);
}export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const url = body?.url;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const CONFIG = {
    GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
    GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    INDEXNOW_KEY: process.env.INDEXNOW_KEY || 'indexforce123',
    YOUR_DOMAIN: process.env.YOUR_DOMAIN,
  };

  const results = [];

  async function getGoogleToken() {
    const now = Math.floor(Date.now() / 1000);
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const claim = btoa(JSON.stringify({
      iss: CONFIG.GOOGLE_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/indexing',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const { createSign } = await import('crypto');
    const sign = createSign('RSA-SHA256');
    sign.update(`${header}.${claim}`);
    const sig = sign.sign(CONFIG.GOOGLE_PRIVATE_KEY, 'base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const jwt = `${header}.${claim}.${sig}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    const data = await tokenRes.json();
    if (data.access_token) return data.access_token;
    throw new Error('Token failed: ' + JSON.stringify(data));
  }

  // STEP 1: Google Indexing API
  try {
    const token = await getGoogleToken();
    const indexRes = await fetch(
      'https://indexing.googleapis.com/v3/urlNotifications:publish',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: url, type: 'URL_UPDATED' })
      }
    );
    const indexData = await indexRes.json();
    if (indexRes.ok) {
      results.push({ step: 'google_indexing_api', status: 'success' });
    } else {
      results.push({ step: 'google_indexing_api', status: 'error', message: JSON.stringify(indexData) });
    }
  } catch (e) {
    results.push({ step: 'google_indexing_api', status: 'error', message: e.message });
  }

  // STEP 2: IndexNow
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: CONFIG.YOUR_DOMAIN,
        key: CONFIG.INDEXNOW_KEY,
        urlList: [url]
      })
    });
    results.push({ step: 'indexnow', status: 'success' });
  } catch (e) {
    results.push({ step: 'indexnow', status: 'error', message: e.message });
  }

  // STEP 3: Bing
  try {
    await fetch('https://www.bing.com/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: CONFIG.YOUR_DOMAIN,
        key: CONFIG.INDEXNOW_KEY,
        urlList: [url]
      })
    });
    results.push({ step: 'bing_indexnow', status: 'success' });
  } catch (e) {
    results.push({ step: 'bing_indexnow', status: 'error', message: e.message });
  }

  // STEP 4: Yandex
  try {
    await fetch('https://yandex.com/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: CONFIG.YOUR_DOMAIN,
        key: CONFIG.INDEXNOW_KEY,
        urlList: [url]
      })
    });
    results.push({ step: 'yandex_indexnow', status: 'success' });
  } catch (e) {
    results.push({ step: 'yandex_indexnow', status: 'error', message: e.message });
  }

  const successCount = results.filter(r => r.status === 'success').length;

  return res.status(200).json({
    success: true,
    url: url,
    signalsFired: successCount,
    totalSteps: results.length,
    details: results,
    site: CONFIG.YOUR_DOMAIN,
    message: `${successCount}/${results.length} signals fired!`
  });
}
