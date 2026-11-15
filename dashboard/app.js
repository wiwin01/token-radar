// Token Radar's dashboard. It reads window.RADAR (data.js, written by main.ts from the same
// board board.json carries) and renders: the ranked pre-token board with search, category and
// chain filters and sortable columns; a detail view per protocol with the model's arithmetic
// and the farm plan; and a set-aside view of protocols whose token already trades, shown with
// the market's own values and never ranked. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var state = { tab: 'board', q: '', category: 'all', chain: 'all', watchOnly: false, sort: 'rank', dir: 1 };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return Math.max(0, Math.round(days)) + ' days';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(3); }

  // The model, recomputed in the page from the row's own figures: the detail view checks the
  // number board.json carries against this arithmetic, so page and board visibly agree.
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadth = 1 + m.breadth_per_chain * Math.min(Math.max(row.chains.length - 1, 0), m.breadth_max_extra_chains);
    return Math.max(1, Math.round(row.tvl_usd * row.model.peer_multiple * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function bySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }
  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }

  function header() {
    var totalImplied = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    return el('div', { class: 'masthead' },
      el('p', { class: 'eyebrow', text: 'Pre-token protocol radar — snapshot ' + DATA.as_of }),
      el('h1', null, 'Token ', el('span', { class: 'radar', text: 'Radar' })),
      el('p', { class: 'lede', text: 'Every protocol in the snapshot that records no token yet — and is not a wrapped or staked product of one that trades — ranked by what its launch would be worth, priced from what the market pays for its tokenized peers. Each row carries the steps to farm it.' }),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', { text: String(DATA.protocols_total) }), el('span', { text: 'protocols scanned' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'pre-token ranked' })),
        el('div', { class: 'stat' }, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'watchlist covered' })),
        el('div', { class: 'stat' }, el('b', { text: fmtUsd(totalImplied) }), el('span', { text: 'total implied value' })),
        el('div', { class: 'stat' }, el('b', { text: fmtMult(DATA.global_multiple) }), el('span', { text: 'global mcap / TVL' }))
      )
    );
  }

  function method() {
    var m = DATA.model;
    var body = el('div', null,
      el('p', { class: 'formula', text: 'implied value  =  TVL  x  peer multiple  x  growth  x  maturity  x  breadth' }),
      el('ul', null,
        el('li', null, el('b', { text: 'Peer multiple: ' }), 'the median market-cap-per-TVL of the tokenized protocols in the same category — what the market actually pays for one TVL dollar of that kind of protocol — shrunk toward the global median (' + fmtMult(DATA.global_multiple) + '), which counts as ' + m.shrinkage_peers + ' pseudo-peers: a category priced by many tokens speaks for itself, one priced by a single token is pulled most of the way back to the market. A category with no tokenized peer uses the global median. Clamped to x' + m.multiple_min + '–x' + m.multiple_max + '.'),
        el('li', null, el('b', { text: 'Growth: ' }), '1 + the 7-day TVL change (clamped to ' + m.growth_floor + '%…+' + m.growth_cap + '%) x ' + m.growth_weight + '. Rising TVL prices a launch up; bleeding TVL prices it down.'),
        el('li', null, el('b', { text: 'Maturity: ' }), m.maturity_floor + ' + up to ' + m.maturity_range + ' over ' + m.maturity_days + ' days tracked with no token. A protocol that has run for years tokenless is a surer launch than one listed last month.'),
        el('li', null, el('b', { text: 'Breadth: ' }), '+ ' + (m.breadth_per_chain * 100) + '% per extra chain beyond the first, capped at ' + (m.breadth_per_chain * m.breadth_max_extra_chains * 100) + '%: distribution a launch would inherit.')
      ),
      el('p', { text: 'The watchlist is the floor, never the ceiling: all ' + DATA.watchlist_size + ' watchlist protocols are on the board, and so are ' + DATA.early_size + ' more below the $' + (DATA.floor_usd / 1e6) + 'M floor — the early protocols a radar exists to find. Wrapped, staked and bridged products of tokens that already trade (WBTC, staked-ETH products and their kin) are excluded by the same rule the watchlist uses: their launch already happened, under the parent token. An implied value is this board\u2019s claim about what a token would be worth if the protocol\u2019s record stayed as it is — not a prediction that one will be issued.' })
    );
    var det = el('details', { class: 'method' }, el('summary', { text: 'How the ranking is priced — the model, in full' }), body);
    return det;
  }

  function footer() {
    return el('footer', null,
      el('p', { text: 'Data: ' + DATA.source + '. A protocol here "records no token" in that snapshot; DefiLlama\u2019s record is not proof a token does not exist. Model version ' + DATA.model_version + '.' }),
      el('p', { text: 'Farm plans are generated from each protocol\u2019s own record — its category, chains, TVL and age — with the cost and time of every step stated. Nothing here is financial advice; an airdrop is never guaranteed.' })
    );
  }

  // ---------------------------------------------------------------- board view
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    // dir 1 is the natural order (rank ascending, name A-Z, numbers largest first); -1 reverses it.
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      if (key === 'name') {
        var va = a.name.toLowerCase(), vb = b.name.toLowerCase();
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir || (a.rank - b.rank);
      }
      if (key === 'rank') return (a.rank - b.rank) * dir;
      var na = key === 'tvl' ? a.tvl_usd : key === 'change' ? (a.change_7d || 0) : key === 'age' ? (a.age_days || 0) : a.implied_value_usd;
      var nb = key === 'tvl' ? b.tvl_usd : key === 'change' ? (b.change_7d || 0) : key === 'age' ? (b.age_days || 0) : b.implied_value_usd;
      return (nb - na) * dir || (a.rank - b.rank);
    });
    return rows;
  }

  function sortHeader(label, key, cls) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' \u25B2' : ' \u25BC') : '';
    return el('th', { class: 'sortable ' + (cls || ''), scope: 'col', onclick: function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = 1; }
      render();
    } }, label, el('span', { class: 'dir', text: arrow }));
  }

  function boardTable(rows) {
    if (rows.length === 0) return el('div', { class: 'tablebox' }, el('p', { class: 'empty', text: 'No protocol matches those filters. Loosen the search or clear a filter.' }));
    var head = el('thead', null, el('tr', null,
      sortHeader('#', 'rank', 'num'),
      sortHeader('Protocol', 'name'),
      el('th', { scope: 'col', text: 'Category' }),
      el('th', { scope: 'col', text: 'Chains' }),
      sortHeader('TVL', 'tvl', 'num'),
      sortHeader('7d', 'change', 'num'),
      sortHeader('Age', 'age', 'num'),
      el('th', { class: 'num', scope: 'col', text: 'Peer x' }),
      sortHeader('Implied value', 'implied', 'num')
    ));
    var body = el('tbody', null, rows.map(function (r) {
      var nameCell = el('td', null,
        el('span', { class: 'pname', text: r.name }),
        r.watchlist ? el('span', { class: 'badge', text: 'Watchlist' }) : null,
        el('span', { class: 'pslug', text: r.slug })
      );
      return el('tr', { onclick: function () { location.hash = '#/p/' + r.slug; } },
        el('td', { class: 'rank num', text: String(r.rank) }),
        nameCell,
        el('td', { class: 'cat', text: r.category || '—' }),
        el('td', { class: 'chains', text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num mult', text: fmtMult(r.model.peer_multiple) }),
        el('td', { class: 'num implied', text: fmtUsd(r.implied_value_usd) })
      );
    }));
    return el('div', { class: 'tablebox' }, el('table', null, head, body));
  }

  function liveTable() {
    var head = el('thead', null, el('tr', null,
      el('th', { scope: 'col', text: 'Protocol' }),
      el('th', { scope: 'col', text: 'Token' }),
      el('th', { scope: 'col', text: 'Category' }),
      el('th', { class: 'num', scope: 'col', text: 'TVL' }),
      el('th', { class: 'num', scope: 'col', text: 'Market cap (the market\u2019s own value)' }),
      el('th', { class: 'num', scope: 'col', text: '7d' })
    ));
    var body = el('tbody', null, DATA.live.map(function (r) {
      return el('tr', null,
        el('td', null, el('span', { class: 'pname', text: r.name }), el('span', { class: 'pslug', text: r.slug })),
        el('td', { class: 'cat', text: r.symbol || '—' }),
        el('td', { class: 'cat', text: r.category || '—' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) })
      );
    }));
    return el('div', null,
      el('p', { class: 'lede', text: 'These protocols already have a token: the radar does not rank them and invents no value for them. Their market caps are also the evidence base for the board\u2019s peer multiples — the median of this set, per category, is what a pre-token protocol\u2019s TVL is priced with.' }),
      el('div', { class: 'tablebox' }, el('table', null, head, body))
    );
  }

  function renderBoard() {
    var wrap = el('div', { class: 'wrap' }, header(), method());
    var tabs = el('div', { class: 'tabs' },
      el('button', { class: 'tab', 'aria-selected': state.tab === 'board' ? 'true' : 'false', onclick: function () { state.tab = 'board'; render(); }, text: 'Pre-token board' }),
      el('button', { class: 'tab', 'aria-selected': state.tab === 'live' ? 'true' : 'false', onclick: function () { state.tab = 'live'; render(); }, text: 'Already trading — set aside' })
    );
    wrap.appendChild(tabs);
    if (state.tab === 'live') { wrap.appendChild(liveTable()); wrap.appendChild(footer()); return wrap; }

    var catSel = el('select', { onchange: function (e) { state.category = e.target.value; render(); } },
      [el('option', { value: 'all', text: 'All categories' })].concat(categories().map(function (c) {
        return el('option', { value: c, text: c, selected: state.category === c ? 'selected' : null });
      })));
    var chainSel = el('select', { onchange: function (e) { state.chain = e.target.value; render(); } },
      [el('option', { value: 'all', text: 'All chains' })].concat(chains().map(function (c) {
        return el('option', { value: c, text: c, selected: state.chain === c ? 'selected' : null });
      })));
    var rows = filteredRows();
    var controls = el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { text: 'Search' }),
        el('input', { type: 'search', placeholder: 'Name or slug…', value: state.q, oninput: function (e) { state.q = e.target.value; refreshTable(); } })),
      el('div', { class: 'field' }, el('label', { text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { text: 'Chain' }), chainSel),
      el('div', { class: 'field check' },
        el('input', { type: 'checkbox', id: 'watchonly', checked: state.watchOnly ? 'checked' : null, onchange: function (e) { state.watchOnly = e.target.checked; render(); } }),
        el('label', { for: 'watchonly', text: 'Watchlist only' })),
      el('span', { class: 'count', id: 'rowcount', text: rows.length + ' of ' + DATA.board_size + ' protocols' })
    );
    wrap.appendChild(controls);
    var slot = el('div', { id: 'tableslot' }, boardTable(rows));
    wrap.appendChild(slot);
    wrap.appendChild(footer());
    wrap._refresh = function () {
      var fresh = filteredRows();
      var count = document.getElementById('rowcount');
      if (count) count.textContent = fresh.length + ' of ' + DATA.board_size + ' protocols';
      var s = document.getElementById('tableslot');
      if (s) { s.innerHTML = ''; s.appendChild(boardTable(fresh)); }
    };
    return wrap;
  }
  function refreshTable() { var w = app.firstChild; if (w && w._refresh) w._refresh(); }

  // ---------------------------------------------------------------- detail view
  function renderDetail(row) {
    var recomputed = impliedOf(row);
    var check = recomputed === row.implied_value_usd
      ? el('p', { class: 'checkline' }, 'Recomputed in this page from the figures above: ', el('b', { text: fmtUsd(recomputed) + ' — matches board.json' }))
      : el('p', { class: 'checkline', text: 'Recomputed in this page: ' + fmtUsd(recomputed) + ' (board.json carries ' + fmtUsd(row.implied_value_usd) + ')' });
    var wrap = el('div', { class: 'wrap' },
      el('a', { class: 'back', href: '#', text: '\u2190 Back to the board' }),
      el('div', { class: 'dhead' },
        el('span', { class: 'rank', text: '#' + row.rank }),
        el('h2', { text: row.name }),
        row.watchlist ? el('span', { class: 'badge', text: 'Watchlist' }) : null,
        el('span', { class: 'pslug', text: row.slug })
      ),
      el('div', { class: 'grid' },
        el('div', { class: 'cell' }, el('b', { class: 'implied', text: fmtUsd(row.implied_value_usd) }), el('span', { text: 'Implied value' })),
        el('div', { class: 'cell' }, el('b', { text: fmtUsd(row.tvl_usd) }), el('span', { text: 'TVL' })),
        el('div', { class: 'cell' }, el('b', { text: fmtPct(row.change_7d) }), el('span', { text: 'TVL change, 7d' })),
        el('div', { class: 'cell' }, el('b', { text: fmtAge(row.age_days) }), el('span', { text: 'Tracked, no token' })),
        el('div', { class: 'cell' }, el('b', { text: row.category || '—' }), el('span', { text: 'Category' })),
        el('div', { class: 'cell' }, el('b', { text: row.listed_at || 'unknown' }), el('span', { text: 'First tracked' }))
      ),
      el('div', { class: 'panel' },
        el('h3', { text: 'Why this value — the model\u2019s arithmetic' }),
        el('table', { class: 'mini' }, el('tbody', null,
          el('tr', null, el('td', { text: 'TVL (snapshot)' }), el('td', { class: 'num', text: fmtUsd(row.tvl_usd) })),
          el('tr', null, el('td', { text: 'Peer multiple — ' + row.model.peer_scope }), el('td', { class: 'num', text: fmtMult(row.model.peer_multiple) })),
          el('tr', null, el('td', { text: 'Growth multiplier (7d change ' + fmtPct(row.change_7d) + ')' }), el('td', { class: 'num', text: fmtMult(row.model.growth_multiplier) })),
          el('tr', null, el('td', { text: 'Maturity multiplier (' + fmtAge(row.age_days) + ' with no token)' }), el('td', { class: 'num', text: fmtMult(row.model.maturity_multiplier) })),
          el('tr', null, el('td', { text: 'Breadth multiplier (' + row.chains.length + (row.chains.length === 1 ? ' chain' : ' chains') + ')' }), el('td', { class: 'num', text: fmtMult(row.model.breadth_multiplier) })),
          el('tr', null, el('td', { class: 'arith', text: 'Implied value' }), el('td', { class: 'num arith', text: fmtUsd(row.implied_value_usd) }))
        )),
        check
      ),
      el('div', { class: 'panel' },
        el('h3', { text: 'How to farm it' }),
        el('ol', { class: 'farm' }, row.farm_steps.map(function (s) { return el('li', { text: s }); }))
      ),
      el('div', { class: 'panel' },
        el('h3', { text: 'Where it runs' }),
        el('div', { class: 'chips' }, row.chains.map(function (c) { return el('span', { class: 'chip', text: c }); })),
        el('p', { text: 'This protocol records no token in the ' + DATA.as_of + ' snapshot' + (row.watchlist ? ' and sits on the house watchlist (TVL at or above the $' + (DATA.floor_usd / 1e6) + 'M floor)' : ' and sits below the house watchlist\u2019s $' + (DATA.floor_usd / 1e6) + 'M floor — an early catch, ranked on the same figures') + '. The implied value is what a token would be worth if that record stayed as it is; it is not a promise that one will be issued.' })
      ),
      footer()
    );
    return wrap;
  }

  function render() {
    var hash = location.hash || '';
    app.innerHTML = '';
    if (hash.indexOf('#/p/') === 0) {
      var row = bySlug(decodeURIComponent(hash.slice(4)));
      app.appendChild(row ? renderDetail(row) : renderBoard());
    } else {
      if (hash.indexOf('#cat=') === 0) { state.category = decodeURIComponent(hash.slice(5)); state.tab = 'board'; }
      app.appendChild(renderBoard());
    }
    app.setAttribute('aria-busy', 'false');
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);
  render();
})();
