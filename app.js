(() => {
  'use strict';

  const VERSION = '2.1.0';
  const KEYS = { config: 'mt.config', data: 'mt.data' };
  const RECENT_ROWS = 8;
  const PAGE_SIZE = 150;
  const WATCHING_DAYS = 30;
  const AUTO_MATCH_LIMIT = 150; // titles matched in the background per app open
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal-root');
  const $toast = document.getElementById('toast');

  // ---------------------------------------------------------------------------
  // Storage (wrapped because browsers can refuse it)
  // ---------------------------------------------------------------------------
  function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }
  function forget(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

  let config = load(KEYS.config);
  const cached = load(KEYS.data);
  const state = {
    data: cached && cached.data ? cached.data : null,
    fetchedAt: cached && cached.fetchedAt ? cached.fetchedAt : null,
    syncing: false,
    syncError: null,
    needsAuth: false,
    lists: {},
    dashLimit: 30,
    idx: new Map(),
    showsCache: null,
  };

  function persist() { store(KEYS.data, { data: state.data, fetchedAt: state.fetchedAt }); }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString();
  const dec = n => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1));
  const blank = v => v === null || v === undefined || String(v).trim() === '';
  const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayISO() { return isoOf(new Date()); }
  function parseISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); }
  function daysBetween(a, b) {
    const da = parseISO(a), db = parseISO(b);
    return da && db ? Math.round((db - da) / 86400000) : null;
  }
  function fmtDate(s) {
    const d = parseISO(s);
    if (!d) return s || '';
    const str = MONTHS[d.getMonth()] + ' ' + d.getDate();
    return d.getFullYear() === new Date().getFullYear() ? str : str + ', ' + d.getFullYear();
  }
  function dayLabel(s) {
    const diff = daysBetween(s, todayISO());
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1 && diff < 7) return WEEKDAYS[parseISO(s).getDay()];
    return fmtDate(s);
  }
  function fmtMins(m) {
    if (blank(m)) return '';
    const h = Math.floor(m / 60), r = Math.round(m % 60);
    return h ? h + 'h ' + r + 'm' : r + 'm';
  }
  function fmtHours(m) { return m >= 60 ? num(Math.round(m / 60)) + ' hours' : Math.round(m) + ' min'; }
  function ago(ts) {
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm ago';
    if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
    return Math.floor(mins / 1440) + 'd ago';
  }
  const thisYear = () => String(new Date().getFullYear());
  const thisMonth = () => todayISO().slice(0, 7);

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------
  const SEC = {
    books:    { key: 'title', kind: 'book',  date: r => r.finished || r.started || '' },
    episodes: { key: 'show',  kind: 'show',  date: r => r.date || '' },
    shows:    { key: 'title', kind: 'show',  date: r => r.last || '' },
    movies:   { key: 'title', kind: 'movie', date: r => r.date || '' },
    drinks:   { key: 'date',  kind: null,    date: r => r.date || '' },
  };
  const COLOR = { book: 'books', show: 'tv', movie: 'movies' };

  function records(section) {
    if (section === 'shows') return showList();
    return (state.data && state.data[section]) || [];
  }

  function sortedDesc(section, list) {
    const getDate = SEC[section].date;
    return (list || records(section)).slice().sort((a, b) => {
      const da = getDate(a), db = getDate(b);
      if (da !== db) return da < db ? 1 : -1;
      return b._row - a._row;
    });
  }

  // ---------- matched info and pictures (App Data tab) ----------
  function buildIndex() {
    state.idx = new Map();
    ((state.data && state.data.appData) || []).forEach(e => state.idx.set(e.key, e));
    state.showsCache = null;
  }
  function appKey(kind, title) { return kind + '|' + norm(title); }
  function entryFor(kind, title) { return state.idx.get(appKey(kind, title)) || null; }
  function saveEntries(entries) {
    if (!state.data.appData) state.data.appData = [];
    entries.forEach(e => {
      const i = state.data.appData.findIndex(x => x.key === e.key);
      if (i >= 0) state.data.appData[i] = e; else state.data.appData.push(e);
    });
    buildIndex();
    persist();
  }

  function thumb(kind, title, size) {
    const e = kind ? entryFor(kind, title) : null;
    const cls = 'thumb ' + (size || 'sm');
    const letter = String(title || '?').trim().replace(/^(the|a|an)\s+/i, '').charAt(0).toUpperCase();
    if (e && e.image) return '<img class="' + cls + '" src="' + esc(e.image) + '" alt="" loading="lazy" decoding="async" data-c="' + (COLOR[kind] || 'drinks') + '" data-l="' + esc(letter) + '">';
    return '<span class="' + cls + ' ph ' + (COLOR[kind] || 'drinks') + '" aria-hidden="true">' + esc(letter) + '</span>';
  }

  // ---------- TV: stats worked out from the episode log ----------
  function epCode(r) { return 'S' + (blank(r.season) ? '?' : r.season) + ' E' + (blank(r.episode) ? '?' : r.episode); }
  function epLabel(eps) {
    const seasons = new Set(eps.map(e => e.season));
    const nums = eps.map(e => e.episode).filter(n => !blank(n)).sort((a, b) => a - b);
    if (seasons.size !== 1 || !nums.length) return eps.length === 1 ? epCode(eps[0]) : eps.length + ' episodes';
    const s = [...seasons][0], a = nums[0], b = nums[nums.length - 1];
    return 'S' + (blank(s) ? '?' : s) + ' E' + a + (b > a ? '-' + b : '');
  }

  function showList() {
    if (state.showsCache) return state.showsCache;
    const map = new Map();
    ((state.data && state.data.episodes) || []).forEach(r => {
      const k = norm(r.show);
      if (!k) return;
      let s = map.get(k);
      if (!s) { s = { key: k, title: String(r.show).trim(), first: '', last: '', lastEp: null, mins: 0, missing: 0, seen: new Set(), count: 0 }; map.set(k, s); }
      const d = r.date || '';
      if (d && (!s.first || d < s.first)) s.first = d;
      if (!s.lastEp || d > (s.lastEp.date || '') || (d === (s.lastEp.date || '') && r._row > s.lastEp._row)) { s.lastEp = r; s.title = String(r.show).trim(); }
      if (d && d > s.last) s.last = d;
      const code = !blank(r.season) && !blank(r.episode) ? r.season + 'x' + r.episode : null;
      if (!code || !s.seen.has(code)) { s.count++; if (code) s.seen.add(code); }
      if (Number(r.runtime) > 0) s.mins += Number(r.runtime); else s.missing++;
    });
    const cutoff = addDays(todayISO(), -WATCHING_DAYS);
    const list = [...map.values()].map((s, i) => {
      const e = entryFor('show', s.title);
      const info = (e && e.info) || {};
      const est = s.mins + (Number(info.runtime) > 0 ? s.missing * Number(info.runtime) : 0);
      let status;
      if (e && e.finished === 'Y') status = 'finished';
      else if (e && e.finished !== 'N' && info.ended && info.aired && s.count >= info.aired) status = 'finished';
      else if (s.last >= cutoff) status = 'watching';
      else status = 'paused';
      return Object.assign(s, {
        _row: i, info, status, est,
        estimated: s.missing > 0 && Number(info.runtime) > 0,
        aired: info.aired || null,
        days: status === 'finished' && s.first && s.last ? daysBetween(s.first, s.last) + 1 : null,
      });
    });
    state.showsCache = list;
    return list;
  }
  const STATUS_LABEL = { finished: 'Finished', watching: 'Watching', paused: 'On a break' };

  function groupEpisodes(list) {
    const map = new Map(), out = [];
    list.forEach(r => {
      const k = norm(r.show) + '|' + r.date;
      let g = map.get(k);
      if (!g) { g = { show: String(r.show).trim(), date: r.date, eps: [] }; map.set(k, g); out.push(g); }
      g.eps.push(r);
    });
    return out;
  }

  // Suggestions for text fields, most used first
  function suggestions(name) {
    const count = (vals) => {
      const m = new Map();
      vals.forEach(v => { const s = String(v || '').trim(); if (s) m.set(s, (m.get(s) || 0) + 1); });
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    };
    switch (name) {
      case 'shows': return sortedDesc('shows').map(s => s.title);
      case 'channels': return count(records('episodes').map(r => r.channel).concat(records('movies').map(r => r.channel)));
      case 'authors': return count(records('books').map(r => r.author));
      case 'series': return count(records('books').map(r => r.series));
      case 'bookGenres': return count(records('books').map(r => r.genre));
      case 'movieGenres': return count(records('movies').map(r => r.genre));
      case 'reasons': return count(records('drinks').map(r => r.reason));
      default: return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Talking to Apps Script
  // ---------------------------------------------------------------------------
  async function api(action, payload, cfg) {
    cfg = cfg || config;
    if (!navigator.onLine) throw new Error("You're offline. This needs a connection.");
    let res;
    try {
      // Plain-text body keeps this a "simple" request, so the browser skips the CORS preflight Apps Script can't answer.
      res = await fetch(cfg.url, { method: 'POST', body: JSON.stringify(Object.assign({ action, passcode: cfg.passcode }, payload || {})) });
    } catch (e) {
      throw new Error('Could not reach your Apps Script. Check your connection and the web app URL.');
    }
    let j;
    try { j = await res.json(); } catch (e) {
      throw new Error('Apps Script sent back something unexpected. Check the deployment has access set to "Anyone".');
    }
    if (!j.ok) { const err = new Error(j.error || 'Something went wrong.'); err.code = j.code; throw err; }
    return j;
  }

  async function sync(quiet) {
    if (state.syncing || !config) return;
    state.syncing = true;
    state.syncError = null;
    updateSyncLabel();
    let okSync = false;
    try {
      const j = await api('readAll');
      state.data = j.data;
      state.fetchedAt = Date.now();
      buildIndex();
      persist();
      okSync = true;
    } catch (e) {
      state.syncError = e.message;
      if (e.code === 'auth') state.needsAuth = true;
      if (!quiet || !state.data) toast(e.message, true);
    } finally {
      state.syncing = false;
      render();
    }
    if (okSync) autoMatch();
  }

  // Finds covers and posters for anything not matched yet, a small batch at a time, newest first.
  let autoRunning = false;
  async function autoMatch() {
    if (autoRunning || !state.data) return;
    autoRunning = true;
    const skip = new Set();
    let done = 0;
    try {
      while (done < AUTO_MATCH_LIMIT) {
        const queue = matchQueue(skip);
        const kinds = ['show', 'book', 'movie'].filter(k => queue[k].length);
        if (!kinds.length) break;
        let progressed = false;
        for (const kind of kinds) {
          const batch = queue[kind].slice(0, kind === 'show' ? 5 : 10);
          try {
            const j = await api('autoMatch', { kind, items: batch });
            saveEntries(j.entries);
            done += batch.length;
            progressed = true;
          } catch (e) {
            skip.add(kind); // e.g. no TMDB key yet: stop trying movies this session
          }
        }
        if (!progressed) break;
        if (!modalOpen && !isTyping()) render();
      }
    } finally {
      autoRunning = false;
    }
  }

  function matchQueue(skip) {
    const q = { book: [], movie: [], show: [] };
    const seen = new Set();
    const add = (kind, item) => {
      const k = appKey(kind, item.title);
      if (skip.has(kind) || !norm(item.title) || seen.has(k) || state.idx.has(k)) return;
      seen.add(k);
      q[kind].push(item);
    };
    sortedDesc('shows').forEach(s => add('show', { title: s.title, year: s.lastEp && s.lastEp.year }));
    sortedDesc('books').forEach(r => add('book', { title: String(r.title).trim(), author: r.author }));
    sortedDesc('movies').forEach(r => add('movie', { title: String(r.title).trim(), year: r.year }));
    return q;
  }

  function isTyping() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && $app.contains(a);
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------
  const TABS = [
    { id: 'dashboard', label: 'Dashboard', href: '#/' },
    { id: 'books', label: 'Books', href: '#/books' },
    { id: 'tv', label: 'TV', href: '#/tv' },
    { id: 'movies', label: 'Movies', href: '#/movies' },
    { id: 'drinks', label: 'Drinking', href: '#/drinks' },
  ];
  const LISTS = {
    'books/all': { section: 'books', tab: 'books', title: 'All books' },
    'tv/episodes': { section: 'episodes', tab: 'tv', title: 'All episodes' },
    'tv/shows': { section: 'shows', tab: 'tv', title: 'Shows' },
    'movies/all': { section: 'movies', tab: 'movies', title: 'All movies' },
    'drinks/all': { section: 'drinks', tab: 'drinks', title: 'All drinking' },
  };

  function route() {
    const path = location.hash.replace(/^#\/?/, '');
    if (LISTS[path]) return Object.assign({ path, list: true }, LISTS[path]);
    const m = /^tv\/episodes\/(.+)$/.exec(path);
    if (m) return Object.assign({ path, list: true, show: decodeURIComponent(m[1]) }, LISTS['tv/episodes']);
    const tab = TABS.some(t => t.id === path) ? path : 'dashboard';
    return { path, tab, list: false };
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  const ICONS = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  };

  function render() {
    if (!config || state.needsAuth) { renderSetup(); return; }
    const r = route();
    const focus = captureFocus();
    hideTip();
    $app.innerHTML = headerHTML(r) + '<main class="page' + (r.list ? ' wide' : '') + '">' + pageHTML(r) + '</main>';
    restoreFocus(focus);
    bindPage(r);
  }

  function headerHTML(r) {
    return '<header class="top"><div class="top-inner">' +
      '<button class="brand" data-go="#/" aria-label="Media tracker home">media<span>tracker</span></button>' +
      '<button class="sync" id="sync" data-act="sync"></button>' +
      '<button class="icon-btn" data-act="settings" aria-label="Settings">' + ICONS.gear + '</button>' +
      '<button class="btn primary small" data-act="add">+ Add</button>' +
      '</div><nav class="tabs" aria-label="Sections">' +
      TABS.map(t => '<button class="tab' + (t.id === r.tab ? ' active' : '') + '" data-go="' + t.href + '">' + t.label + '</button>').join('') +
      '</nav></header>';
  }

  function updateSyncLabel() {
    const el = document.getElementById('sync');
    if (!el) return;
    el.className = 'sync' + (state.syncing ? ' busy' : state.syncError ? ' bad' : '');
    el.textContent = state.syncing ? 'Syncing' : state.syncError ? 'Sync failed' : state.fetchedAt ? 'Synced ' + ago(state.fetchedAt) : 'Tap to sync';
    el.title = state.syncError || 'Refresh from your sheet';
  }

  function pageHTML(r) {
    if (!state.data) return '<p class="summary">' + (state.syncError ? esc(state.syncError) : 'Loading your sheet...') + '</p>';
    if (r.list) return listPageHTML(r);
    switch (r.tab) {
      case 'books': return booksHTML();
      case 'tv': return tvHTML();
      case 'movies': return moviesHTML();
      case 'drinks': return drinksHTML();
      default: return dashboardHTML();
    }
  }

  // Compact rows. cols: { k, label, w, fmt, cls, html }
  function rowsHTML(section, list, cols, opts) {
    opts = opts || {};
    const tpl = cols.map(c => c.w).join(' ');
    let h = '<div class="rows">';
    if (opts.head !== false) {
      h += '<div class="row head" style="grid-template-columns:' + tpl + '">' +
        cols.map(c => '<div class="cell' + (/\bnum\b/.test(c.cls || '') ? ' num' : '') + '">' + esc(c.label) + '</div>').join('') + '</div>';
    }
    if (!list.length) h += '<div class="empty">' + esc(opts.empty || 'Nothing here yet.') + '</div>';
    list.forEach(r => {
      const edit = opts.editOf ? opts.editOf(r) : section + ':' + r._row;
      h += '<button class="row" style="grid-template-columns:' + tpl + '" data-edit="' + esc(edit) + '">' +
        cols.map(c => {
          if (c.html) return '<div class="cell ' + (c.cls || '') + '">' + c.html(r) + '</div>';
          const v = c.fmt ? c.fmt(c.k ? r[c.k] : r, r) : r[c.k];
          return '<div class="cell ' + (c.cls || '') + '">' + esc(v) + '</div>';
        }).join('') + '</button>';
    });
    return h + '</div>';
  }

  function sectionHead(title, extra) {
    return '<div class="section-head"><h2>' + esc(title) + '</h2>' + (extra || '') + '</div>';
  }

  // ---------- Dashboard ----------
  function yearCounts(y, uptoMonthDay) {
    const inRange = d => d && d.startsWith(y) && (!uptoMonthDay || d.slice(5) <= uptoMonthDay);
    return {
      books: records('books').filter(r => inRange(r.finished)).length,
      episodes: records('episodes').filter(r => inRange(r.date)).length,
      movies: records('movies').filter(r => inRange(r.date)).length,
      drinks: records('drinks').filter(r => inRange(r.date)).reduce((s, r) => s + (Number(r.drinks) || 0), 0),
    };
  }

  function tilesHTML() {
    const y = thisYear(), prev = String(Number(y) - 1);
    const now = yearCounts(y);
    const then = yearCounts(prev, todayISO().slice(5));
    const hasPrev = then.books + then.episodes + then.movies + then.drinks > 0;
    const tile = (key, color, label, href) => {
      const diff = Math.round((now[key] - then[key]) * 10) / 10;
      const delta = !hasPrev ? '' : diff === 0 ? 'Same as ' + prev : Math.abs(diff) + (diff > 0 ? ' more than ' : ' fewer than ') + prev;
      return '<button class="tile" data-go="' + href + '"><span class="tile-num">' + (key === 'drinks' ? dec(now[key]) : num(now[key])) + '</span>' +
        '<span class="tile-label"><span class="dot ' + color + '"></span>' + label + '</span>' +
        (delta ? '<span class="tile-delta">' + esc(delta) + '</span>' : '') + '</button>';
    };
    return '<h1 class="year-title">' + y + ' so far</h1><div class="tiles">' +
      tile('books', 'books', 'Books', '#/books') +
      tile('episodes', 'tv', 'Episodes', '#/tv') +
      tile('movies', 'movies', 'Movies', '#/movies') +
      tile('drinks', 'drinks', 'Drinks', '#/drinks') + '</div>';
  }

  // Four small bar rows, one per section, so each has its own scale.
  function monthlyHTML() {
    const y = thisYear(), curMonth = new Date().getMonth();
    const rows = [
      { label: 'Books', key: 'books', color: 'books', vals: bucketMonths(records('books'), r => r.finished, () => 1, y) },
      { label: 'Episodes', key: 'episodes', color: 'tv', vals: bucketMonths(records('episodes'), r => r.date, () => 1, y) },
      { label: 'Movies', key: 'movies', color: 'movies', vals: bucketMonths(records('movies'), r => r.date, () => 1, y) },
      { label: 'Drinks', key: 'drinks', color: 'drinks', vals: bucketMonths(records('drinks'), r => r.date, r => Number(r.drinks) || 0, y) },
    ];
    let h = '<div class="chart months">';
    rows.forEach(row => {
      const max = Math.max(1, ...row.vals);
      h += '<div class="mrow"><span class="mlabel">' + row.label + '</span><div class="bars">' +
        row.vals.map((v, i) => {
          const future = i > curMonth;
          const pct = future ? 0 : Math.max(v ? 8 : 0, Math.round((v / max) * 100));
          const bar = '<span class="bar ' + row.color + (future ? ' future' : '') + (i === curMonth ? ' now' : '') + '" style="--h:' + pct + '%"></span>';
          return future ? '<span class="bcol">' + bar + '</span>' : '<span class="bcol" data-tip="m:' + row.key + ':' + i + '">' + bar + '</span>';
        }).join('') + '</div></div>';
    });
    h += '<div class="mrow axis"><span class="mlabel"></span><div class="bars">' + MONTHS.map(m => '<span>' + m.charAt(0) + '</span>').join('') + '</div></div></div>';
    return h;
  }
  function bucketMonths(list, dateOf, valOf, y) {
    const out = new Array(12).fill(0);
    list.forEach(r => { const d = dateOf(r); if (d && d.startsWith(y)) out[Number(d.slice(5, 7)) - 1] += valOf(r); });
    return out;
  }

  // A grid of days, darker the more you read and watched that day. Six months on phones, a year on wider screens.
  function heatmapHTML() {
    const counts = new Map();
    const bump = d => { if (d) counts.set(d, (counts.get(d) || 0) + 1); };
    records('episodes').forEach(r => bump(r.date));
    records('movies').forEach(r => bump(r.date));
    records('books').forEach(r => bump(r.finished));
    const weeks = window.innerWidth < 640 ? 26 : 53;
    const today = todayISO();
    const endSat = addDays(today, 6 - parseISO(today).getDay());
    const start = addDays(endSat, -(weeks * 7) + 1);
    const C = 12, S = 10;
    let rects = '', labels = '', lastMonth = -1, active = 0;
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const iso = addDays(start, w * 7 + d);
        if (iso > today) continue;
        const n = counts.get(iso) || 0;
        if (n) active++;
        const lvl = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;
        rects += '<rect x="' + (w * C) + '" y="' + (16 + d * C) + '" width="' + S + '" height="' + S + '" rx="2" class="l' + lvl + '" data-tip="d:' + iso + '"></rect>';
        if (d === 0) {
          const m = parseISO(addDays(iso, 6)).getMonth();
          if (m !== lastMonth && w < weeks - 2) { labels += '<text x="' + (w * C) + '" y="10">' + MONTHS[m] + '</text>'; lastMonth = m; }
        }
      }
    }
    const span = weeks === 26 ? 'the last 6 months' : 'the last year';
    return '<div class="chart heat"><svg viewBox="0 0 ' + (weeks * C) + ' ' + (16 + 7 * C) + '" role="img" aria-label="Activity over ' + span + '">' + labels + rects + '</svg>' +
      '<p class="chart-note">' + num(active) + ' days with a book, episode or movie in ' + span + '</p></div>';
  }

  function dashboardEvents() {
    const events = [];
    records('books').forEach(r => {
      if (r.finished) events.push({ date: r.finished, type: 'book', color: 'books', title: r.title, sub: 'Finished', edit: 'books:' + r._row, order: r._row });
      if (r.started && r.started !== r.finished) events.push({ date: r.started, type: 'book', color: 'books', title: r.title, sub: 'Started', edit: 'books:' + r._row, order: r._row });
    });
    groupEpisodes(sortedDesc('episodes').filter(r => r.date).slice(0, 600)).forEach(g => {
      events.push({ date: g.date, type: 'show', color: 'tv', title: g.show, sub: epLabel(g.eps), edit: 'show:' + norm(g.show), order: g.eps[0]._row });
    });
    records('movies').forEach(r => { if (r.date) events.push({ date: r.date, type: 'movie', color: 'movies', title: r.title, sub: 'Movie', edit: 'movies:' + r._row, order: r._row }); });
    records('drinks').forEach(r => {
      if (!r.date) return;
      const n = Number(r.drinks) || 0;
      events.push({ date: r.date, type: null, color: 'drinks', title: r.reason || 'Drinks', sub: dec(n) + (n === 1 ? ' drink' : ' drinks'), edit: 'drinks:' + r._row, order: r._row });
    });
    return events.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.order - a.order));
  }

  function bucketOf(date) {
    const today = todayISO();
    const dow = (parseISO(today).getDay() + 6) % 7; // Monday = 0
    const weekStart = addDays(today, -dow);
    if (date >= weekStart) return 'This week';
    if (date >= addDays(weekStart, -7)) return 'Last week';
    if (date.slice(0, 7) === today.slice(0, 7)) return 'Earlier this month';
    const d = parseISO(date);
    return MONTH_NAMES[d.getMonth()] + (date.slice(0, 4) === today.slice(0, 4) ? '' : ' ' + d.getFullYear());
  }

  function dashboardHTML() {
    const events = dashboardEvents();
    let list = '<div class="rows timeline">';
    let lastBucket = null;
    events.slice(0, state.dashLimit).forEach(e => {
      const b = bucketOf(e.date);
      if (b !== lastBucket) { list += '<div class="bucket">' + esc(b) + '</div>'; lastBucket = b; }
      const d = parseISO(e.date);
      const dateText = b === 'This week' || b === 'Last week' ? WEEKDAYS[d.getDay()].slice(0, 3) + ' ' + d.getDate() : MONTHS[d.getMonth()] + ' ' + d.getDate();
      list += '<button class="row event" data-edit="' + esc(e.edit) + '"><span class="when">' + esc(dateText) + '</span>' +
        thumb(e.type, e.title, 'xs') +
        '<span class="cell">' + esc(e.title) + '</span><span class="cell sub">' + esc(e.sub) + '</span></button>';
    });
    if (!events.length) list += '<div class="empty">Nothing logged yet. Tap + Add to log your first entry.</div>';
    list += '</div>';
    if (events.length > state.dashLimit) list += '<button class="link-btn" data-act="dashMore">Show more</button>';

    return tilesHTML() +
      sectionHead('Month by month') + monthlyHTML() +
      sectionHead('Day by day') + heatmapHTML() +
      sectionHead('Recent activity') + list;
  }

  // ---------- Section stats: this year and all time ----------
  function statsHTML(yearCells, allCells) {
    const cell = c => '<div class="stat"><span class="stat-num' + (c.text ? ' text' : '') + '">' + esc(c.v) + '</span><span class="stat-label">' + esc(c.l) + '</span></div>';
    return '<div class="stat-groups">' +
      '<div class="stat-group"><h3>This year</h3><div class="statgrid">' + yearCells.map(cell).join('') + '</div></div>' +
      '<div class="stat-group"><h3>All time</h3><div class="statgrid">' + allCells.map(cell).join('') + '</div></div></div>';
  }
  const inYear = d => (d || '').startsWith(thisYear());
  const hoursText = m => num(Math.round(m / 60));
  function topValue(vals) {
    const m = new Map();
    vals.forEach(v => { const s = String(v || '').trim(); if (s) m.set(s, (m.get(s) || 0) + 1); });
    let best = '', n = 0;
    m.forEach((c, k) => { if (c > n) { best = k; n = c; } });
    return best || '-';
  }
  function monthsSince(first) {
    const d = daysBetween(first, todayISO());
    return d == null ? 1 : Math.max(1, (d + 1) / 30.44);
  }
  // Run time from your sheet, or from the matched info when the sheet is blank
  function epMinutes(r) {
    if (Number(r.runtime) > 0) return Number(r.runtime);
    const e = entryFor('show', r.show);
    return e && Number((e.info || {}).runtime) > 0 ? Number(e.info.runtime) : 0;
  }
  function movieMinutes(r) {
    if (Number(r.runtime) > 0) return Number(r.runtime);
    const e = entryFor('movie', r.title);
    return e && Number((e.info || {}).runtime) > 0 ? Number(e.info.runtime) : 0;
  }

  // ---------- Books ----------
  function bookCells(list) {
    const days = list.map(r => Number(r.days)).filter(n => n > 0);
    return [
      { v: num(list.length), l: 'Books finished' },
      { v: num(list.reduce((s, r) => s + (Number(r.pages) || 0), 0)), l: 'Pages read' },
      { v: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : '-', l: 'Days per book' },
      { v: hoursText(list.reduce((s, r) => s + (Number(r.time) || 0), 0)), l: 'Hours listened' },
    ];
  }

  function booksHTML() {
    const all = records('books');
    const finished = all.filter(r => r.finished);
    const reading = sortedDesc('books', all.filter(r => r.started && !r.finished));
    const today = todayISO();

    let h = statsHTML(bookCells(finished.filter(r => inYear(r.finished))), bookCells(finished));

    h += sectionHead('Currently reading');
    h += '<div class="rows">';
    if (!reading.length) h += '<div class="empty">Nothing on the go. Add a book when you start one.</div>';
    reading.forEach(r => {
      const day = (daysBetween(r.started, today) || 0) + 1;
      h += '<div class="live-row">' + thumb('book', r.title, 'md') + '<button class="main" data-edit="books:' + r._row + '"><div class="title">' + esc(r.title) + '</div>' +
        '<div class="meta">' + esc([r.author, 'day ' + day].filter(Boolean).join(', ')) + '</div></button>' +
        '<button class="btn small" data-act="finishBook" data-row="' + r._row + '">Finished today</button></div>';
    });
    h += '</div>';

    h += sectionHead('Recently finished');
    h += rowsHTML('books', sortedDesc('books', finished).slice(0, RECENT_ROWS), [
      { label: '', w: '24px', html: r => thumb('book', r.title, 'xs') },
      { k: 'title', label: 'Title', w: 'minmax(0,2.2fr)', cls: 'strong' },
      { k: 'author', label: 'Author', w: 'minmax(0,1.3fr)', cls: 'muted' },
      { k: 'finished', label: 'Finished', w: '64px', fmt: fmtDate, cls: 'muted num' },
    ]);
    h += '<button class="link-btn" data-go="#/books/all">All books (' + num(all.length) + ')</button>';
    return h;
  }

  // ---------- TV ----------
  function tvCells(eps, shows) {
    return [
      { v: num(eps.length), l: 'Episodes' },
      { v: num(new Set(eps.map(r => norm(r.show))).size), l: 'Shows' },
      { v: hoursText(eps.reduce((s, r) => s + epMinutes(r), 0)), l: 'Hours watched' },
      { v: num(shows.filter(s => s.status === 'finished').length), l: 'Shows finished' },
    ];
  }

  function tvHTML() {
    const eps = records('episodes');
    const shows = sortedDesc('shows');
    const watching = shows.filter(s => s.status === 'watching');

    let h = statsHTML(tvCells(eps.filter(r => inYear(r.date)), shows.filter(s => inYear(s.last))), tvCells(eps, shows));

    h += sectionHead('Watching now');
    h += '<div class="rows">';
    if (!watching.length) h += '<div class="empty">Nothing in progress right now. Tap + Add to log an episode.</div>';
    watching.forEach(s => {
      const r = s.lastEp;
      const next = blank(r.episode) ? 'next' : 'E' + (Number(r.episode) + 1);
      const progress = s.aired ? ', ' + s.count + ' of ' + s.aired + ' eps' : '';
      h += '<div class="live-row">' + thumb('show', s.title, 'md') + '<button class="main" data-edit="show:' + esc(s.key) + '"><div class="title">' + esc(s.title) + '</div>' +
        '<div class="meta">' + esc(epCode(r) + ', ' + dayLabel(r.date) + progress) + '</div></button>' +
        '<button class="btn small" data-act="nextEp" data-show="' + esc(s.key) + '">Log ' + esc(next) + '</button></div>';
    });
    h += '</div>';

    h += sectionHead('Recent episodes');
    const groups = groupEpisodes(sortedDesc('episodes').slice(0, 200)).slice(0, RECENT_ROWS);
    h += rowsHTML('episodes', groups, [
      { label: '', w: '24px', html: g => thumb('show', g.show, 'xs') },
      { k: 'show', label: 'Show', w: 'minmax(0,2fr)', cls: 'strong' },
      { k: null, label: 'Episodes', w: 'minmax(0,1fr)', fmt: g => epLabel(g.eps), cls: 'muted' },
      { k: 'date', label: 'Date', w: '64px', fmt: fmtDate, cls: 'muted num' },
    ], { editOf: g => 'episodes:' + g.eps[0]._row });
    h += '<button class="link-btn" data-go="#/tv/shows">All shows (' + num(shows.length) + ')</button>' +
      '<span class="link-sep">|</span>' +
      '<button class="link-btn" data-go="#/tv/episodes">All episodes (' + num(eps.length) + ')</button>';
    return h;
  }

  // ---------- Movies ----------
  function movieCells(list, months) {
    return [
      { v: num(list.length), l: 'Movies' },
      { v: hoursText(list.reduce((s, r) => s + movieMinutes(r), 0)), l: 'Hours watched' },
      { v: (list.length / months).toFixed(1), l: 'Per month' },
      { v: topValue(list.map(r => r.channel)), l: 'Watched most on', text: true },
    ];
  }

  function moviesHTML() {
    const all = records('movies');
    const dated = all.map(r => r.date).filter(Boolean).sort();
    let h = statsHTML(movieCells(all.filter(r => inYear(r.date)), monthsSince(thisYear() + '-01-01')), movieCells(all, monthsSince(dated[0])));
    h += sectionHead('Recently watched');
    h += rowsHTML('movies', sortedDesc('movies').slice(0, RECENT_ROWS), [
      { label: '', w: '24px', html: r => thumb('movie', r.title, 'xs') },
      { k: 'title', label: 'Title', w: 'minmax(0,2.2fr)', cls: 'strong' },
      { k: 'channel', label: 'Where', w: 'minmax(0,1fr)', cls: 'muted' },
      { k: 'date', label: 'Date', w: '64px', fmt: fmtDate, cls: 'muted num' },
    ]);
    h += '<button class="link-btn" data-go="#/movies/all">All movies (' + num(all.length) + ')</button>';
    return h;
  }

  // ---------- Drinking ----------
  function drinkCells(list, days) {
    const total = list.reduce((s, r) => s + (Number(r.drinks) || 0), 0);
    const biggest = list.reduce((m, r) => Math.max(m, Number(r.drinks) || 0), 0);
    return [
      { v: dec(total), l: 'Drinks' },
      { v: (total / Math.max(1, days / 7)).toFixed(1), l: 'Per week' },
      { v: num(list.length), l: 'Nights' },
      { v: dec(biggest), l: 'Biggest night' },
    ];
  }

  function drinksHTML() {
    const all = records('drinks');
    const dated = all.map(r => r.date).filter(Boolean).sort();
    const today = todayISO();
    const yearDays = (daysBetween(thisYear() + '-01-01', today) || 0) + 1;
    const allDays = dated.length ? (daysBetween(dated[0], today) || 0) + 1 : 1;
    let h = statsHTML(drinkCells(all.filter(r => inYear(r.date)), yearDays), drinkCells(all, allDays));
    h += sectionHead('Recent');
    h += rowsHTML('drinks', sortedDesc('drinks').slice(0, RECENT_ROWS), [
      { k: 'date', label: 'Date', w: '64px', fmt: fmtDate, cls: 'muted' },
      { k: 'drinks', label: 'Drinks', w: '52px', fmt: v => (blank(v) ? '' : dec(Number(v))), cls: 'num' },
      { k: 'reason', label: 'Reason', w: 'minmax(0,1fr)', cls: 'strong' },
    ]);
    h += '<button class="link-btn" data-go="#/drinks/all">All entries (' + num(all.length) + ')</button>';
    return h;
  }

  // ---------- Full lists ----------
  const ALL_COLS = {
    books: [
      { label: '', w: '24px', html: r => thumb('book', r.title, 'xs') },
      { k: 'title', label: 'Title', w: 'minmax(200px,2fr)', cls: 'strong' },
      { k: 'author', label: 'Author', w: '150px', cls: 'muted' },
      { k: 'started', label: 'Started', w: '104px', fmt: fmtDate, cls: 'muted' },
      { k: 'finished', label: 'Finished', w: '104px', fmt: fmtDate, cls: 'muted' },
      { k: 'days', label: 'Days', w: '52px', cls: 'muted num' },
      { k: 'pages', label: 'Pages', w: '60px', cls: 'muted num' },
      { k: 'time', label: 'Time', w: '72px', fmt: fmtMins, cls: 'muted num' },
      { k: 'format', label: 'Format', w: '96px', cls: 'muted' },
      { k: 'genre', label: 'Genre', w: '150px', cls: 'muted' },
    ],
    episodes: [
      { k: 'show', label: 'Show', w: 'minmax(180px,2fr)', cls: 'strong' },
      { k: null, label: 'Episode', w: '80px', fmt: r => epCode(r), cls: 'muted' },
      { k: 'date', label: 'Date', w: '104px', fmt: fmtDate, cls: 'muted' },
      { k: 'runtime', label: 'Run time', w: '76px', fmt: fmtMins, cls: 'muted num' },
      { k: 'channel', label: 'Channel', w: '110px', cls: 'muted' },
      { k: 'year', label: 'Year', w: '52px', cls: 'muted num' },
    ],
    shows: [
      { label: '', w: '24px', html: s => thumb('show', s.title, 'xs') },
      { k: 'title', label: 'Show', w: 'minmax(180px,2fr)', cls: 'strong' },
      { k: 'status', label: 'Status', w: '92px', fmt: v => STATUS_LABEL[v], cls: 'muted' },
      { k: null, label: 'Episodes', w: '84px', fmt: s => s.count + (s.aired ? ' of ' + s.aired : ''), cls: 'muted num' },
      { k: 'first', label: 'Started', w: '104px', fmt: fmtDate, cls: 'muted' },
      { k: 'last', label: 'Last watched', w: '104px', fmt: fmtDate, cls: 'muted' },
      { k: 'est', label: 'Time', w: '72px', fmt: fmtMins, cls: 'muted num' },
    ],
    movies: [
      { label: '', w: '24px', html: r => thumb('movie', r.title, 'xs') },
      { k: 'title', label: 'Title', w: 'minmax(200px,2fr)', cls: 'strong' },
      { k: 'date', label: 'Date', w: '104px', fmt: fmtDate, cls: 'muted' },
      { k: 'channel', label: 'Where', w: '120px', cls: 'muted' },
      { k: 'runtime', label: 'Run time', w: '76px', fmt: fmtMins, cls: 'muted num' },
      { k: 'year', label: 'Year', w: '52px', cls: 'muted num' },
      { k: 'genre', label: 'Genre', w: '160px', cls: 'muted' },
    ],
    drinks: [
      { k: 'date', label: 'Date', w: '104px', fmt: fmtDate, cls: 'muted' },
      { k: 'drinks', label: 'Drinks', w: '56px', fmt: v => (blank(v) ? '' : dec(Number(v))), cls: 'num' },
      { k: 'reason', label: 'Reason', w: 'minmax(180px,1.4fr)', cls: 'strong' },
      { k: 'notes', label: 'Notes', w: 'minmax(180px,1.6fr)', cls: 'muted' },
    ],
  };
  const SORT_KEY = { books: 'title', episodes: 'show', shows: 'title', movies: 'title', drinks: 'reason' };
  const SEARCH_SKIP = new Set(['_row', 'seen', 'lastEp', 'info', 'key']);

  function listState(section) {
    if (!state.lists[section]) state.lists[section] = { q: '', sort: 'new', limit: PAGE_SIZE };
    return state.lists[section];
  }

  function filteredList(section, show) {
    const ls = listState(section);
    let list = records(section);
    if (show) list = list.filter(r => norm(r.show) === show);
    const terms = ls.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) {
      list = list.filter(r => {
        const hay = Object.keys(r).filter(k => !SEARCH_SKIP.has(k)).map(k => (k === 'status' ? STATUS_LABEL[r[k]] : r[k])).join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    if (ls.sort === 'az') {
      const k = SORT_KEY[section];
      return list.slice().sort((a, b) => String(a[k] || '').localeCompare(String(b[k] || '')) || a._row - b._row);
    }
    const desc = sortedDesc(section, list);
    return ls.sort === 'old' ? desc.reverse() : desc;
  }

  function listPageHTML(r) {
    const section = r.section, ls = listState(section);
    const list = filteredList(section, r.show);
    const cols = ALL_COLS[section];
    const onlyShow = r.show ? showList().find(s => s.key === r.show) : null;
    const minW = cols.reduce((s, c) => s + (parseInt(c.w.replace(/^minmax\(/, ''), 10) || 0) + 12, 12);
    const parent = TABS.find(t => t.id === r.tab).href;

    let h = '<div class="list-head"><button class="back" data-go="' + parent + '" aria-label="Back">' + ICONS.back + '</button><h1>' + esc(r.title) + '</h1></div>';
    if (r.tab === 'tv') {
      h += '<div class="segmented"><button class="' + (section === 'shows' ? 'on' : '') + '" data-go="#/tv/shows">Shows</button>' +
        '<button class="' + (section === 'episodes' ? 'on' : '') + '" data-go="#/tv/episodes">Episodes</button></div>';
    }
    h += '<div class="tools"><input id="list-search" type="search" placeholder="Search" value="' + esc(ls.q) + '" autocomplete="off">' +
      '<select id="list-sort" aria-label="Sort">' +
      [['new', 'Newest first'], ['old', 'Oldest first'], ['az', 'A to Z']].map(o => '<option value="' + o[0] + '"' + (ls.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
      '</select></div>';
    if (r.show) h += '<div class="chip">Only ' + esc(onlyShow ? onlyShow.title : r.show) + '<button data-go="#/tv/episodes" aria-label="Show all episodes">&times;</button></div>';
    h += '<p class="result-count">' + num(list.length) + ' ' + (list.length === 1 ? 'row' : 'rows') + '</p>';
    h += '<div class="table-wrap" style="--min-w:' + minW + 'px">' + rowsHTML(section, list.slice(0, ls.limit), cols, {
      empty: ls.q ? 'No matches.' : 'Nothing here yet.',
      editOf: section === 'shows' ? s => 'show:' + s.key : null,
    }) + '</div>';
    if (list.length > ls.limit) h += '<button class="btn more" data-act="more" data-section="' + section + '">Show more (' + num(list.length - ls.limit) + ' left)</button>';
    return h;
  }

  function bindPage(r) {
    updateSyncLabel();
    if (!r.list) return;
    const ls = listState(r.section);
    const search = document.getElementById('list-search');
    const sort = document.getElementById('list-sort');
    let t;
    if (search) search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { ls.q = search.value; ls.limit = PAGE_SIZE; render(); }, 150);
    });
    if (sort) sort.addEventListener('change', () => { ls.sort = sort.value; ls.limit = PAGE_SIZE; render(); });
  }

  function captureFocus() {
    const a = document.activeElement;
    if (!a || !a.id || !$app.contains(a)) return null;
    return { id: a.id, s: a.selectionStart, e: a.selectionEnd };
  }
  function restoreFocus(f) {
    if (!f) return;
    const el = document.getElementById(f.id);
    if (!el) return;
    el.focus();
    try { if (f.s != null) el.setSelectionRange(f.s, f.e); } catch (e) { /* some inputs don't support it */ }
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  function renderSetup() {
    const prev = config || {};
    $app.innerHTML = '<div class="setup"><span class="brand">media<span>tracker</span></span>' +
      '<p>' + (state.needsAuth ? 'Your sheet rejected the saved passcode. Enter it again to reconnect.' : 'Connect this device to your Google Sheet. You only need to do this once per device.') + '</p>' +
      '<form id="setup-form" novalidate>' +
      '<div class="field"><label for="s-url">Apps Script web app URL</label><input id="s-url" type="url" placeholder="https://script.google.com/macros/s/.../exec" value="' + esc(prev.url || '') + '" autocomplete="off"></div>' +
      '<div class="field"><label for="s-pass">Passcode</label><input id="s-pass" type="password" autocomplete="current-password"></div>' +
      '<div class="form-error" id="setup-error" hidden></div>' +
      '<button class="btn primary" type="submit" id="setup-btn">Connect</button>' +
      '<p class="setup-note">The first connection can take up to 30 seconds while Google wakes the script up.</p></form></div>';

    document.getElementById('setup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('s-url').value.trim();
      const passcode = document.getElementById('s-pass').value;
      const err = document.getElementById('setup-error');
      const btn = document.getElementById('setup-btn');
      err.hidden = true;
      if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
        err.textContent = 'The URL should start with https://script.google.com/ and end with /exec.';
        err.hidden = false; return;
      }
      if (!passcode) { err.textContent = 'Enter your passcode.'; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Connecting';
      try {
        const j = await api('ping', null, { url, passcode });
        config = { url, passcode, sheet: j.sheet };
        store(KEYS.config, config);
        state.needsAuth = false;
        state.syncError = null;
        render();
        toast('Connected to ' + j.sheet);
        sync();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        btn.disabled = false; btn.textContent = 'Connect';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Modal (Android back button closes it)
  // ---------------------------------------------------------------------------
  let modalOpen = false;

  function openModal(html, onMount, extraClass) {
    $modal.innerHTML = '<div class="overlay" data-overlay><div class="sheet' + (extraClass ? ' ' + extraClass : '') + '" role="dialog" aria-modal="true">' + html + '</div></div>';
    if (!modalOpen) { history.pushState({ modal: true }, ''); modalOpen = true; }
    if (onMount) onMount($modal.querySelector('.sheet'));
  }

  function closeModal(fromHistory) {
    if (!modalOpen) return;
    modalOpen = false;
    $modal.innerHTML = '';
    if (!fromHistory) history.back();
  }

  window.addEventListener('popstate', () => { if (modalOpen) closeModal(true); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalOpen && !document.querySelector('.ac:not([hidden])')) closeModal(); });
  $modal.addEventListener('click', e => { if (e.target.hasAttribute('data-overlay')) closeModal(); });

  const closeBtn = '<button class="close" data-act="close" aria-label="Close">&times;</button>';

  function openChooser() {
    const opt = (sec, color, title, sub) => '<button class="choice" data-act="choose" data-sec="' + sec + '"><span class="tag ' + color + '"></span><span>' + title + '<small>' + sub + '</small></span></button>';
    openModal('<div class="sheet-head"><h2>Add</h2>' + closeBtn + '</div><div class="choices">' +
      opt('books', 'books', 'Book', 'Started or finished a book') +
      opt('episodes', 'tv', 'Episodes', 'One episode or a batch') +
      opt('movies', 'movies', 'Movie', 'Something you watched') +
      opt('drinks', 'drinks', 'Drinks', 'A night out, or in') +
      '</div>');
  }

  function openSettings() {
    const matched = ((state.data && state.data.appData) || []).filter(e => e.image).length;
    openModal('<div class="sheet-head"><h2>Settings</h2>' + closeBtn + '</div>' +
      '<p class="summary settings-text">Connected to <b>' + esc(config.sheet || 'your sheet') + '</b>.' +
      (state.fetchedAt ? ' Last updated ' + ago(state.fetchedAt) + '.' : '') +
      ' <b>' + num(matched) + '</b> titles have pictures so far.</p>' +
      '<div class="form-actions plain">' +
      '<button class="btn" data-act="openFill">Fill in missing info</button>' +
      '<button class="btn" data-act="syncNow">Refresh from sheet</button>' +
      '<button class="btn" data-act="disconnect">Disconnect this device</button></div>' +
      '<p class="result-count" style="margin-top:18px">Version ' + VERSION + '</p>');
  }


  // ---------- Fill in missing info ----------
  const FILL_FIELDS = {
    books: [['author', 'Author'], ['year', 'Year published'], ['pages', 'Pages'], ['genre', 'Genre']],
    movies: [['runtime', 'Run time'], ['year', 'Release year'], ['genre', 'Genre']],
    episodes: [['runtime', 'Run time'], ['year', 'Year']],
  };

  function missingCounts() {
    const c = { books: {}, movies: {}, episodes: {}, showKeys: new Set() };
    Object.keys(FILL_FIELDS).forEach(s => FILL_FIELDS[s].forEach(([f]) => { c[s][f] = 0; }));
    const fromEntry = (section, kind, keyName) => records(section).forEach(r => {
      const e = entryFor(kind, r[keyName]);
      if (!e || e.source === 'none') return;
      FILL_FIELDS[section].forEach(([f]) => { if (blank(r[f]) && !blank((e.info || {})[f])) c[section][f]++; });
    });
    fromEntry('books', 'book', 'title');
    fromEntry('movies', 'movie', 'title');
    records('episodes').forEach(r => {
      const e = entryFor('show', r.show);
      if (!e || e.source !== 'tvmaze') return;
      if (blank(r.runtime)) { c.episodes.runtime++; c.showKeys.add(norm(r.show)); }
      if (blank(r.year)) { c.episodes.year++; c.showKeys.add(norm(r.show)); }
    });
    return c;
  }

  function openFill() {
    const c = missingCounts();
    const group = (section, title, upTo) => {
      const opts = FILL_FIELDS[section].filter(([f]) => c[section][f] > 0);
      if (!opts.length) return '<div class="fill-group"><h3>' + title + '</h3><p class="fill-none">Nothing to fill in.</p></div>';
      return '<div class="fill-group"><h3>' + title + '</h3>' + opts.map(([f, label]) =>
        '<label class="check"><input type="checkbox" name="' + section + '.' + f + '" data-n="' + c[section][f] + '" checked>' +
        '<span>' + label + '</span><span class="check-n">' + (upTo ? 'up to ' : '') + num(c[section][f]) + '</span></label>').join('') + '</div>';
    };
    openModal('<div class="sheet-head"><h2>Fill in missing info</h2>' + closeBtn + '</div>' +
      '<p class="fill-note">Fills empty cells in your sheet using the matched book, movie and show info. Anything you already typed stays as it is. TV uses the real run time and air date of each episode.</p>' +
      '<p class="fill-note">Wrong cover means wrong info, so fix any bad matches first.</p>' +
      group('books', 'Books') + group('movies', 'Movies') + group('episodes', 'TV episodes', true) +
      '<p class="lookup-msg" id="fill-progress" hidden></p>' +
      '<div class="form-actions"><button class="btn" data-act="close">Cancel</button><button class="btn primary" id="fill-go"></button></div>',
      sheet => {
        const go = sheet.querySelector('#fill-go');
        const boxes = [...sheet.querySelectorAll('input[type=checkbox]')];
        const update = () => {
          const n = boxes.filter(b => b.checked).reduce((s, b) => s + Number(b.dataset.n), 0);
          go.textContent = n ? 'Fill in ' + num(n) + ' cells' : 'Nothing selected';
          go.disabled = !n;
        };
        boxes.forEach(b => b.addEventListener('change', update));
        update();
        go.addEventListener('click', async () => {
          const sel = { books: [], movies: [], episodes: [] };
          boxes.filter(b => b.checked).forEach(b => { const [s, f] = b.name.split('.'); sel[s].push(f); });
          const prog = sheet.querySelector('#fill-progress');
          const say = t => { prog.hidden = false; prog.textContent = t; };
          go.disabled = true;
          boxes.forEach(b => { b.disabled = true; });
          let total = 0;
          try {
            if (sel.books.length) { say('Filling in books...'); total += (await api('fillMissing', { section: 'books', fields: sel.books })).result.filled; }
            if (sel.movies.length) { say('Filling in movies...'); total += (await api('fillMissing', { section: 'movies', fields: sel.movies })).result.filled; }
            if (sel.episodes.length) {
              const keys = [...c.showKeys];
              for (let i = 0; i < keys.length; i += 8) {
                say('Filling in TV, show ' + (i + 1) + ' of ' + keys.length + '...');
                total += (await api('fillMissing', { section: 'episodes', fields: sel.episodes, shows: keys.slice(i, i + 8) })).result.filled;
              }
            }
            say('Done. Reloading your sheet...');
            closeModal();
            toast('Filled in ' + num(total) + ' cells');
            sync(true);
          } catch (e) {
            say(e.message + (total ? ' (' + num(total) + ' cells were filled before this.)' : ''));
            prog.classList.add('bad');
            go.disabled = false;
          }
        });
      });
  }

  // ---------- Show details ----------
  function openShow(key) {
    const s = showList().find(x => x.key === key);
    if (!s) return;
    const info = s.info || {};
    const e = entryFor('show', s.title);
    const toggle = s.status === 'finished'
      ? '<button class="btn" data-act="setFinished" data-show="' + esc(key) + '" data-value="N">Mark as still watching</button>'
      : '<button class="btn" data-act="setFinished" data-show="' + esc(key) + '" data-value="Y">Mark finished</button>';
    const stat = (label, value) => '<div><dt>' + label + '</dt><dd>' + esc(value) + '</dd></div>';
    openModal('<div class="sheet-head"><h2>' + esc(s.title) + '</h2>' + closeBtn + '</div>' +
      '<div class="detail-head">' + thumb('show', s.title, 'lg') + '<div>' +
      '<span class="pill ' + s.status + '">' + STATUS_LABEL[s.status] + '</span>' +
      '<p class="detail-meta">' + esc([info.network, info.year, info.status === 'Ended' ? 'Ended' : info.status ? 'Still airing' : ''].filter(Boolean).join(', ')) + '</p>' +
      '<button class="link-btn" data-act="rematchShow" data-show="' + esc(key) + '">' + (e && e.image ? 'Wrong picture? Change it' : 'Find picture and info') + '</button>' +
      '</div></div>' +
      '<dl class="stats">' +
      stat('Started', fmtDate(s.first) || 'Unknown') +
      stat('Last watched', fmtDate(s.last) || 'Unknown') +
      stat('Episodes watched', s.count + (s.aired ? ' of ' + s.aired : '')) +
      stat('Time watched', fmtHours(s.est) + (s.estimated ? ' (some estimated)' : '')) +
      stat('Latest', epCode(s.lastEp)) +
      stat('Took', s.days ? s.days + ' days' : s.status === 'finished' ? 'Unknown' : 'Still going') +
      '</dl>' +
      '<div class="form-actions plain">' +
      '<button class="btn primary" data-act="nextEp" data-show="' + esc(key) + '">Log next episode</button>' + toggle +
      '<button class="btn" data-act="showEpisodes" data-show="' + esc(key) + '">See episodes</button></div>');
  }

  // Search panel used by "change picture" on a show
  function openRematch(kind, title, after) {
    openModal('<div class="sheet-head"><h2>Find a match</h2>' + closeBtn + '</div>' +
      '<div class="with-btn"><input id="rm-q" type="text" value="' + esc(title) + '" autocomplete="off"><button class="btn" id="rm-go" type="button">Search</button></div>' +
      '<div class="lookup-panel" id="rm-results"></div>',
      sheet => {
        const q = sheet.querySelector('#rm-q');
        const box = sheet.querySelector('#rm-results');
        const go = () => runLookup(box, kind, q.value, '', async cand => {
          const j = await api('match', { kind, title, candidate: cand });
          saveEntries([j.entry]);
          toast('Picture saved');
          render();
          after();
        });
        sheet.querySelector('#rm-go').addEventListener('click', go);
        q.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
        go();
      });
  }

  // Runs a search and shows the results as a pickable list
  async function runLookup(box, kind, query, author, onPick) {
    box.hidden = false;
    box.innerHTML = '<p class="lookup-msg">Searching...</p>';
    let results;
    try {
      results = (await api('search', { kind, query, author })).results;
    } catch (e) {
      box.innerHTML = '<p class="lookup-msg bad">' + esc(e.message) + '</p>';
      return;
    }
    if (!results.length) { box.innerHTML = '<p class="lookup-msg">No matches found. Try a shorter title.</p>'; return; }
    box.innerHTML = results.map((c, i) => '<button type="button" class="cand" data-i="' + i + '">' +
      (c.image ? '<img class="thumb md" src="' + esc(c.image) + '" alt="" loading="lazy">' : '<span class="thumb md ph ' + COLOR[kind] + '"></span>') +
      '<span><span class="cand-title">' + esc(c.title) + '</span><span class="cand-sub">' + esc([c.year, c.sub].filter(Boolean).join(', ')) + '</span></span></button>').join('');
    box.querySelectorAll('.cand').forEach(b => b.addEventListener('click', async () => {
      box.querySelectorAll('.cand').forEach(x => { x.disabled = true; });
      b.classList.add('picked');
      try { await onPick(results[Number(b.dataset.i)]); } catch (e) {
        box.insertAdjacentHTML('afterbegin', '<p class="lookup-msg bad">' + esc(e.message) + '</p>');
        box.querySelectorAll('.cand').forEach(x => { x.disabled = false; });
      }
    }));
  }

  // ---------------------------------------------------------------------------
  // Suggestions dropdown (replaces the browser's, which lingers)
  // ---------------------------------------------------------------------------
  function attachSuggest(input, items) {
    const box = document.createElement('div');
    box.className = 'ac';
    box.hidden = true;
    input.insertAdjacentElement('afterend', box);
    input.setAttribute('autocomplete', 'off');
    let hideTimer;
    const hide = () => { box.hidden = true; box.innerHTML = ''; };
    const update = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { hide(); return; }
      const starts = [], contains = [];
      for (const s of items) {
        const l = s.toLowerCase();
        if (l === q) { continue; }
        if (l.startsWith(q)) starts.push(s); else if (l.includes(q)) contains.push(s);
        if (starts.length >= 6) break;
      }
      const list = starts.concat(contains).slice(0, 6);
      if (!list.length) { hide(); return; }
      box.innerHTML = list.map(s => '<button type="button" class="ac-item" tabindex="-1">' + esc(s) + '</button>').join('');
      box.hidden = false;
    };
    input.addEventListener('input', e => { if (!e.isTrusted) return; update(); });
    input.addEventListener('blur', () => { hideTimer = setTimeout(hide, 180); });
    input.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) { e.stopPropagation(); hide(); } });
    box.addEventListener('pointerdown', e => e.preventDefault());
    box.addEventListener('click', e => {
      const b = e.target.closest('.ac-item');
      if (!b) return;
      clearTimeout(hideTimer);
      input.value = b.textContent;
      hide();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  // ---------------------------------------------------------------------------
  // Forms
  // ---------------------------------------------------------------------------
  const FORMS = {
    books: [
      { k: 'title', l: 'Title', t: 'text', req: true, lookup: true },
      { k: 'author', l: 'Author', t: 'text', list: 'authors' },
      { k: 'format', l: 'Format', t: 'select', opts: ['Physical', 'E-Book', 'Audio Book'], half: true },
      { k: 'library', l: 'Library book?', t: 'select', opts: ['No', 'Yes'], half: true },
      { k: 'started', l: 'Started', t: 'date', half: true },
      { k: 'finished', l: 'Finished', t: 'date', half: true },
      { k: 'pages', l: 'Pages', t: 'number', half: true },
      { k: 'time', l: 'Listening time', t: 'hm', half: true, hint: 'Audiobooks, like 12:05' },
      { k: 'year', l: 'Year published', t: 'number', half: true },
      { k: 'series', l: 'Series', t: 'text', list: 'series', half: true, hint: 'N if standalone' },
      { k: 'genre', l: 'Genre', t: 'text', list: 'bookGenres' },
      { k: 'thoughts', l: 'Thoughts and rating', t: 'textarea' },
      { k: 'days', l: 'Days to finish', t: 'ro' },
    ],
    episodes: [
      { k: 'show', l: 'Show', t: 'text', req: true, list: 'shows', lookup: true },
      { k: 'season', l: 'Season', t: 'number', half: true },
      { k: 'episode', l: 'Episode', t: 'number', half: true },
      { k: 'through', l: 'Through episode', t: 'number', half: true, addOnly: true, hint: 'Optional, logs a batch' },
      { k: 'date', l: 'Date watched', t: 'date', half: true },
      { k: 'runtime', l: 'Run time (minutes)', t: 'minutes', half: true },
      { k: 'year', l: 'Year of release', t: 'number', half: true },
      { k: 'channel', l: 'Channel', t: 'text', list: 'channels' },
    ],
    movies: [
      { k: 'title', l: 'Title', t: 'text', req: true, lookup: true },
      { k: 'date', l: 'Date watched', t: 'date', half: true },
      { k: 'runtime', l: 'Run time (minutes)', t: 'minutes', half: true },
      { k: 'channel', l: 'Where', t: 'text', list: 'channels', half: true },
      { k: 'year', l: 'Release year', t: 'number', half: true },
      { k: 'genre', l: 'Genre', t: 'text', list: 'movieGenres' },
      { k: 'thoughts', l: 'Thoughts and rating', t: 'textarea' },
    ],
    drinks: [
      { k: 'date', l: 'Date', t: 'date', req: true, half: true },
      { k: 'drinks', l: 'Drinks', t: 'number', step: '0.5', half: true },
      { k: 'reason', l: 'Reason', t: 'text', list: 'reasons' },
      { k: 'notes', l: 'Notes', t: 'text', hint: 'What you had, like 2 beers' },
    ],
  };

  // Which form fields each lookup can fill (only fills ones that are empty)
  const FILL = {
    books: { author: 'author', year: 'year', pages: 'pages', genre: 'genre' },
    movies: { runtime: 'runtime', year: 'year', genre: 'genre' },
    episodes: { runtime: 'runtime', year: 'year', channel: 'network' },
  };
  const FIELD_NAMES = { author: 'author', year: 'year', pages: 'pages', genre: 'genre', runtime: 'run time', channel: 'channel' };

  const ADD_LABELS = { books: 'Add book', episodes: 'Log episodes', movies: 'Add movie', drinks: 'Add drinks' };
  const ADDED_TOASTS = { books: 'Book added', movies: 'Movie added', drinks: 'Drinks added' };
  const TITLES = { books: 'book', episodes: 'episode', movies: 'movie', drinks: 'drinks' };

  function defaultsFor(section) {
    const today = todayISO();
    switch (section) {
      case 'books': {
        const last = sortedDesc('books')[0] || {};
        return { started: today, format: last.format || '', library: last.library || 'No' };
      }
      case 'drinks': return { date: today, drinks: 1 };
      default: return { date: today };
    }
  }

  function hmText(mins) { return blank(mins) ? '' : Math.floor(mins / 60) + ':' + pad(Math.round(mins % 60)); }
  function parseHM(s) {
    if (s === '') return '';
    let m = /^(\d+)(?::(\d{1,2}))?$/.exec(s);
    if (m) return Number(m[1]) * 60 + Number(m[2] || 0);
    m = /^(\d+)\s*h(?:\s*(\d+)\s*m?)?$/i.exec(s);
    if (m) return Number(m[1]) * 60 + Number(m[2] || 0);
    return NaN;
  }

  function fieldHTML(f, v) {
    const id = 'f-' + f.k;
    const cls = 'field' + (f.half ? ' half' : '');
    const label = '<label for="' + id + '">' + esc(f.l) + '</label>';
    const hint = f.hint ? '<span class="hint">' + esc(f.hint) + '</span>' : '';
    const val = blank(v) ? '' : v;
    let input;
    switch (f.t) {
      case 'ro':
        return '<div class="' + cls + '"><label>' + esc(f.l) + '</label><div class="readonly">' + esc(blank(v) ? 'Calculated by your sheet' : (f.fmt ? f.fmt(v) : v)) + '</div></div>';
      case 'textarea':
        input = '<textarea id="' + id + '" name="' + f.k + '">' + esc(val) + '</textarea>'; break;
      case 'select': {
        const opts = f.opts.slice();
        if (val !== '' && !opts.includes(val)) opts.push(val);
        input = '<select id="' + id + '" name="' + f.k + '"><option value=""></option>' +
          opts.map(o => '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
        break;
      }
      case 'date':
        input = '<input id="' + id + '" name="' + f.k + '" type="date" value="' + esc(val) + '">'; break;
      case 'number':
      case 'minutes':
        input = '<input id="' + id + '" name="' + f.k + '" type="number" inputmode="decimal" step="' + (f.step || 'any') + '" min="0" value="' + esc(val) + '">'; break;
      case 'hm':
        input = '<input id="' + id + '" name="' + f.k + '" type="text" inputmode="numeric" placeholder="H:MM" value="' + esc(hmText(v)) + '" autocomplete="off">'; break;
      default:
        input = '<input id="' + id + '" name="' + f.k + '" type="text" value="' + esc(val) + '" autocomplete="off">';
    }
    if (f.lookup) {
      return '<div class="' + cls + '">' + label + '<div class="with-btn"><div class="grow">' + input + '</div>' +
        '<button type="button" class="btn find-btn" data-act="lookup">Find info</button></div>' + hint +
        '<div class="lookup-panel" id="lookup-panel" hidden></div></div>';
    }
    return '<div class="' + cls + '">' + label + input + hint + '</div>';
  }

  function formMediaHTML(section, title) {
    const kind = SEC[section].kind;
    const e = kind && title ? entryFor(kind, title) : null;
    if (!e || !e.image) return '';
    const info = e.info || {};
    const bits = section === 'books' ? [info.author, info.year, info.pages ? info.pages + ' pages' : '']
      : section === 'movies' ? [info.year, info.runtime ? fmtMins(info.runtime) : '', info.genre]
      : [info.network, info.year, info.aired ? info.aired + ' episodes' : ''];
    return thumb(kind, title, 'md') + '<div class="media-text"><span class="media-title">Matched</span><span class="media-sub">' + esc(bits.filter(Boolean).join(', ')) + '</span></div>';
  }

  /**
   * Opens the add or edit form.
   * section: books | episodes | movies | drinks
   * rec: existing record to edit, or null to add
   * preset: values to prefill when adding
   */
  function openForm(section, rec, preset) {
    const isAdd = !rec;
    const fields = FORMS[section].filter(f => !(f.addOnly && !isAdd) && !(f.t === 'ro' && isAdd));
    const values = isAdd ? Object.assign(defaultsFor(section), preset || {}) : rec;
    const title = isAdd ? (section === 'episodes' ? 'Log episodes' : 'Add ' + TITLES[section]) : 'Edit ' + TITLES[section];
    const keyName = SEC[section].key;

    openModal(
      '<div class="sheet-head"><h2>' + esc(title) + '</h2>' + closeBtn + '</div>' +
      '<form id="rec-form" novalidate><div class="form-body">' +
      '<div class="form-media" id="form-media">' + formMediaHTML(section, values[keyName]) + '</div>' +
      '<div class="form-grid">' + fields.map(f => fieldHTML(f, values[f.k])).join('') + '</div>' +
      '<div class="form-error" id="form-error" hidden></div></div>' +
      '<div class="form-actions"><button type="button" class="btn" data-act="close">Cancel</button>' +
      '<button type="submit" class="btn primary" id="save-btn">' + (isAdd ? ADD_LABELS[section] : 'Save changes') + '</button></div></form>',
      sheet => {
        const form = sheet.querySelector('#rec-form');
        const dirty = new Set();
        form.addEventListener('input', e => { if (e.target.name) dirty.add(e.target.name); });
        fields.filter(f => f.list).forEach(f => attachSuggest(form.elements[f.k], suggestions(f.list)));
        if (isAdd && section === 'episodes') wireEpisodeAutofill(form, dirty);
        const keyInput = form.elements[keyName];
        if (keyInput && SEC[section].kind) {
          keyInput.addEventListener('change', () => {
            const val = keyInput.value.trim();
            sheet.querySelector('#form-media').innerHTML = formMediaHTML(section, val);
            if (val.length < 2) return;
            const e = entryFor(SEC[section].kind, val);
            if (e && e.source !== 'none') {
              const filled = fillFromEntry(section, form, e);
              if (filled.length) toast('Filled in ' + filled.join(', '));
            } else if (isAdd && !(section === 'episodes' && showList().some(s => s.key === norm(val)))) {
              startLookup(section, form, sheet); // new title: show likely matches right away
            }
          });
        }
        const findBtn = form.querySelector('[data-act=lookup]');
        if (findBtn) findBtn.addEventListener('click', ev => { ev.stopPropagation(); startLookup(section, form, sheet); });
        form.addEventListener('submit', e => { e.preventDefault(); submitForm(section, rec, fields, form); });
        if (isAdd) {
          const first = form.querySelector('input[type=text]');
          if (first && !first.value) first.focus();
        }
      },
      'form-sheet'
    );
  }

  function startLookup(section, form, sheet) {
    const kind = SEC[section].kind;
    const keyName = SEC[section].key;
    const title = form.elements[keyName].value.trim();
    const box = form.querySelector('#lookup-panel');
    if (!title) { box.hidden = false; box.innerHTML = '<p class="lookup-msg bad">Type a title first.</p>'; return; }
    const author = form.elements.author ? form.elements.author.value.trim() : '';
    runLookup(box, kind, title, author, async cand => {
      const j = await api('match', { kind, title, candidate: cand });
      saveEntries([j.entry]);
      const filled = fillFromEntry(section, form, j.entry);
      box.hidden = true;
      box.innerHTML = '';
      sheet.querySelector('#form-media').innerHTML = formMediaHTML(section, title);
      toast(filled.length ? 'Filled in ' + filled.join(', ') : 'Picture saved');
      render();
    });
  }

  function fillFromEntry(section, form, entry) {
    const info = (entry && entry.info) || {};
    const filled = [];
    Object.keys(FILL[section] || {}).forEach(field => {
      const el = form.elements[field];
      const v = info[FILL[section][field]];
      if (el && !el.value.trim() && !blank(v)) { el.value = v; filled.push(FIELD_NAMES[field]); }
    });
    return filled;
  }

  // Picking a show fills in the next episode, and copies season, run time, year and channel from your last entry
  // (or from the matched show info if you haven't logged it before).
  function wireEpisodeAutofill(form, dirty) {
    const showInput = form.elements.show;
    const set = (name, v) => { const el = form.elements[name]; if (el && !dirty.has(name) && !blank(v)) el.value = v; };
    const fill = () => {
      const s = showList().find(x => x.key === norm(showInput.value));
      const e = entryFor('show', showInput.value);
      const info = (e && e.info) || {};
      if (s) {
        const last = s.lastEp;
        set('season', last.season);
        set('episode', blank(last.episode) ? '' : Number(last.episode) + 1);
        set('runtime', blank(last.runtime) ? info.runtime : last.runtime);
        set('year', blank(last.year) ? info.year : last.year);
        set('channel', blank(last.channel) ? info.network : last.channel);
      } else if (e) {
        set('runtime', info.runtime); set('year', info.year); set('channel', info.network);
      }
    };
    showInput.addEventListener('change', fill);
  }

  function collect(fields, form) {
    const out = {};
    for (const f of fields) {
      if (f.t === 'ro') continue;
      const el = form.elements[f.k];
      if (!el) continue;
      const raw = el.value.trim();
      let v = raw;
      if (f.t === 'number' || f.t === 'minutes') {
        v = raw === '' ? '' : Number(raw);
        if (Number.isNaN(v)) throw new Error(f.l + ' needs to be a number.');
      } else if (f.t === 'hm') {
        v = parseHM(raw);
        if (Number.isNaN(v)) throw new Error(f.l + ' should look like 12:05 (hours:minutes).');
      }
      if (f.req && v === '') throw new Error(f.l + ' is required.');
      out[f.k] = v;
    }
    return out;
  }

  async function submitForm(section, rec, fields, form) {
    const btn = form.querySelector('#save-btn');
    const errEl = form.querySelector('#form-error');
    const label = btn.textContent;
    errEl.hidden = true;
    let values;
    try { values = collect(fields, form); } catch (e) { errEl.textContent = e.message; errEl.hidden = false; return; }

    let changes = values;
    if (rec) {
      changes = {};
      Object.keys(values).forEach(k => {
        const before = blank(rec[k]) ? '' : String(rec[k]);
        const after = values[k] === '' ? '' : String(values[k]);
        if (before !== after) changes[k] = values[k];
      });
      if (!Object.keys(changes).length) { closeModal(); toast('No changes to save'); return; }
    }

    btn.disabled = true; btn.textContent = 'Saving';
    try {
      if (!rec && section === 'episodes') {
        const j = await api('addEpisodes', { record: values });
        state.data.episodes.push(...j.records);
        toast(j.records.length === 1 ? 'Episode logged' : j.records.length + ' episodes logged');
      } else if (!rec) {
        const j = await api('add', { section, record: values });
        state.data[section].push(j.record);
        toast(ADDED_TOASTS[section]);
      } else {
        const j = await api('update', { section, row: rec._row, check: rec[SEC[section].key], record: changes });
        const i = state.data[section].findIndex(r => r._row === rec._row);
        if (i >= 0) state.data[section][i] = j.record;
        toast('Changes saved');
      }
      state.showsCache = null;
      persist();
      closeModal();
      render();
      autoMatch();
    } catch (e) {
      errEl.textContent = e.message; errEl.hidden = false;
      btn.disabled = false; btn.textContent = label;
    }
  }

  async function finishBook(row) {
    const rec = records('books').find(r => r._row === row);
    if (!rec) return;
    try {
      const j = await api('update', { section: 'books', row, check: rec.title, record: { finished: todayISO() } });
      const i = state.data.books.findIndex(r => r._row === row);
      if (i >= 0) state.data.books[i] = j.record;
      persist();
      toast('Marked ' + String(rec.title).trim() + ' finished');
    } catch (e) { toast(e.message, true); }
    render();
  }


  // ---------------------------------------------------------------------------
  // Chart details: hover on a computer, tap on a phone
  // ---------------------------------------------------------------------------
  const $tip = document.createElement('div');
  $tip.id = 'tip';
  $tip.hidden = true;
  document.body.appendChild($tip);
  let tipTarget = null;

  const UNITS = { books: ['book', 'books'], episodes: ['episode', 'episodes'], movies: ['movie', 'movies'], drinks: ['drink', 'drinks'] };
  const unit = (type, n) => dec(n) + ' ' + UNITS[type][n === 1 ? 0 : 1];

  function periodItems(inPeriod, types) {
    const lines = [], totals = {};
    if (types.includes('books')) {
      const list = records('books').filter(r => inPeriod(r.finished));
      totals.books = list.length;
      list.forEach(r => lines.push({ c: 'books', t: r.title, s: 'Finished' }));
    }
    if (types.includes('episodes')) {
      const list = records('episodes').filter(r => inPeriod(r.date));
      totals.episodes = list.length;
      const byShow = new Map();
      list.forEach(r => { const k = norm(r.show); const g = byShow.get(k) || { t: String(r.show).trim(), eps: [] }; g.eps.push(r); byShow.set(k, g); });
      [...byShow.values()].sort((a, b) => b.eps.length - a.eps.length)
        .forEach(g => lines.push({ c: 'tv', t: g.t, s: g.eps.length > 2 ? g.eps.length + ' episodes' : epLabel(g.eps) }));
    }
    if (types.includes('movies')) {
      const list = records('movies').filter(r => inPeriod(r.date));
      totals.movies = list.length;
      list.forEach(r => lines.push({ c: 'movies', t: r.title, s: r.channel || 'Movie' }));
    }
    if (types.includes('drinks')) {
      const list = sortedDesc('drinks', records('drinks').filter(r => inPeriod(r.date))).reverse();
      totals.drinks = list.reduce((s, r) => s + (Number(r.drinks) || 0), 0);
      list.forEach(r => lines.push({ c: 'drinks', t: r.reason || 'Drinks', s: fmtDate(r.date) + ', ' + unit('drinks', Number(r.drinks) || 0) }));
    }
    return { lines, totals };
  }

  function tipHTML(spec) {
    const [kind, a, b] = spec.split(':');
    let head, types, inPeriod;
    if (kind === 'm') {
      const prefix = thisYear() + '-' + pad(Number(b) + 1);
      head = MONTH_NAMES[Number(b)];
      types = [a];
      inPeriod = d => (d || '').startsWith(prefix);
    } else {
      const d = parseISO(a);
      head = WEEKDAYS[d.getDay()] + ', ' + fmtDate(a);
      types = ['books', 'episodes', 'movies'];
      inPeriod = x => x === a;
    }
    const { lines, totals } = periodItems(inPeriod, types);
    const sum = types.filter(t => totals[t]).map(t => unit(t, totals[t])).join(', ') || 'Nothing logged';
    const shown = lines.slice(0, 8);
    return '<div class="tip-head">' + esc(head) + '</div><div class="tip-sum">' + esc(sum) + '</div>' +
      (shown.length ? '<ul>' + shown.map(l => '<li><span class="dot ' + l.c + '"></span><span class="tip-t">' + esc(l.t) + '</span><span class="tip-s">' + esc(l.s) + '</span></li>').join('') + '</ul>' : '') +
      (lines.length > shown.length ? '<div class="tip-more">and ' + (lines.length - shown.length) + ' more</div>' : '');
  }

  function showTip(el) {
    if (tipTarget) tipTarget.classList.remove('tip-on');
    tipTarget = el;
    el.classList.add('tip-on');
    $tip.innerHTML = tipHTML(el.getAttribute('data-tip'));
    $tip.hidden = false;
    const r = el.getBoundingClientRect(), w = $tip.offsetWidth, h = $tip.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let top = r.top - h - 10;
    if (top < 8) top = r.bottom + 10;
    $tip.style.left = left + 'px';
    $tip.style.top = top + 'px';
  }

  function hideTip() {
    if (tipTarget) tipTarget.classList.remove('tip-on');
    tipTarget = null;
    $tip.hidden = true;
  }

  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t && t !== tipTarget) showTip(t);
  });
  document.addEventListener('pointerout', e => {
    if (e.pointerType !== 'mouse') return;
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) hideTip();
  });
  window.addEventListener('scroll', hideTip, { passive: true });

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  let toastTimer;
  function toast(msg, bad) {
    $toast.textContent = msg;
    $toast.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $toast.className = ''; }, bad ? 5000 : 2600);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  const ACTIONS = {
    sync: () => sync(),
    syncNow: () => { closeModal(); sync(); },
    openFill: () => openFill(),
    settings: () => openSettings(),
    close: () => closeModal(),
    add: () => {
      const r = route();
      if (r.list) return openForm(r.section === 'shows' ? 'episodes' : r.section, null);
      const map = { books: 'books', tv: 'episodes', movies: 'movies', drinks: 'drinks' };
      if (map[r.tab]) openForm(map[r.tab], null); else openChooser();
    },
    choose: el => openForm(el.dataset.sec, null),
    more: el => { listState(el.dataset.section).limit += PAGE_SIZE * 2; render(); },
    dashMore: () => { state.dashLimit += 30; render(); },
    finishBook: el => { el.disabled = true; el.textContent = 'Saving'; finishBook(Number(el.dataset.row)); },
    nextEp: el => {
      const s = showList().find(x => x.key === el.dataset.show);
      if (!s) return;
      const last = s.lastEp, info = s.info || {};
      openForm('episodes', null, {
        show: s.title, season: last.season,
        episode: blank(last.episode) ? '' : Number(last.episode) + 1,
        runtime: blank(last.runtime) ? info.runtime : last.runtime,
        year: blank(last.year) ? info.year : last.year,
        channel: blank(last.channel) ? info.network : last.channel,
      });
    },
    setFinished: async el => {
      const s = showList().find(x => x.key === el.dataset.show);
      if (!s) return;
      el.disabled = true;
      try {
        const j = await api('setShowFinished', { title: s.title, value: el.dataset.value });
        saveEntries([j.entry]);
        toast(el.dataset.value === 'Y' ? 'Marked finished' : 'Marked as still watching');
        render();
        openShow(s.key);
      } catch (e) { toast(e.message, true); el.disabled = false; }
    },
    rematchShow: el => {
      const s = showList().find(x => x.key === el.dataset.show);
      if (s) openRematch('show', s.title, () => openShow(s.key));
    },
    showEpisodes: el => {
      const s = showList().find(x => x.key === el.dataset.show);
      if (!s) return;
      listState('episodes').q = '';
      modalOpen = false;
      $modal.innerHTML = '';
      location.replace('#/tv/episodes/' + encodeURIComponent(s.key)); // replaces the card's history entry instead of going back
    },
    disconnect: () => {
      if (!confirm('Disconnect this device? Your sheet is not affected. You would just enter the URL and passcode again.')) return;
      closeModal();
      forget(KEYS.config); forget(KEYS.data);
      config = null; state.data = null; state.fetchedAt = null; buildIndex();
      render();
    },
  };

  document.addEventListener('click', e => {
    const tipEl = e.target.closest('[data-tip]');
    if (tipEl) { if (tipEl === tipTarget && e.pointerType !== 'mouse' && !$tip.hidden) hideTip(); else showTip(tipEl); return; }
    if (!e.target.closest('#tip')) hideTip();
    const t = e.target.closest('[data-go],[data-edit],[data-act]');
    if (!t) return;
    if (t.dataset.go) {
      const current = location.hash || '#/';
      if (current === t.dataset.go) render();
      else location.hash = t.dataset.go;
      return;
    }
    if (t.dataset.edit) {
      const edit = t.dataset.edit;
      const cut = edit.indexOf(':');
      const section = edit.slice(0, cut), id = edit.slice(cut + 1);
      if (section === 'show') { openShow(id); return; }
      const rec = records(section).find(r => r._row === Number(id));
      if (rec) openForm(section, rec);
      return;
    }
    const fn = ACTIONS[t.dataset.act];
    if (fn) fn(t);
  });

  // If a cover can't load (offline, dead link), swap in the coloured letter tile
  document.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('thumb') || !img.dataset.c) return;
    const span = document.createElement('span');
    span.className = img.className + ' ph ' + img.dataset.c;
    span.textContent = img.dataset.l || '';
    img.replaceWith(span);
  }, true);

  window.addEventListener('hashchange', () => {
    if (modalOpen) { modalOpen = false; $modal.innerHTML = ''; }
    window.scrollTo(0, 0);
    render();
  });

  // Refresh when you come back to the app after a while
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && config && !state.needsAuth && (!state.fetchedAt || Date.now() - state.fetchedAt > 5 * 60000)) sync(true);
  });
  setInterval(updateSyncLabel, 60000);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* app still works without it */ });
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  buildIndex();
  render();
  if (config) sync(!!state.data);
})();
