// Indicadores do mercado no topo da Agenda do Corretor (versão web).
// BCB (SGS): Selic, INCC-M, IPCA, IGP-M, TR. Dólar: AwesomeAPI. IBOVESPA: ibov.json (atualizado por rotina do GitHub).
(function () {
  var KEY = 'agenda-indicadores-v1';
  var MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var SERIES = [
    { key: 'selic', label: 'Selic', code: 432, kind: 'rate', hint: 'Meta da taxa Selic definida pelo Copom (% ao ano).' },
    { key: 'incc', label: 'INCC-M', code: 7456, kind: 'm12', hint: 'Custo da construção (FGV), corrige imóveis na planta.' },
    { key: 'ipca', label: 'IPCA', code: 433, kind: 'm12', hint: 'Inflação oficial (IBGE).' },
    { key: 'igpm', label: 'IGP-M', code: 189, kind: 'm12', hint: 'Usado no reajuste de aluguel (FGV).' },
    { key: 'tr', label: 'TR', code: 7811, kind: 'm1', hint: 'Taxa Referencial do mês.' }
  ];
  var data = {};
  try { data = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { data = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }
  var nf = function (v, d) { return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var br = function (d) { return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); };
  var parseBr = function (s) { var p = s.split('/'); return new Date(+p[2], +p[1] - 1, +p[0]); };
  var stamp = function (d) { return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  // ---------- painel ----------
  var css = document.createElement('style');
  css.textContent = '.ind{margin:12px 0}.ind h2{font-size:13px;color:var(--muted);margin:0 0 6px;font-weight:600}' +
    '.ind .chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}' +
    '.ind .chip2{background:var(--teal);color:#fff;border-radius:10px;padding:7px 10px}' +
    '.ind .l{font-size:11px;color:var(--mint)}.ind .v{font-size:17px;font-weight:700;line-height:1.25}' +
    '.ind .d{font-size:11px;color:var(--mint)}.ind .up{color:#7EDCC5}.ind .dn{color:#FF9B9B}' +
    '.ind .src{font-size:11px;color:var(--muted);margin-top:6px}';
  document.head.appendChild(css);
  var box = document.createElement('section');
  box.className = 'ind';
  box.innerHTML = '<h2>Indicadores do mercado</h2><div class="chips" id="indChips"></div><div class="src" id="indSrc"></div>';
  var anchor = document.querySelector('.proto');
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor); else document.body.insertBefore(box, document.body.firstChild);

  var failed = false;
  var NOLOAD = function () { return failed ? 'indisponível agora' : 'buscando…'; };
  function chip(label, value, detail, cls, tip) {
    return '<div class="chip2" title="' + (tip || '') + '"><div class="l">' + label + '</div><div class="v">' + value +
      '</div><div class="d ' + (cls || '') + '">' + (detail || '') + '</div></div>';
  }
  function render() {
    var h = '';
    var q = data.quotes || {};
    if (q.usd) {
      var u = q.usd, up = u.pct >= 0;
      h += chip('Dólar', 'R$ ' + nf(u.value, 2), (u.pct == null ? '' : (up ? '+' : '') + nf(u.pct, 2) + '% · ') + u.time, up ? 'up' : 'dn', 'Dólar comercial (USD/BRL).');
    } else h += chip('Dólar', '—', NOLOAD());
    if (q.ibov) {
      var b = q.ibov, ub = b.pct >= 0;
      h += chip('IBOVESPA', nf(b.value, 0) + ' pts', (b.pct == null ? '' : (ub ? '+' : '') + nf(b.pct, 2) + '% · ') + b.time, ub ? 'up' : 'dn', 'Índice da bolsa brasileira (B3). Pode ter atraso.');
    } else h += chip('IBOVESPA', '—', 'indisponível');
    var v = data.values || {};
    SERIES.forEach(function (s) {
      var it = v[s.key];
      if (!it) { h += chip(s.label, '—', NOLOAD(), '', s.hint); return; }
      if (s.kind === 'rate') h += chip(s.label, nf(it.value, 2) + '% a.a.', 'desde ' + it.since, '', s.hint);
      else if (s.kind === 'm12') h += chip(s.label, nf(it.value, 2) + '%', it.month + (it.acc12 == null ? '' : ' · 12m ' + nf(it.acc12, 1) + '%'), '', s.hint);
      else h += chip(s.label, nf(it.value, 2) + '%', it.month, '', s.hint);
    });
    document.getElementById('indChips').innerHTML = h;
    document.getElementById('indSrc').textContent = 'Fontes: Banco Central (índices), AwesomeAPI (dólar) e Yahoo Finance (IBOVESPA, pode ter atraso). Informativo, sem valor oficial.';
  }

  // ---------- coleta ----------
  function getJson(url, ms) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms || 15000);
    return fetch(url, { signal: ctl.signal, cache: 'no-store' }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function loadSeries(s) {
    var today = new Date(), ini = new Date(today.getTime() - (s.kind === 'rate' ? 500 : 430) * 864e5);
    var url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + s.code + '/dados?formato=json&dataInicial=' + br(ini) + '&dataFinal=' + br(today);
    return getJson(url).then(function (rows) {
      if (!rows.length) return;
      rows = rows.map(function (r) { return { d: parseBr(r.data), ds: r.data, v: parseFloat(r.valor) }; });
      var item;
      if (s.kind === 'rate') {
        rows = rows.filter(function (r) { return r.d <= today; });
        var last = rows[rows.length - 1], i = rows.length - 1;
        while (i > 0 && rows[i - 1].v === last.v) i--;
        var st = rows[i].d;
        item = { value: last.v, since: pad(st.getDate()) + '/' + pad(st.getMonth() + 1) + '/' + String(st.getFullYear()).slice(2) };
      } else {
        if (rows.length > 12) rows = rows.slice(rows.length - 12);
        var l = rows[rows.length - 1], acc = null;
        if (s.kind === 'm12' && rows.length >= 12) { var f = 1; rows.forEach(function (r) { f *= 1 + r.v / 100; }); acc = (f - 1) * 100; }
        item = { value: l.v, month: MES[l.d.getMonth()] + '/' + String(l.d.getFullYear()).slice(2), acc12: acc };
      }
      item.on = new Date().toISOString().slice(0, 10);
      data.values = data.values || {}; data.values[s.key] = item; save(); render();
    });
  }
  function loadUsd() {
    return getJson('https://economia.awesomeapi.com.br/json/last/USD-BRL').then(function (j) {
      var o = j.USDBRL, price = parseFloat(o.bid);
      if (!(price > 0)) return;
      data.quotes = data.quotes || {};
      data.quotes.usd = { value: price, pct: parseFloat(o.pctChange), time: stamp(new Date(+o.timestamp * 1000)) };
      save(); render();
    });
  }
  function loadIbov() {
    return getJson('ibov.json?t=' + Date.now()).then(function (o) {
      if (!(o.value > 0)) return;
      data.quotes = data.quotes || {};
      data.quotes.ibov = { value: o.value, pct: o.pct, time: stamp(new Date(o.time)) };
      save(); render();
    });
  }
  var quiet = function () { failed = true; render(); };
  function refreshSeries() {
    var v = data.values || {}, day = new Date().toISOString().slice(0, 10);
    SERIES.forEach(function (s) { if (!v[s.key] || v[s.key].on !== day) loadSeries(s).catch(quiet); });
  }
  function refreshQuotes() { loadUsd().catch(quiet); loadIbov().catch(quiet); }

  render(); refreshSeries(); refreshQuotes();
  setInterval(function () { if (!document.hidden) refreshQuotes(); }, 5 * 60000);
  setInterval(refreshSeries, 30 * 60000);
  window.addEventListener('online', function () { failed = false; render(); refreshQuotes(); refreshSeries(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { refreshQuotes(); refreshSeries(); } });
})();
