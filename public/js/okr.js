const refresh = document.getElementById('refresh');
const status = document.getElementById('status');
async function loadCounters() {
  refresh.disabled = true;
  status.textContent = 'Loading counters?';
  try {
    const response = await fetch('/api/okr', { cache: 'no-store' });
    if (!response.ok) throw Error('Dashboard unavailable');
    const rows = await response.json();
    const totals = new Map(rows.map(row => [row.metric, String(row.total)]));
    const counters = [...document.querySelectorAll('[data-metric]')];
    if (counters.some(el => !/^\d+$/.test(totals.get(el.dataset.metric) || ''))) throw Error('Missing totals');
    counters.forEach(el => { el.textContent = BigInt(totals.get(el.dataset.metric)).toLocaleString(); });
    status.textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch {
    document.querySelectorAll('[data-metric]').forEach(el => { el.textContent = '?'; });
    status.textContent = 'Unable to load totals. Try refreshing again.';
  } finally { refresh.disabled = false; }
}
refresh.addEventListener('click', loadCounters);
window.addEventListener('pageshow', loadCounters);
