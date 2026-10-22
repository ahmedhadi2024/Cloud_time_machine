/**
 * API client. One session id per browser tab groups a visitor's simulation
 * events in DynamoDB without storing anything identifying.
 */
const SESSION_KEY = 'ctm-session-id';

function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `web-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return 'web-anonymous'; // private mode with storage blocked
  }
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-session-id': sessionId(),
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed with ${res.status}`);
  }
  return body;
}

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  meta: () => request('/api/meta'),
  architecture: (companyId, year) => request(`/api/architectures/${companyId}/${year}`),
  timeline: (companyId) => request(`/api/architectures/${companyId}/timeline`),
  compare: (companyId, year) => request(`/api/architectures/${companyId}/${year}/compare`),

  traffic: (payload) => post('/api/simulate/traffic', payload),
  failure: (payload) => post('/api/simulate/failure', payload),
  ddos: (payload) => post('/api/simulate/ddos', payload),
  storage: (payload) => post('/api/simulate/storage', payload),
  cost: (payload) => post('/api/simulate/cost', payload),
  optimise: (payload) => post('/api/simulate/cost/optimise', payload),
  scores: (payload) => post('/api/simulate/scores', payload),

  review: (payload) => post('/api/builder/review', payload),
  benchmark: (payload) => post('/api/builder/benchmark', payload),
  starter: () => request('/api/builder/starter'),
  saveDesign: (payload) => post('/api/builder/designs', payload),
  designs: () => request('/api/builder/designs'),
};
