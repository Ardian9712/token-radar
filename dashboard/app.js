// Token Radar's plain dashboard: no framework, no network, no build step.
// It reads window.RADAR (written by main.ts beside dashboard/) and renders:
//   - a "How the value is scored" panel: the model in words, with a worked example from rank 1
//   - a sortable, filterable board of every eligible pre-token protocol (rank, implied, TVL, 7d)
//   - a separate Live token view: protocols that already trade, at the market's own value
//   - a detail page per protocol: every snapshot field, the reasoning, and the full farm plan
// Views are addressable by URL for screenshots: ?view=board, ?view=detail&slug=..., ?view=filtered&category=...
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var META = DATA.meta || {};
  var AS_OF = META.as_of || DATA.as_of || '2026-11-14';
  var FLOOR = typeof META.floor_usd === 'number' ? META.floor_usd : DATA.floor_usd;

  var app = document.getElementById('app');
  var state = { tab: 'board', q: '', category: 'all', watchOnly: false, sort: 'rank', dir: 1, selected: null, open: null };

  // URL parameters decide the opening view: board (default), detail of one slug, or a filtered board.
  var params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'detail' && params.get('slug')) state.selected = params.get('slug');
  if (params.get('view') === 'filtered' && params.get('category')) state.category = params.get('category');

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
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

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    var v = Math.abs(n);
    if (v >= 1e9) return sign + '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return sign + '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return sign + '$' + Math.round(v / 1e3) + 'K';
    return sign + '$' + Math.round(v);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  // Whole months from listed_at to the snapshot's as_of: the model's own age unit.
  function monthsSince(listedAt) {
    if (!listedAt) return null;
    var from = Date.parse(listedAt + 'T00:00:00Z');
    var to = Date.parse(AS_OF + 'T00:00:00Z');
    if (!isFinite(from) || !isFinite(to)) return null;
    var a = new Date(to);
    var b = new Date(from);
    var m = (a.getUTCFullYear() - b.getUTCFullYear()) * 12 + (a.getUTCMonth() - b.getUTCMonth());
    if (a.getUTCDate() < b.getUTCDate()) m -= 1;
    return Math.max(0, m);
  }
  function fmtAge(row) {
    var m = monthsSince(row.listed_at);
    if (m !== null) return m + ' mo';
    if (row.age_days === null || row.age_days === undefined) return 'n/a';
    return Math.round(row.age_days) + 'd';
  }

  // The category multiple the board used, recovered from the row's own factors.
  function multipleOf(r) {
    var g = r.growth_multiplier || 1;
    var a = r.maturity_multiplier || 1;
    if (!r.tvl_usd) return 0;
    return r.implied_value_usd / (r.tvl_usd * g * a);
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains and TVL
  // decide the actions, the capital and every cost and time. No protocol name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function coreActions(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('dex') >= 0 || c.indexOf('swap') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('amm') >= 0) {
      return ["Swap $" + capital + " of USDC for the other asset in " + name + "'s main pool on " + chain,
        "Add the swapped pair back as liquidity in " + name + " on " + chain + " and keep the LP receipt"];
    }
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('credit') >= 0) {
      return ["Supply $" + capital + " of USDC into " + name + "'s lending market on " + chain,
        "Borrow a small amount of the market's main asset against the deposit on " + name + " (" + chain + ")"];
    }
    if (c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) {
      return ["Deposit $" + capital + " of USDC into a " + name + " vault on " + chain,
        "Keep the vault shares and top the deposit up once after a week on " + name + " (" + chain + ")"];
    }
    if (c.indexOf('perp') >= 0 || c.indexOf('derivativ') >= 0 || c.indexOf('option') >= 0 || c.indexOf('trading') >= 0) {
      return ["Deposit $" + capital + " of USDC as margin on " + name + " (" + chain + ")",
        "Open one small long position on " + name + "'s most liquid market on " + chain];
    }
    if (c.indexOf('bridge') >= 0) {
      return ["Bridge $" + capital + " of USDC to " + chain + " through " + name + "'s official route",
        "Use the bridged USDC in one app on " + chain + " and keep both transaction records"];
    }
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) {
      return ["Stake $" + capital + " of the chain's staking asset through " + name + " on " + chain,
        "Keep the liquid staking receipt and leave the stake untouched on " + name + " (" + chain + ")"];
    }
    if (c.indexOf('rwa') >= 0) {
      return ["Deposit $" + capital + " of USDC into " + name + "'s yield-bearing asset on " + chain,
        "Hold the receipt token in the same wallet and check its value weekly on " + name + " (" + chain + ")"];
    }
    return ["Deposit $" + capital + " of USDC into " + name + " on " + chain,
      "Leave the deposit in place for a week and review the position on " + name + " (" + chain + ")"];
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var pair = coreActions(p, capital, chain);
    var gas = capital >= 150 ? 8 : capital >= 100 ? 5 : 2;
    return [
      "Fund a fresh wallet with $" + capital + " of USDC on " + chain + ", keeping the seed phrase offline (gas about $" + gas + ", about 10 minutes).",
      pair[0] + " (about $" + gas + " of gas, 15 minutes).",
      pair[1] + " (about $" + gas + " of gas, 10 minutes).",
      "Keep the position on " + p.name + " for at least 14 days and make one small weekly action so your activity is recorded on " + chain + " (about $1 of gas a week, 5 minutes a week).",
      "Review " + p.name + "'s official points dashboard on " + chain + ", claim only from links it publishes, and log every transaction hash ($0 to check, about 10 minutes)."
    ];
  }

  // Watchlist rows are the eligible protocols at or above the floor; the rest are the early radar.
  function isWatchlist(r) { return r.tvl_usd >= FLOOR; }
  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { seen[r.category || 'Other'] = true; });
    return Object.keys(seen).sort();
  }
  if (state.category !== 'all' && categories().indexOf(state.category) < 0) state.category = 'all';
  if (state.selected && !DATA.rows.some(function (r) { return r.slug === state.selected; })) state.selected = null;

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !isWatchlist(r)) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var k = state.sort;
    var d = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (k === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -d;
      if (av > bv) return d;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function setUrl() {
    var p = new URLSearchParams();
    if (state.selected) { p.set('view', 'detail'); p.set('slug', state.selected); }
    else if (state.tab === 'live') p.set('view', 'live');
    else if (state.category !== 'all') { p.set('view', 'filtered'); p.set('category', state.category); }
    try { window.history.replaceState(null, '', p.toString() ? '?' + p.toString() : window.location.pathname); } catch (e) { /* file:// quirks */ }
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + AS_OF }),
        el('span', { text: DATA.model_version + ' model' }),
        el('span', { text: DATA.board_size + ' pre-token rows · ' + DATA.live_size + ' live set aside' }),
        META.generated_from ? el('span', { class: 'src', title: META.generated_from, text: 'Generated from ' + META.generated_from }) : null
      )
    );
  }

  function modelPanel() {
    var top = null;
    DATA.rows.forEach(function (r) { if (r.rank === 1) top = r; });
    var example = '';
    if (top) {
      var mult = multipleOf(top);
      example = 'Reading rank 1: ' + top.name + ' holds ' + fmtUsd(top.tvl_usd) + ' of TVL. The median market-cap/TVL of tokened ' + (top.category || 'Other') + ' comparators is about ' + mult.toFixed(2) + 'x, the 7-day flow multiplies by ' + top.growth_multiplier + ' and maturity by ' + top.maturity_multiplier + ': ' + fmtUsd(top.tvl_usd) + ' x ' + mult.toFixed(2) + ' x ' + top.growth_multiplier + ' x ' + top.maturity_multiplier + ' lands at ' + fmtUsd(top.implied_value_usd) + '.';
    }
    return el('section', { class: 'panel model', 'aria-label': 'How the value is scored' },
      el('h2', { text: 'How the value is scored' }),
      el('p', { text: 'Implied value = round(TVL x category multiple x growth factor x age factor). The category multiple is the median market-cap/TVL ratio of the snapshot\'s tokened protocols in the same category — at least three comparables, else the global median. The growth factor clamps 1 + 7-day change into 0.8-1.3, and the age factor climbs from 0.9 toward 1.25 with the months since listing; an unknown listing date counts as 12 months.' }),
      example ? el('p', { class: 'example', text: example }) : null,
      META.model_notes ? el('details', { class: 'notes' },
        el('summary', { text: 'Full model notes and limits' }),
        el('div', { class: 'notes-body' }, META.model_notes.split('\n\n').map(function (p) { return el('p', { text: p }); }))
      ) : null
    );
  }

  function controls() {
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or slug', value: state.q, 'aria-label': 'Search the board by name or slug' });
    search.addEventListener('input', function () { state.q = search.value; render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories().map(function (c) { return el('option', { value: c, text: c, selected: state.category === c ? 'selected' : null }); })
    );
    select.value = state.category;
    select.addEventListener('change', function () { state.category = select.value; setUrl(); render(); });
    var toggle = el('input', { type: 'checkbox', id: 'watchonly' });
    toggle.checked = state.watchOnly;
    toggle.addEventListener('change', function () { state.watchOnly = toggle.checked; render(); });
    var boardTab = el('button', { type: 'button', class: 'tab' + (state.tab === 'board' ? ' active' : ''), onclick: function () { state.tab = 'board'; setUrl(); render(); } }, 'Board');
    var liveTab = el('button', { type: 'button', class: 'tab' + (state.tab === 'live' ? ' active' : ''), onclick: function () { state.tab = 'live'; setUrl(); render(); } }, 'Live token');
    return el('div', { class: 'controls' },
      el('div', { class: 'field grow' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('label', { class: 'switch', for: 'watchonly' }, toggle, el('span', { text: 'Watchlist only' })),
      el('div', { class: 'tabs' }, boardTab, liveTab)
    );
  }

  function sortBtn(key, label) {
    var active = state.sort === key;
    return el('button', { type: 'button', class: 'sort' + (active ? ' active' : ''), onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; } render(); } },
      label, active ? el('span', { class: 'dir', 'aria-hidden': 'true', text: state.dir < 0 ? '↓' : '↑' }) : null);
  }

  function boardView() {
    var list = sortedRows(rows());
    var count = el('p', { class: 'count', text: list.length + ' of ' + DATA.rows.length + ' rows shown' + (state.watchOnly ? ' · watchlist only' : '') });
    if (list.length === 0) {
      return el('section', { class: 'panel' },
        el('div', { class: 'empty' },
          el('h2', { text: 'No protocol matches that filter' }),
          el('p', { text: 'Clear the search, the category or the watchlist toggle to see the board again.' }),
          el('button', { type: 'button', onclick: function () { state.q = ''; state.category = 'all'; state.watchOnly = false; setUrl(); render(); } }, 'Clear filters')
        ));
    }
    var max = 1;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var head = el('div', { class: 'grid head' },
      el('div', null, sortBtn('rank', 'Rank')),
      el('div', null, 'Protocol'),
      el('div', { class: 'num' }, sortBtn('tvl', 'TVL')),
      el('div', { class: 'num' }, sortBtn('growth', '7d')),
      el('div', { class: 'num col-age' }, 'Age'),
      el('div', { class: 'num' }, sortBtn('implied', 'Implied value'))
    );
    var body = list.map(function (r) {
      var steps = farmSteps(r);
      var open = state.open === r.slug;
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? ' pos' : ' neg';
      return el('article', { class: 'row' + (open ? ' open' : ''), 'data-slug': r.slug },
        el('div', { class: 'cells', onclick: function () { openDetail(r.slug); } },
          el('div', { class: 'num rank' }, el('b', { text: String(r.rank) })),
          el('div', { class: 'who' },
            el('button', { type: 'button', class: 'link', onclick: function () { openDetail(r.slug); } }, el('b', { text: r.name })),
            el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'unnamed chain') + ' · ' + (isWatchlist(r) ? 'watchlist' : 'early') })
          ),
          el('div', { class: 'num' }, fmtUsd(r.tvl_usd)),
          el('div', { class: 'num' + growthClass }, fmtPct(r.change_7d)),
          el('div', { class: 'num col-age' }, fmtAge(r)),
          el('div', { class: 'num implied' },
            el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
            el('span', { text: fmtUsd(r.implied_value_usd) })
          )
        ),
        el('div', { class: 'plan' },
          el('span', { class: 'step', text: '1. ' + steps[0] }),
          el('span', { class: 'step', text: '2. ' + steps[1] }),
          el('button', { type: 'button', class: 'plan-btn', 'aria-expanded': open ? 'true' : 'false', onclick: function () { state.open = open ? null : r.slug; render(); } }, open ? 'Hide farm plan' : 'Farm plan'),
          open ? el('ol', { class: 'steps' }, steps.map(function (s) { return el('li', { text: s }); })) : null
        )
      );
    });
    return el('section', { class: 'panel' },
      el('div', { class: 'table-wrap' }, head, body),
      count
    );
  }

  function liveView() {
    return el('section', { class: 'panel' },
      el('p', { class: 'lede-line', text: 'These protocols already have a token that trades, so the market prices them directly: the market cap below is a fact, not a model. They are the comparators, kept out of the pre-token board.' }),
      el('div', { class: 'table-wrap' },
        el('div', { class: 'grid head live-head' },
          el('div', null, 'Protocol'),
          el('div', null, 'Category'),
          el('div', { class: 'num' }, 'TVL'),
          el('div', { class: 'num' }, '7d'),
          el('div', { class: 'num' }, 'Market cap')
        ),
        DATA.live.map(function (r) {
          var growthClass = r.change_7d !== null && r.change_7d >= 0 ? ' pos' : ' neg';
          return el('div', { class: 'row', 'data-slug': r.slug },
            el('div', { class: 'cells live-cells' },
              el('div', { class: 'who' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.slug })),
              el('div', null, r.category || 'Other'),
              el('div', { class: 'num' }, fmtUsd(r.tvl_usd)),
              el('div', { class: 'num' + growthClass }, fmtPct(r.change_7d)),
              el('div', { class: 'num market' }, fmtUsd(r.mcap_usd))
            ));
        })
      ),
      el('p', { class: 'count', text: DATA.live.length + ' live-token protocols, largest market cap first' })
    );
  }

  function detailView() {
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === state.selected) r = x; });
    if (!r) return boardView();
    var steps = farmSteps(r);
    var mult = multipleOf(r);
    var months = monthsSince(r.listed_at);
    var facts = [
      ['Slug', r.slug],
      ['Category', r.category || 'Other'],
      ['Chains', r.chains && r.chains.length ? r.chains.join(', ') : 'none recorded'],
      ['TVL', fmtUsd(r.tvl_usd)],
      ['7-day change', fmtPct(r.change_7d)],
      ['Market cap', r.mcap_usd === null || r.mcap_usd === undefined ? 'none recorded' : fmtUsd(r.mcap_usd)],
      ['Listed at', r.listed_at || 'not recorded'],
      ['Age', (r.age_days === null || r.age_days === undefined ? 'unknown' : r.age_days + ' days') + (months !== null ? ' · ' + months + ' months' : '')],
      ['CoinGecko id', 'none recorded'],
      ['Token symbol', 'none recorded'],
      ['Rank', r.rank + ' of ' + DATA.board_size],
      ['Implied value', fmtUsd(r.implied_value_usd)]
    ];
    return el('section', { class: 'panel detail', 'data-slug': r.slug },
      el('button', { type: 'button', class: 'back', onclick: closeDetail }, '← Back to the board'),
      el('div', { class: 'detail-head' },
        el('span', { class: 'rank-badge', text: 'Rank ' + r.rank + ' · pre-token' }),
        el('h2', { text: r.name }),
        el('p', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.join(', ') : 'unnamed chain') })
      ),
      el('div', { class: 'facts' }, facts.map(function (f) { return el('div', { class: 'fact' }, el('span', { text: f[0] }), el('b', { text: String(f[1]) })); })),
      el('div', { class: 'why' },
        el('h3', { text: 'Why this value' }),
        el('p', { text: 'TVL ' + fmtUsd(r.tvl_usd) + ' x ~' + mult.toFixed(3) + 'x (the median market-cap/TVL of tokened ' + (r.category || 'Other') + ' comparators) x growth ' + r.growth_multiplier + ' x maturity ' + r.maturity_multiplier + ' = ~' + fmtUsd(Math.round(r.tvl_usd * mult * r.growth_multiplier * r.maturity_multiplier)) + '; the board reports ' + fmtUsd(r.implied_value_usd) + ' after rounding and the $1 tie-break. An estimate, never a price.' })
      ),
      el('div', { class: 'farm' },
        el('h3', { text: 'Farm plan' }),
        el('ol', { class: 'steps' }, steps.map(function (s) { return el('li', { text: s }); })),
        el('span', { class: 'sub', text: 'Costs and times are estimates for one small position. The plan records activity; it promises no airdrop.' })
      )
    );
  }

  function openDetail(slug) {
    state.selected = slug;
    state.open = null;
    setUrl();
    render();
    window.scrollTo(0, 0);
  }
  function closeDetail() {
    state.selected = null;
    setUrl();
    render();
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    if (state.selected) {
      shell.appendChild(detailView());
    } else {
      shell.appendChild(modelPanel());
      shell.appendChild(controls());
      shell.appendChild(state.tab === 'live' ? liveView() : boardView());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  render();
})();
