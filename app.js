(() => {
  'use strict';

  const VERSION = '1.0.0';
  const KEYS = { config: 'mt.config', data: 'mt.data' };
  const RECENT_ROWS = 8;
  const PAGE_SIZE = 150;
  const WATCHING_DAYS = 30;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

  function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayISO() { return isoOf(new Date()); }
  function parseISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
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
  function ago(ts) {
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
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
    books:    { key: 'title', date: r => r.finished || r.started || '' },
    episodes: { key: 'show',  date: r => r.date || '' },
    shows:    { key: 'show',  date: r => r.finished || r.started || '' },
    movies:   { key: 'title', date: r => r.date || '' },
    drinks:   { key: 'date',  date: r => r.date || '' },
  };

  function records(section) { return (state.data && state.data[section]) || []; }

  function sortedDesc(section, list) {
    const getDate = SEC[section].date;
    return (list || records(section)).slice().sort((a, b) => {
      const da = getDate(a), db = getDate(b);
      if (da !== db) return da < db ? 1 : -1;
      return b._row - a._row;
    });
  }

  function showKey(s) { return String(s || '').trim().toLowerCase(); }

  function lastEpisodeByShow() {
    const map = new Map();
    records('episodes').forEach(r => {
      const k = showKey(r.show);
      const cur = map.get(k);
      if (!cur || (r.date || '') > (cur.date || '') || ((r.date || '') === (cur.date || '') && r._row > cur._row)) map.set(k, r);
    });
    return map;
  }

  function groupEpisodes(list) {
    const map = new Map(), out = [];
    list.forEach(r => {
      const k = showKey(r.show) + '|' + r.date;
      let g = map.get(k);
      if (!g) { g = { show: String(r.show).trim(), date: r.date, eps: [] }; map.set(k, g); out.push(g); }
      g.eps.push(r);
    });
    return out;
  }

  function epCode(r) { return 'S' + (blank(r.season) ? '?' : r.season) + ' E' + (blank(r.episode) ? '?' : r.episode); }
  function epLabel(eps) {
    const seasons = new Set(eps.map(e => e.season));
    const nums = eps.map(e => e.episode).filter(n => !blank(n)).sort((a, b) => a - b);
    if (seasons.size !== 1 || !nums.length) return eps.length === 1 ? epCode(eps[0]) : eps.length + ' episodes';
    const s = [...seasons][0], a = nums[0], b = nums[nums.length - 1];
    return 'S' + (blank(s) ? '?' : s) + ' E' + a + (b > a ? '-' + b : '');
  }

  // Suggestions for text fields, most used first
  function suggestions(name) {
    const count = (vals) => {
      const m = new Map();
      vals.forEach(v => { const s = String(v || '').trim(); if (s) m.set(s, (m.get(s) || 0) + 1); });
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 60);
    };
    switch (name) {
      case 'shows': {
        const seen = new Set(), out = [];
        sortedDesc('episodes').concat(records('shows')).forEach(r => {
          const s = String(r.show || '').trim(), k = s.toLowerCase();
          if (s && !seen.has(k)) { seen.add(k); out.push(s); }
        });
        return out;
      }
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
    try {
      const j = await api('readAll');
      state.data = j.data;
      state.fetchedAt = Date.now();
      persist();
    } catch (e) {
      state.syncError = e.message;
      if (e.code === 'auth') state.needsAuth = true;
      if (!quiet || !state.data) toast(e.message, true);
    } finally {
      state.syncing = false;
      render();
    }
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
    el.textContent = state.syncing ? 'Syncing' : state.syncError ? 'Sync failed' : state.fetchedAt ? 'Synced ' + ago(state.fetchedAt).replace('just now', 'now') : 'Tap to sync';
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

  // Compact rows. cols: { k, label, w, fmt, cls }
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
      h += '<button class="row" style="grid-template-columns:' + tpl + '" data-edit="' + edit + '">' +
        cols.map(c => {
          const v = c.fmt ? c.fmt(c.k ? r[c.k] : r, r) : r[c.k];
          return '<div class="cell ' + (c.cls || '') + '">' + esc(v) + '</div>';
        }).join('') + '</button>';
    });
    return h + '</div>';
  }

  function sectionHead(title) {
    return '<div class="section-head"><h2>' + esc(title) + '</h2></div>';
  }

  // ---------- Dashboard ----------
  function dashboardHTML() {
    const y = thisYear();
    const booksYr = records('books').filter(r => (r.finished || '').startsWith(y)).length;
    const epsYr = records('episodes').filter(r => (r.date || '').startsWith(y)).length;
    const moviesYr = records('movies').filter(r => (r.date || '').startsWith(y)).length;
    const drinksYr = records('drinks').filter(r => (r.date || '').startsWith(y)).reduce((s, r) => s + (Number(r.drinks) || 0), 0);

    const events = [];
    records('books').forEach(r => {
      if (r.finished) events.push({ date: r.finished, type: 'books', title: r.title, sub: 'Finished', edit: 'books:' + r._row, order: r._row });
      if (r.started && r.started !== r.finished) events.push({ date: r.started, type: 'books', title: r.title, sub: 'Started', edit: 'books:' + r._row, order: r._row });
    });
    groupEpisodes(sortedDesc('episodes').filter(r => r.date).slice(0, 400)).forEach(g => {
      events.push({ date: g.date, type: 'tv', title: g.show, sub: epLabel(g.eps), edit: 'episodes:' + g.eps[0]._row, order: g.eps[0]._row });
    });
    records('movies').forEach(r => { if (r.date) events.push({ date: r.date, type: 'movies', title: r.title, sub: r.channel || 'Movie', edit: 'movies:' + r._row, order: r._row }); });
    records('drinks').forEach(r => {
      if (!r.date) return;
      const n = Number(r.drinks) || 0;
      events.push({ date: r.date, type: 'drinks', title: r.reason || 'Drinks', sub: dec(n) + (n === 1 ? ' drink' : ' drinks'), edit: 'drinks:' + r._row, order: r._row });
    });
    events.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.order - a.order));

    const typeNames = { books: 'Book', tv: 'TV', movies: 'Movie', drinks: 'Drinking' };
    let timeline = '<div class="rows timeline">';
    let lastDay = null;
    events.slice(0, 24).forEach(e => {
      if (e.date !== lastDay) { timeline += '<div class="day">' + esc(dayLabel(e.date)) + '</div>'; lastDay = e.date; }
      timeline += '<button class="row event" data-edit="' + e.edit + '"><span class="dot ' + e.type + '" title="' + typeNames[e.type] + '"></span>' +
        '<span class="cell">' + esc(e.title) + '</span><span class="cell sub">' + esc(e.sub) + '</span></button>';
    });
    if (!events.length) timeline += '<div class="empty">Nothing logged yet. Tap + Add to log your first entry.</div>';
    timeline += '</div>';

    return '<p class="summary">' + y + ' so far: ' +
      '<button data-go="#/books"><b>' + num(booksYr) + '</b></button> books, ' +
      '<button data-go="#/tv"><b>' + num(epsYr) + '</b></button> episodes, ' +
      '<button data-go="#/movies"><b>' + num(moviesYr) + '</b></button> movies and ' +
      '<button data-go="#/drinks"><b>' + dec(drinksYr) + '</b></button> drinks.</p>' +
      sectionHead('Recent activity') + timeline;
  }

  // ---------- Books ----------
  function booksHTML() {
    const y = thisYear(), all = records('books');
    const finished = all.filter(r => r.finished);
    const finishedYr = finished.filter(r => r.finished.startsWith(y));
    const daysList = (finishedYr.length ? finishedYr : finished).map(r => Number(r.days)).filter(n => n > 0);
    const avg = daysList.length ? Math.round(daysList.reduce((a, b) => a + b, 0) / daysList.length) : null;
    const reading = sortedDesc('books', all.filter(r => r.started && !r.finished));
    const today = todayISO();

    let h = '<p class="summary"><b>' + num(finishedYr.length) + '</b> books finished this year, <b>' + num(finished.length) + '</b> all time.' +
      (avg ? ' About <b>' + avg + '</b> days per book' + (finishedYr.length ? ' this year.' : '.') : '') + '</p>';

    h += sectionHead('Currently reading');
    h += '<div class="rows">';
    if (!reading.length) h += '<div class="empty">Nothing on the go. Add a book when you start one.</div>';
    reading.forEach(r => {
      const day = (daysBetween(r.started, today) || 0) + 1;
      h += '<div class="live-row"><button class="main" data-edit="books:' + r._row + '"><div class="title">' + esc(r.title) + '</div>' +
        '<div class="meta">' + esc([r.author, 'day ' + day].filter(Boolean).join(', ')) + '</div></button>' +
        '<button class="btn small" data-act="finishBook" data-row="' + r._row + '">Finished today</button></div>';
    });
    h += '</div>';

    h += sectionHead('Recently finished');
    h += rowsHTML('books', sortedDesc('books', finished).slice(0, RECENT_ROWS), [
      { k: 'title', label: 'Title', w: 'minmax(0,2.2fr)', cls: 'strong' },
      { k: 'author', label: 'Author', w: 'minmax(0,1.3fr)', cls: 'muted' },
      { k: 'finished', label: 'Finished', w: '84px', fmt: fmtDate, cls: 'muted num' },
    ]);
    h += '<button class="link-btn" data-go="#/books/all">All books (' + num(all.length) + ')</button>';
    return h;
  }

  // ---------- TV ----------
  function tvHTML() {
    const y = thisYear(), eps = records('episodes');
    const epsYr = eps.filter(r => (r.date || '').startsWith(y));
    const showsYr = new Set(epsYr.map(r => showKey(r.show))).size;
    const minsYr = epsYr.reduce((s, r) => s + (Number(r.runtime) || 0), 0);
    const cutoff = isoOf(new Date(Date.now() - WATCHING_DAYS * 86400000));
    const watching = [...lastEpisodeByShow().values()].filter(r => (r.date || '') >= cutoff)
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b._row - a._row));

    let h = '<p class="summary"><b>' + num(epsYr.length) + '</b> episodes this year across <b>' + num(showsYr) + '</b> shows' +
      (minsYr >= 60 ? ', with <b>' + num(Math.round(minsYr / 60)) + '</b> hours of logged run time.' : '.') + '</p>';

    h += sectionHead('Watching now');
    h += '<div class="rows">';
    if (!watching.length) h += '<div class="empty">No episodes in the last ' + WATCHING_DAYS + ' days. Tap + Add to log one.</div>';
    watching.forEach(r => {
      const next = blank(r.episode) ? 'next' : 'E' + (Number(r.episode) + 1);
      h += '<div class="live-row"><button class="main" data-edit="episodes:' + r._row + '"><div class="title">' + esc(String(r.show).trim()) + '</div>' +
        '<div class="meta">' + esc(epCode(r) + ', ' + dayLabel(r.date)) + '</div></button>' +
        '<button class="btn small" data-act="nextEp" data-row="' + r._row + '">Log ' + esc(next) + '</button></div>';
    });
    h += '</div>';

    h += sectionHead('Recent episodes');
    const groups = groupEpisodes(sortedDesc('episodes').slice(0, 200)).slice(0, RECENT_ROWS);
    h += rowsHTML('episodes', groups, [
      { k: 'show', label: 'Show', w: 'minmax(0,2fr)', cls: 'strong' },
      { k: null, label: 'Episodes', w: 'minmax(0,1fr)', fmt: g => epLabel(g.eps), cls: 'muted' },
      { k: 'date', label: 'Date', w: '84px', fmt: fmtDate, cls: 'muted num' },
    ], { editOf: g => 'episodes:' + g.eps[0]._row });
    h += '<button class="link-btn" data-go="#/tv/episodes">All episodes (' + num(eps.length) + ')</button>' +
      '<span class="link-sep">|</span>' +
      '<button class="link-btn" data-go="#/tv/shows">Shows list (' + num(records('shows').length) + ')</button>';
    return h;
  }

  // ---------- Movies ----------
  function moviesHTML() {
    const y = thisYear(), all = records('movies');
    const yr = all.filter(r => (r.date || '').startsWith(y));
    const mins = yr.reduce((s, r) => s + (Number(r.runtime) || 0), 0);
    let h = '<p class="summary"><b>' + num(yr.length) + '</b> movies this year, <b>' + num(all.length) + '</b> all time.' +
      (mins >= 60 ? ' <b>' + num(Math.round(mins / 60)) + '</b> hours of logged run time this year.' : '') + '</p>';
    h += sectionHead('Recently watched');
    h += rowsHTML('movies', sortedDesc('movies').slice(0, RECENT_ROWS), [
      { k: 'title', label: 'Title', w: 'minmax(0,2.2fr)', cls: 'strong' },
      { k: 'channel', label: 'Where', w: 'minmax(0,1fr)', cls: 'muted' },
      { k: 'date', label: 'Date', w: '84px', fmt: fmtDate, cls: 'muted num' },
    ]);
    h += '<button class="link-btn" data-go="#/movies/all">All movies (' + num(all.length) + ')</button>';
    return h;
  }

  // ---------- Drinking ----------
  function drinksHTML() {
    const y = thisYear(), m = thisMonth(), all = records('drinks');
    const sum = list => list.reduce((s, r) => s + (Number(r.drinks) || 0), 0);
    const yrSum = sum(all.filter(r => (r.date || '').startsWith(y)));
    const monthSum = sum(all.filter(r => (r.date || '').startsWith(m)));
    const dayOfYear = (daysBetween(y + '-01-01', todayISO()) || 0) + 1;
    const perWeek = yrSum / (dayOfYear / 7);
    let h = '<p class="summary"><b>' + dec(yrSum) + '</b> drinks this year, about <b>' + perWeek.toFixed(1) + '</b> a week. <b>' + dec(monthSum) + '</b> so far this month.</p>';
    h += sectionHead('Recent');
    h += rowsHTML('drinks', sortedDesc('drinks').slice(0, RECENT_ROWS), [
      { k: 'date', label: 'Date', w: '84px', fmt: fmtDate, cls: 'muted' },
      { k: 'drinks', label: 'Drinks', w: '52px', fmt: v => (blank(v) ? '' : dec(Number(v))), cls: 'num' },
      { k: 'reason', label: 'Reason', w: 'minmax(0,1fr)', cls: 'strong' },
    ]);
    h += '<button class="link-btn" data-go="#/drinks/all">All entries (' + num(all.length) + ')</button>';
    return h;
  }

  // ---------- Full lists ----------
  const ALL_COLS = {
    books: [
      { k: 'title', label: 'Title', w: 'minmax(200px,2fr)', cls: 'strong' },
      { k: 'author', label: 'Author', w: '150px', cls: 'muted' },
      { k: 'started', label: 'Started', w: '104px', fmt: fmtDate, cls: 'muted' },
      { k: 'finished', label: 'Finished', w: '104px', fmt: fmtDate, cls: 'muted' },
      { k: 'days', label: 'Days', w: '52px', cls: 'muted num' },
      { k: 'pages', label: 'Pages', w: '60px', cls: 'muted num' },
      { k: 'time', label: 'Time', w: '72px', fmt: fmtMins, cls: 'muted num' },
      { k: 'format', label: 'Format', w: '96px', cls: 'muted' },
      { k: 'library', label: 'Library', w: '64px', cls: 'muted' },
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
      { k: 'show', label: 'Show', w: 'minmax(180px,2fr)', cls: 'strong' },
      { k: 'started', label: 'Started', w: '104px', fmt: fmtDate, cls: 'muted' },
      { k: 'finished', label: 'Finished', w: '104px', fmt: fmtDate, cls: 'muted' },
      { k: 'watched', label: 'Watched', w: '70px', cls: 'muted num' },
      { k: 'totalTime', label: 'Time', w: '80px', fmt: fmtMins, cls: 'muted num' },
      { k: 'timeToFinish', label: 'Took', w: '150px', cls: 'muted' },
    ],
    movies: [
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
  const SORT_KEY = { books: 'title', episodes: 'show', shows: 'show', movies: 'title', drinks: 'reason' };

  function listState(section) {
    if (!state.lists[section]) state.lists[section] = { q: '', sort: 'new', limit: PAGE_SIZE };
    return state.lists[section];
  }

  function filteredList(section) {
    const ls = listState(section);
    let list = records(section);
    const terms = ls.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) {
      list = list.filter(r => {
        const hay = Object.keys(r).filter(k => k !== '_row').map(k => r[k]).join(' ').toLowerCase();
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
    const list = filteredList(section);
    const cols = ALL_COLS[section];
    const minW = cols.reduce((s, c) => s + (parseInt(c.w.replace(/^minmax\(/, ''), 10) || 0) + 12, 12);
    const parent = TABS.find(t => t.id === r.tab).href;

    let h = '<div class="list-head"><button class="back" data-go="' + parent + '" aria-label="Back">' + ICONS.back + '</button><h1>' + esc(r.title) + '</h1></div>';
    if (r.tab === 'tv') {
      h += '<div class="segmented"><button class="' + (section === 'episodes' ? 'on' : '') + '" data-go="#/tv/episodes">Episodes</button>' +
        '<button class="' + (section === 'shows' ? 'on' : '') + '" data-go="#/tv/shows">Shows</button></div>';
    }
    h += '<div class="tools"><input id="list-search" type="search" placeholder="Search" value="' + esc(ls.q) + '" autocomplete="off">' +
      '<select id="list-sort" aria-label="Sort">' +
      [['new', 'Newest first'], ['old', 'Oldest first'], ['az', 'A to Z']].map(o => '<option value="' + o[0] + '"' + (ls.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
      '</select></div>';
    h += '<p class="result-count">' + (ls.q ? num(list.length) + ' of ' + num(records(section).length) : num(list.length)) + ' ' + (list.length === 1 ? 'row' : 'rows') + '</p>';
    h += '<div class="table-wrap" style="--min-w:' + minW + 'px">' + rowsHTML(section, list.slice(0, ls.limit), cols, { empty: ls.q ? 'No matches.' : 'Nothing here yet.' }) + '</div>';
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
      '<button class="btn primary" type="submit" id="setup-btn">Connect</button></form></div>';

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
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalOpen) closeModal(); });
  $modal.addEventListener('click', e => { if (e.target.hasAttribute('data-overlay')) closeModal(); });

  function openChooser() {
    const opt = (sec, color, title, sub) => '<button class="choice" data-act="choose" data-sec="' + sec + '"><span class="tag ' + color + '"></span><span>' + title + '<small>' + sub + '</small></span></button>';
    openModal('<div class="sheet-head"><h2>Add</h2><button class="close" data-act="close" aria-label="Close">&times;</button></div><div class="choices">' +
      opt('books', 'books', 'Book', 'Started or finished a book') +
      opt('episodes', 'tv', 'Episodes', 'One episode or a batch') +
      opt('movies', 'movies', 'Movie', 'Something you watched') +
      opt('drinks', 'drinks', 'Drinks', 'A night out, or in') +
      '</div>');
  }

  function openSettings() {
    openModal('<div class="sheet-head"><h2>Settings</h2><button class="close" data-act="close" aria-label="Close">&times;</button></div>' +
      '<p class="summary settings-text">Connected to <b>' + esc(config.sheet || 'your sheet') + '</b>.' +
      (state.fetchedAt ? ' Last updated ' + ago(state.fetchedAt) + '.' : '') + '</p>' +
      '<div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap">' +
      '<button class="btn" data-act="syncNow">Refresh from sheet</button>' +
      '<button class="btn" data-act="disconnect">Disconnect this device</button></div>' +
      '<p class="result-count" style="margin-top:18px">Version ' + VERSION + '</p>');
  }

  // ---------------------------------------------------------------------------
  // Forms
  // ---------------------------------------------------------------------------
  const FORMS = {
    books: [
      { k: 'title', l: 'Title', t: 'text', req: true },
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
      { k: 'show', l: 'Show', t: 'text', req: true, list: 'shows' },
      { k: 'season', l: 'Season', t: 'number', half: true },
      { k: 'episode', l: 'Episode', t: 'number', half: true },
      { k: 'through', l: 'Through episode', t: 'number', half: true, addOnly: true, hint: 'Optional, logs a batch' },
      { k: 'date', l: 'Date watched', t: 'date', half: true },
      { k: 'runtime', l: 'Run time (minutes)', t: 'minutes', half: true },
      { k: 'year', l: 'Year of release', t: 'number', half: true },
      { k: 'channel', l: 'Channel', t: 'text', list: 'channels' },
    ],
    shows: [
      { k: 'show', l: 'Show', t: 'text', req: true, list: 'shows' },
      { k: 'seasons', l: 'Seasons', t: 'number', half: true },
      { k: 'episodes', l: 'Total episodes', t: 'number', half: true },
      { k: 'started', l: 'Started watching', t: 'date', half: true },
      { k: 'finished', l: 'Finished watching', t: 'date', half: true },
      { k: 'thoughts', l: 'Thoughts and rating', t: 'textarea' },
      { k: 'watched', l: 'Episodes watched', t: 'ro', half: true },
      { k: 'totalTime', l: 'Time watched', t: 'ro', half: true, fmt: fmtMins },
      { k: 'timeToFinish', l: 'Time to finish', t: 'ro' },
    ],
    movies: [
      { k: 'title', l: 'Title', t: 'text', req: true },
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

  const ADD_LABELS = { books: 'Add book', episodes: 'Log episodes', shows: 'Add show', movies: 'Add movie', drinks: 'Add drinks' };
  const ADDED_TOASTS = { books: 'Book added', shows: 'Show added', movies: 'Movie added', drinks: 'Drinks added' };
  const TITLES = { books: 'book', episodes: 'episode', shows: 'show', movies: 'movie', drinks: 'drinks' };

  function defaultsFor(section) {
    const today = todayISO();
    switch (section) {
      case 'books': {
        const last = sortedDesc('books')[0] || {};
        return { started: today, format: last.format || '', library: last.library || 'No' };
      }
      case 'shows': return { started: today };
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
        input = '<input id="' + id + '" name="' + f.k + '" type="text" value="' + esc(val) + '" autocomplete="off"' + (f.list ? ' list="dl-' + f.list + '"' : '') + '>';
    }
    return '<div class="' + cls + '">' + label + input + hint + '</div>';
  }

  /**
   * Opens the add or edit form.
   * section: books | episodes | shows | movies | drinks
   * rec: existing record to edit, or null to add
   * preset: values to prefill when adding
   */
  function openForm(section, rec, preset) {
    const isAdd = !rec;
    const fields = FORMS[section].filter(f => !(f.addOnly && !isAdd) && !(f.t === 'ro' && isAdd));
    const values = isAdd ? Object.assign(defaultsFor(section), preset || {}) : rec;
    const lists = [...new Set(fields.filter(f => f.list).map(f => f.list))];
    const title = isAdd ? (section === 'episodes' ? 'Log episodes' : 'Add ' + TITLES[section]) : 'Edit ' + TITLES[section];

    openModal(
      '<div class="sheet-head"><h2>' + esc(title) + '</h2><button class="close" data-act="close" aria-label="Close">&times;</button></div>' +
      '<form id="rec-form" novalidate><div class="form-body"><div class="form-grid">' + fields.map(f => fieldHTML(f, values[f.k])).join('') + '</div>' +
      '<div class="form-error" id="form-error" hidden></div></div>' +
      '<div class="form-actions"><button type="button" class="btn" data-act="close">Cancel</button>' +
      '<button type="submit" class="btn primary" id="save-btn">' + (isAdd ? ADD_LABELS[section] : 'Save changes') + '</button></div></form>' +
      lists.map(l => '<datalist id="dl-' + l + '">' + suggestions(l).map(s => '<option value="' + esc(s) + '">').join('') + '</datalist>').join(''),
      sheet => {
        const form = sheet.querySelector('#rec-form');
        const dirty = new Set();
        form.addEventListener('input', e => { if (e.target.name) dirty.add(e.target.name); });
        if (isAdd && section === 'episodes') wireEpisodeAutofill(form, dirty);
        form.addEventListener('submit', e => { e.preventDefault(); submitForm(section, rec, fields, form); });
        if (isAdd) {
          const first = form.querySelector('input[type=text]');
          if (first && !first.value) first.focus();
        }
      },
      'form-sheet'
    );
  }

  // When you pick a show, fill in the next episode and copy season, run time, year and channel from your last entry.
  function wireEpisodeAutofill(form, dirty) {
    const showInput = form.elements.show;
    const fill = () => {
      const last = lastEpisodeByShow().get(showKey(showInput.value));
      if (!last) return;
      const set = (name, v) => { const el = form.elements[name]; if (el && !dirty.has(name) && !blank(v)) el.value = v; };
      set('season', last.season);
      set('episode', blank(last.episode) ? '' : Number(last.episode) + 1);
      set('runtime', last.runtime);
      set('year', last.year);
      set('channel', last.channel);
    };
    showInput.addEventListener('change', fill);
    showInput.addEventListener('input', () => { if (lastEpisodeByShow().has(showKey(showInput.value))) fill(); });
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
      persist();
      closeModal();
      render();
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
    settings: () => openSettings(),
    close: () => closeModal(),
    add: () => {
      const r = route();
      if (r.list) return openForm(r.section, null);
      const map = { books: 'books', tv: 'episodes', movies: 'movies', drinks: 'drinks' };
      if (map[r.tab]) openForm(map[r.tab], null); else openChooser();
    },
    choose: el => openForm(el.dataset.sec, null),
    more: el => { listState(el.dataset.section).limit += PAGE_SIZE * 2; render(); },
    finishBook: el => { el.disabled = true; el.textContent = 'Saving'; finishBook(Number(el.dataset.row)); },
    nextEp: el => {
      const last = records('episodes').find(r => r._row === Number(el.dataset.row));
      if (!last) return;
      openForm('episodes', null, {
        show: String(last.show).trim(), season: last.season,
        episode: blank(last.episode) ? '' : Number(last.episode) + 1,
        runtime: last.runtime, year: last.year, channel: last.channel,
      });
    },
    disconnect: () => {
      if (!confirm('Disconnect this device? Your sheet is not affected. You would just enter the URL and passcode again.')) return;
      closeModal();
      forget(KEYS.config); forget(KEYS.data);
      config = null; state.data = null; state.fetchedAt = null;
      render();
    },
  };

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-go],[data-edit],[data-act]');
    if (!t) return;
    if (t.dataset.go) {
      const current = location.hash || '#/';
      if (current === t.dataset.go) render();
      else location.hash = t.dataset.go;
      return;
    }
    if (t.dataset.edit) {
      const [section, row] = t.dataset.edit.split(':');
      const rec = records(section).find(r => r._row === Number(row));
      if (rec) openForm(section, rec);
      return;
    }
    const fn = ACTIONS[t.dataset.act];
    if (fn) fn(t);
  });

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
  render();
  if (config) sync(!!state.data);
})();
