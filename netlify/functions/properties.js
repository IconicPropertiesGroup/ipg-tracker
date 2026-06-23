// IPG Property Tracker — Airtable proxy (keeps your API token off the page)
// Reads config from environment variables set in the Netlify dashboard:
//   AIRTABLE_TOKEN   — Airtable personal access token
//   AIRTABLE_BASE_ID — the base id, looks like appXXXXXXXXXXXXXX
//   AIRTABLE_TABLE   — table name (optional, defaults to "Properties")

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE  = process.env.AIRTABLE_BASE_ID;
const TABLE = process.env.AIRTABLE_TABLE || 'Properties';
const ENDPOINT = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`;

// app status id  <->  Airtable single-select label
const STATUS_LABEL = {
  tracking:'Tracking', contacted:'Contacted', discussion:'In discussion',
  contract:'Under contract', closed:'Closed', passed:'Passed'
};
const STATUS_ID = {};
Object.entries(STATUS_LABEL).forEach(([k,v]) => STATUS_ID[v] = k);

const numOrNull = v =>
  (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);

// Airtable record -> shape the app expects
function toApp(rec){
  const f = rec.fields || {};
  return {
    id: rec.id,
    name: f['Name'] || '',
    address: f['Address'] || '',
    lat: Number(f['Latitude']) || 0,
    lng: Number(f['Longitude']) || 0,
    type: f['Asset Type'] || 'Industrial',
    status: STATUS_ID[f['Status']] || 'tracking',
    buildingSf: f['Building SF'] ?? '',
    lotSize: f['Lot Size'] ?? '',
    lotUnit: f['Lot Unit'] || 'sqft',
    value: f['Est Value'] ?? '',
    zoning: f['Zoning'] || '',
    owner: f['Owner Contact'] || '',
    notes: f['Notes'] || ''
  };
}

// app shape -> Airtable fields (only sends keys that were provided)
function toFields(p){
  const f = {};
  const set = (k, v) => { if (v !== undefined) f[k] = v; };
  set('Name', p.name);
  set('Address', p.address);
  if (p.lat !== undefined) f['Latitude'] = Number(p.lat);
  if (p.lng !== undefined) f['Longitude'] = Number(p.lng);
  set('Asset Type', p.type);
  if (p.status !== undefined) f['Status'] = STATUS_LABEL[p.status] || 'Tracking';
  if (p.buildingSf !== undefined) f['Building SF'] = numOrNull(p.buildingSf);
  if (p.lotSize !== undefined) f['Lot Size'] = numOrNull(p.lotSize);
  set('Lot Unit', p.lotUnit);
  if (p.value !== undefined) f['Est Value'] = numOrNull(p.value);
  set('Zoning', p.zoning);
  set('Owner Contact', p.owner);
  set('Notes', p.notes);
  return f;
}

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  },
  body: JSON.stringify(body)
});

async function airtable(url, opts = {}){
  const r = await fetch(url, {
    ...opts,
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || data?.error?.type || `Airtable error ${r.status}`);
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (!TOKEN || !BASE) return json(500, { error: 'Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID environment variables' });

  try {
    if (event.httpMethod === 'GET') {
      let records = [], offset;
      do {
        const u = new URL(ENDPOINT);
        u.searchParams.set('pageSize', '100');
        if (offset) u.searchParams.set('offset', offset);
        const data = await airtable(u.toString());
        records = records.concat(data.records || []);
        offset = data.offset;
      } while (offset);
      return json(200, { properties: records.map(toApp) });
    }

    if (event.httpMethod === 'POST') {
      const p = JSON.parse(event.body || '{}');
      const data = await airtable(ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({ fields: toFields(p), typecast: true })
      });
      return json(200, toApp(data));
    }

    if (event.httpMethod === 'PATCH') {
      const p = JSON.parse(event.body || '{}');
      if (!p.id) return json(400, { error: 'Missing id' });
      const data = await airtable(`${ENDPOINT}/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: toFields(p), typecast: true })
      });
      return json(200, toApp(data));
    }

    if (event.httpMethod === 'DELETE') {
      const id = (event.queryStringParameters || {}).id;
      if (!id) return json(400, { error: 'Missing id' });
      await airtable(`${ENDPOINT}/${id}`, { method: 'DELETE' });
      return json(200, { ok: true, id });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return json(500, { error: String(err.message || err) });
  }
};
