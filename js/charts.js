/* Small SVG line chart for price history. points: [{d: 'YYYY-MM-DD', v: number}] */
const Charts = (() => {
  'use strict';

  const fmt = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const shortDate = d => {
    const [y, m, day] = d.split('-');
    return `${Number(m)}/${Number(day)}/${y.slice(2)}`;
  };

  function line(points, opts = {}) {
    if (!points || points.length < 2) {
      return `<div class="chart-empty">Not enough price history yet. Prices are saved once a day when you open the app, so the chart fills in over time.</div>`;
    }
    const W = 640, H = opts.height || 200, padL = 64, padR = 12, padT = 12, padB = 26;
    const vals = points.map(p => p.v);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max === min) { max += 1; min = Math.max(0, min - 1); }
    const x = i => padL + (i / (points.length - 1)) * (W - padL - padR);
    const y = v => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${path} L${x(points.length - 1).toFixed(1)},${H - padB} L${padL},${H - padB} Z`;
    const dots = points.length <= 60
      ? points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3"><title>${shortDate(p.d)}: ${fmt(p.v)}</title></circle>`).join('')
      : '';
    return `
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price history">
        <line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(max)}" y2="${y(max)}"/>
        <line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(min)}" y2="${y(min)}"/>
        <text class="axis" x="${padL - 6}" y="${y(max) + 4}" text-anchor="end">${fmt(max)}</text>
        <text class="axis" x="${padL - 6}" y="${y(min) + 4}" text-anchor="end">${fmt(min)}</text>
        <text class="axis" x="${padL}" y="${H - 6}">${shortDate(points[0].d)}</text>
        <text class="axis" x="${W - padR}" y="${H - 6}" text-anchor="end">${shortDate(points[points.length - 1].d)}</text>
        <path class="area" d="${area}"/>
        <path class="line" d="${path}"/>
        ${dots}
      </svg>`;
  }

  return { line };
})();
