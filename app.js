/* Front End Docket: attendance app UI.
   Talks to the data layer in store.js, which is either the demo store (this device only)
   or Supabase (shared database with login and live updates). */
(function () {
  'use strict';

  var cfg = window.DOCKET_CONFIG || {};
  var DESIGS = ['PRODUCTION TEAM', 'SPOT INCHARGE', 'SPOT BOY', 'HOUSE KEEPING', 'WATER WOMEN', 'CO-ELECTRICIAN'];
  var RS = '₹';

  var st = { user: null, role: 'viewer', shoots: [], shoot: null, rows: [], crew: [], conn: 'local' };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function nowHM() { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function canEdit() { return st.role === 'editor'; }
  function status(r) { return r.tin && r.tout ? 'done' : (r.tin ? 'on' : 'pending'); }
  var STATUS_TEXT = { done: 'Wrapped', on: 'On set', pending: 'Not in yet' };

  /* ---------- backend ---------- */
  var hooks = {
    onAuth: function (user, role) { handleAuth(user, role); },
    onStatus: function (s) { st.conn = s; renderConn(); },
    onError: function (msg) { showError(msg); },
    onShoot: function (partial) { applyRemoteShoot(partial); },
    onShootList: function () { refreshShootList(); },
    onRow: function (type, row) { applyRemoteRow(type, row); },
    onCrew: function () { refreshCrew(); },
    onResync: function () { resync(); }
  };
  var useCloud = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  var B = useCloud ? window.DocketStore.cloud(cfg, hooks) : window.DocketStore.local(hooks);
  if (!useCloud) st.conn = 'local';

  /* ---------- screens ---------- */
  function show(which) {
    ['loading', 'authScreen', 'pendingScreen', 'appScreen'].forEach(function (id) { $(id).hidden = id !== which; });
  }
  function showError(msg) { $('errTxt').textContent = msg; $('errBar').hidden = false; }
  $('errClose').addEventListener('click', function () { $('errBar').hidden = true; });
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    setTimeout(function () { if (t.textContent === msg) t.textContent = ''; }, 2500);
  }

  function renderConn() {
    var dot = $('connDot'), txt = $('connTxt');
    var pend = B.pending ? B.pending() : 0;
    dot.className = 'dot ' + st.conn;
    if (st.conn === 'live') txt.textContent = pend ? 'Live · saving ' + pend : 'Live';
    else if (st.conn === 'offline') txt.textContent = 'Offline · ' + (pend ? pend + ' change' + (pend === 1 ? '' : 's') + ' will upload when back online' : 'showing saved copy');
    else if (st.conn === 'local') txt.textContent = 'Demo · this device only';
    else txt.textContent = 'Connecting…';
  }
  setInterval(renderConn, 3000);

  function renderUser() {
    $('whoTxt').textContent = B.mode === 'cloud' ? (st.user ? st.user.email : '') : '';
    var pill = $('roleTxt');
    pill.hidden = B.mode !== 'cloud';
    pill.textContent = canEdit() ? 'Editor' : 'View only';
    pill.className = 'pill ' + (canEdit() ? 'edit' : 'view');
    $('signOut').hidden = B.mode !== 'cloud';
    document.body.classList.toggle('viewonly', !canEdit());
    $('teamBox').hidden = !(B.mode === 'cloud' && canEdit());
    var meta = document.querySelectorAll('[data-m]');
    for (var i = 0; i < meta.length; i++) meta[i].disabled = !canEdit() || meta[i].getAttribute('data-m') === 'date';
    $('addForm').hidden = !canEdit();
    $('openDateBtn').hidden = false;
  }

  /* ---------- auth ---------- */
  function handleAuth(user, role) {
    if (user && st.user && st.user.id === user.id && st.role === role) return;
    if (!user) {
      flushAll(); B.unwatch(); st.user = null;
      show('authScreen');
      return;
    }
    st.user = user; st.role = role || 'pending';
    if (st.role === 'pending') {
      $('pendingWho').textContent = user.email || '';
      show('pendingScreen');
      return;
    }
    show('appScreen');
    renderUser();
    loadAll();
  }
  function authMsg(m, good) { var el = $('authMsg'); el.textContent = m; el.className = 'authmsg' + (good ? ' good' : ''); }
  $('authForm').addEventListener('submit', function (e) {
    e.preventDefault();
    authMsg('Signing in…', true);
    B.signIn($('au-email').value.trim(), $('au-pass').value).then(function (r) {
      if (r && r.error) authMsg(r.error.message);
      else authMsg('');
    });
  });
  $('au-up').addEventListener('click', function () {
    var email = $('au-email').value.trim(), pass = $('au-pass').value;
    if (!email || pass.length < 6) { authMsg('Enter an email and a password of at least 6 characters.'); return; }
    authMsg('Creating account…', true);
    B.signUp(email, pass).then(function (r) {
      if (r && r.error) authMsg(r.error.message);
      else if (r && !r.session) authMsg('Account created. Check your email to confirm it, then sign in.', true);
      else authMsg('');
    });
  });
  $('signOut').addEventListener('click', function () { flushAll(); B.signOut(); });
  $('pendingOut').addEventListener('click', function () { B.signOut(); });
  $('pendingCheck').addEventListener('click', function () {
    $('pendingMsg').textContent = 'Checking\u2026';
    B.refreshRole().then(function (r) {
      if (r && r !== 'pending') { $('pendingMsg').textContent = ''; handleAuth(st.user, r); }
      else $('pendingMsg').textContent = 'Not approved yet. Ask an editor to approve your account, then check again.';
    });
  });

  /* ---------- loading ---------- */
  function loadAll() {
    refreshCrew(); refreshTeam();
    B.listShoots().then(function (list) {
      st.shoots = list;
      var td = window.DocketStore.today();
      var latest = list[0];
      var wanted = null;
      for (var i = 0; i < list.length; i++) if (list[i].date === td) wanted = list[i];
      if (wanted) return wanted;
      return B.openDate(td, latest || {}).catch(function () { return latest || null; });
    }).then(function (shoot) {
      if (!shoot) { showError('No sheet is available yet. Ask an editor to open today’s sheet.'); return; }
      return openShoot(shoot.id).then(refreshShootList);
    }).catch(function (e) { showError('Could not load the docket: ' + (e && e.message ? e.message : e)); });
  }
  function openShoot(id) {
    flushAll();
    return B.getShoot(id).then(function (r) {
      st.shoot = r.shoot; st.rows = r.rows;
      fillMeta(); renderRows(); renderFoot(); renderUser();
      B.watch(id);
      renderConn();
    });
  }
  function refreshShootList() {
    return B.listShoots().then(function (list) {
      st.shoots = list;
      var sel = $('shootSel');
      sel.innerHTML = list.map(function (s) {
        return '<option value="' + s.id + '"' + (st.shoot && st.shoot.id === s.id ? ' selected' : '') + '>' + esc(s.date) + (s.show ? ' · ' + esc(s.show) : '') + '</option>';
      }).join('');
    }, function () {});
  }
  function refreshCrew() {
    B.listCrew().then(function (list) { st.crew = list || []; updateLists(); }, function () {});
  }
  function resync() {
    if (!st.shoot) return;
    flushAll();
    B.getShoot(st.shoot.id).then(function (r) {
      st.shoot = r.shoot; st.rows = r.rows;
      fillMeta(); renderRowsKeepFocus(); renderFoot();
    }, function () {});
    refreshShootList(); refreshCrew();
  }

  $('shootSel').addEventListener('change', function () { openShoot($('shootSel').value); });
  $('openDate').value = window.DocketStore.today();
  $('openDateBtn').addEventListener('click', function () {
    var d = $('openDate').value;
    if (!d) return;
    var cur = st.shoot || {};
    B.openDate(d, { show: cur.show, loc: cur.loc, schedFrom: cur.schedFrom, schedTo: cur.schedTo }).then(function (s) {
      return openShoot(s.id).then(refreshShootList);
    }).catch(function (e) { showError(e && e.message ? e.message : 'Could not open that day.'); });
  });

  /* ---------- batching of edits ---------- */
  var pend = {};
  function queue(kind, id, fields, now) {
    var key = kind + ':' + id;
    var p = pend[key] || (pend[key] = { kind: kind, id: id, fields: {}, timer: null });
    Object.keys(fields).forEach(function (k) { p.fields[k] = fields[k]; });
    clearTimeout(p.timer);
    if (now) flushKey(key); else p.timer = setTimeout(function () { flushKey(key); }, 350);
  }
  function flushKey(key) {
    var p = pend[key];
    if (!p) return;
    clearTimeout(p.timer); delete pend[key];
    if (p.kind === 'r') B.patchRow(p.id, p.fields); else B.patchShoot(p.id, p.fields);
    renderConn();
  }
  function flushAll() { Object.keys(pend).forEach(flushKey); }
  function hasPending(kind, id, field) { var p = pend[kind + ':' + id]; return !!(p && field in p.fields); }
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flushAll(); });

  /* ---------- shoot header ---------- */
  var metaMap = { date: 'm-date', show: 'm-show', loc: 'm-loc', schedFrom: 'm-sf', schedTo: 'm-st', actFrom: 'm-af', actTo: 'm-at' };
  function fillMeta() {
    Object.keys(metaMap).forEach(function (k) {
      var el = $(metaMap[k]);
      if (el !== document.activeElement) el.value = (st.shoot && st.shoot[k]) || '';
    });
  }
  document.querySelectorAll('[data-m]').forEach(function (el) {
    el.addEventListener('input', function () {
      if (!st.shoot || !canEdit()) return;
      var k = el.getAttribute('data-m');
      st.shoot[k] = el.value;
      queue('s', st.shoot.id, (function () { var o = {}; o[k] = el.value; return o; })());
      if (k === 'show') {
        var opt = $('shootSel').selectedOptions[0];
        if (opt) opt.textContent = st.shoot.date + (el.value ? ' · ' + el.value : '');
      }
    });
  });

  /* ---------- summary ---------- */
  function updateSummary() {
    var total = st.rows.length, inCount = 0, on = 0, done = 0, amt = 0, groups = {};
    st.rows.forEach(function (r) {
      var s = status(r);
      if (s !== 'pending') inCount += 1;
      if (s === 'on') on += 1;
      if (s === 'done') done += 1;
      amt += parseFloat(r.amt) || 0;
      var k = (r.desig || 'UNASSIGNED').trim().toUpperCase() || 'UNASSIGNED';
      if (!groups[k]) groups[k] = { n: 0, i: 0 };
      groups[k].n += 1;
      if (r.tin) groups[k].i += 1;
    });
    $('stats').innerHTML =
      '<div class="stat"><b>' + total + '</b><span>On the sheet</span></div>' +
      '<div class="stat"><b>' + inCount + '</b><span>Signed in</span></div>' +
      '<div class="stat warn"><b>' + on + '</b><span>On set now</span></div>' +
      '<div class="stat good"><b>' + done + '</b><span>Wrapped</span></div>' +
      '<div class="stat"><b>' + (amt ? amt.toLocaleString('en-IN') : '0') + '</b><span>Total amount (' + RS + ')</span></div>';
    var keys = Object.keys(groups).sort(function (a, b) { return groups[b].n - groups[a].n || a.localeCompare(b); });
    var max = keys.length ? groups[keys[0]].n : 1;
    $('depts').innerHTML = keys.length ? keys.map(function (k) {
      var g = groups[k];
      return '<div class="dept"><span class="dn">' + esc(k) + '</span><span class="dv">' + g.i + ' in / ' + g.n + '</span>' +
        '<span class="bar"><i style="width:' + Math.round((g.n / max) * 100) + '%"></i></span></div>';
    }).join('') : '<div class="empty-note">Add people below and the count for each department appears here.</div>';
  }

  function updateLists() {
    var seen = {}, names = [];
    st.crew.forEach(function (c) { if (c.name && !seen[c.name.toLowerCase()]) { seen[c.name.toLowerCase()] = 1; names.push(c.name); } });
    $('crewlist').innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
    var ds = DESIGS.slice();
    st.crew.concat(st.rows).forEach(function (c) {
      var d = (c.desig || '').trim().toUpperCase();
      if (d && ds.indexOf(d) < 0) ds.push(d);
    });
    $('desiglist').innerHTML = ds.map(function (d) { return '<option value="' + esc(d) + '"></option>'; }).join('');
  }

  /* ---------- rows ---------- */
  function sigCell(r, which) {
    var data = r[which], act = 'sign', dis = canEdit() ? '' : ' disabled';
    if (data) return '<button type="button" class="sigthumb" data-act="' + act + '" data-k="' + which + '"' + dis + ' aria-label="Edit signature"><img alt="Signature" src="' + esc(data) + '"></button>';
    return '<button type="button" class="btn ghost sm" data-act="' + act + '" data-k="' + which + '"' + dis + '>Sign</button>';
  }
  function rowHTML(r, i) {
    var s = status(r), d = canEdit() ? '' : ' disabled';
    return '<div class="row s-' + s + '" data-id="' + r.id + '">' +
      '<div class="c srw"><span class="srn">' + (i + 1) + '</span><span class="stt">' + STATUS_TEXT[s] + '</span></div>' +
      '<div class="c full" data-l="Name"><input type="text" data-f="name" list="crewlist" value="' + esc(r.name) + '" aria-label="Name"' + d + '></div>' +
      '<div class="c full" data-l="Designation"><input type="text" data-f="desig" list="desiglist" value="' + esc(r.desig) + '" aria-label="Designation"' + d + '></div>' +
      '<div class="c" data-l="Card no."><input type="text" data-f="card" value="' + esc(r.card) + '" aria-label="Card number"' + d + '></div>' +
      '<div class="c" data-l="Time in"><div class="tm"><input type="time" data-f="tin" value="' + esc(r.tin) + '" aria-label="Time in"' + d + '><button type="button" class="btn ghost sm" data-act="now" data-k="tin"' + d + '>Now</button></div></div>' +
      '<div class="c" data-l="Sign in" data-sig="sin">' + sigCell(r, 'sin') + '</div>' +
      '<div class="c" data-l="Time out"><div class="tm"><input type="time" data-f="tout" value="' + esc(r.tout) + '" aria-label="Time out"' + d + '><button type="button" class="btn ghost sm" data-act="now" data-k="tout"' + d + '>Now</button></div></div>' +
      '<div class="c" data-l="Sign out" data-sig="sout">' + sigCell(r, 'sout') + '</div>' +
      '<div class="c" data-l="Amount (' + RS + ')"><input type="number" inputmode="decimal" min="0" data-f="amt" value="' + esc(r.amt) + '" aria-label="Amount"' + d + '></div>' +
      '<div class="c dl"><button type="button" class="del" data-act="del"' + d + ' aria-label="Remove ' + esc(r.name || 'row') + '">&times;</button></div></div>';
  }
  function renderRows() {
    $('rows').innerHTML = st.rows.length ? st.rows.map(rowHTML).join('') :
      '<div class="row msg"><div class="empty-note">No one on the sheet yet. ' + (canEdit() ? 'Add a name above to start the day’s attendance.' : 'An editor has not added anyone for this day yet.') + '</div></div>';
    var sample = B.isSample && B.isSample();
    $('notice').hidden = !(B.mode === 'local');
    $('noticeTxt').innerHTML = '<b>Demo mode.</b> ' + (sample ? 'The names and times shown are made up. ' : '') + 'Data stays on this device. To share it live between devices, add your Supabase keys in config.js (see the README).';
    $('clearSample').hidden = !sample;
    $('footHint').textContent = B.mode === 'cloud' ? 'Changes save to the shared database straight away and appear on every signed-in device.' : 'Entries are kept on this device only.';
    updateSummary(); updateLists();
  }
  function renderRowsKeepFocus() {
    var a = document.activeElement, keep = null;
    if (a && a.closest && a.closest('#rows') && a.getAttribute('data-f')) {
      var rw = a.closest('.row');
      keep = { id: rw && rw.getAttribute('data-id'), f: a.getAttribute('data-f'), s: a.selectionStart, e: a.selectionEnd };
    }
    renderRows();
    if (keep && keep.id) {
      var el = document.querySelector('.row[data-id="' + keep.id + '"] [data-f="' + keep.f + '"]');
      if (el) { el.focus(); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.e); } catch (e) {} }
    }
  }
  function rowIndex(id) { for (var i = 0; i < st.rows.length; i++) if (st.rows[i].id === id) return i; return -1; }
  function rowEl(id) { return document.querySelector('.row[data-id="' + id + '"]'); }
  function refreshStatusEl(el, r) {
    var s = status(r);
    el.className = 'row s-' + s;
    var t = el.querySelector('.stt');
    if (t) t.textContent = STATUS_TEXT[s];
  }
  function refreshRowDom(id) {
    var i = rowIndex(id), el = rowEl(id);
    if (i < 0 || !el) return;
    var r = st.rows[i];
    var inputs = el.querySelectorAll('[data-f]');
    for (var k = 0; k < inputs.length; k++) {
      if (inputs[k] !== document.activeElement) inputs[k].value = r[inputs[k].getAttribute('data-f')] || '';
    }
    ['sin', 'sout'].forEach(function (w) {
      var cell = el.querySelector('[data-sig="' + w + '"]');
      if (cell) cell.innerHTML = sigCell(r, w);
    });
    refreshStatusEl(el, r);
    updateSummary();
  }

  /* ---------- live changes from other devices ---------- */
  function applyRemoteRow(type, row) {
    if (type === 'delete') {
      var di = rowIndex(row.id);
      if (di >= 0) { st.rows.splice(di, 1); renderRowsKeepFocus(); }
      return;
    }
    var i = rowIndex(row.id);
    if (i >= 0) {
      Object.keys(row).forEach(function (k) {
        if (k === 'id' || k === 'created' || k === 'shootId') return;
        if (hasPending('r', row.id, k)) return;
        st.rows[i][k] = row[k];
      });
      refreshRowDom(row.id);
    } else {
      st.rows.push({ id: row.id, created: row.created || '', name: row.name || '', desig: row.desig || '', card: row.card || '', tin: row.tin || '', tout: row.tout || '', sin: row.sin || '', sout: row.sout || '', amt: row.amt || '' });
      st.rows.sort(function (a, b) { return (a.created || '') < (b.created || '') ? -1 : 1; });
      renderRowsKeepFocus();
    }
  }
  function applyRemoteShoot(partial) {
    if (!st.shoot) return;
    Object.keys(partial).forEach(function (k) {
      if (k === 'id' || k === 'created') return;
      if (hasPending('s', st.shoot.id, k)) return;
      st.shoot[k] = partial[k];
    });
    fillMeta(); renderFoot();
  }

  /* ---------- editing rows ---------- */
  $('rows').addEventListener('input', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-f');
    if (!f || !canEdit()) return;
    var rw = e.target.closest('.row'), id = rw && rw.getAttribute('data-id'), i = rowIndex(id);
    if (i < 0) return;
    st.rows[i][f] = e.target.value;
    var o = {}; o[f] = e.target.value;
    queue('r', id, o);
    refreshStatusEl(rw, st.rows[i]);
    updateSummary();
  });
  $('rows').addEventListener('change', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-f');
    if (f === 'desig') updateLists();
  });
  var armTimer = null;
  $('rows').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn || !canEdit()) return;
    var rw = btn.closest('.row'), id = rw && rw.getAttribute('data-id'), i = rowIndex(id);
    if (i < 0) return;
    var r = st.rows[i], act = btn.getAttribute('data-act'), k = btn.getAttribute('data-k');
    if (act === 'now') {
      r[k] = nowHM();
      rw.querySelector('[data-f="' + k + '"]').value = r[k];
      var o = {}; o[k] = r[k];
      queue('r', id, o, true);
      refreshStatusEl(rw, r); updateSummary();
    } else if (act === 'del') {
      if (btn.getAttribute('data-armed')) {
        clearTimeout(armTimer);
        st.rows.splice(i, 1);
        delete pend['r:' + id];
        B.deleteRow(id);
        renderRows(); renderConn();
      } else {
        btn.setAttribute('data-armed', '1'); btn.textContent = 'Sure?'; btn.classList.add('armed');
        clearTimeout(armTimer);
        armTimer = setTimeout(function () { btn.removeAttribute('data-armed'); btn.innerHTML = '&times;'; btn.classList.remove('armed'); }, 3000);
      }
    } else if (act === 'sign') {
      openPad({ kind: 'row', id: id, key: k }, r.name || 'Crew member');
    }
  });

  /* ---------- add person ---------- */
  $('a-name').addEventListener('change', function () {
    var v = $('a-name').value.trim().toLowerCase();
    for (var i = 0; i < st.crew.length; i++) {
      if (st.crew[i].name.toLowerCase() === v) { $('a-desig').value = st.crew[i].desig || ''; $('a-card').value = st.crew[i].card || ''; break; }
    }
  });
  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!canEdit() || !st.shoot) return;
    var name = $('a-name').value.trim(), desig = $('a-desig').value.trim().toUpperCase(), card = $('a-card').value.trim();
    if (!name || !desig) return;
    var row = { id: B.uuid(), created: new Date().toISOString(), name: name, desig: desig, card: card, tin: '', tout: '', sin: '', sout: '', amt: '' };
    st.rows.push(row);
    B.addRow(st.shoot.id, row);
    if (!st.crew.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) {
      st.crew.push({ name: name, desig: desig, card: card });
      B.addCrew({ name: name, desig: desig, card: card });
    }
    $('a-name').value = ''; $('a-card').value = '';
    renderRows(); renderConn();
    $('a-name').focus();
  });

  $('clearSample').addEventListener('click', function () {
    B.clearSample();
    if (st.shoot) openShoot(st.shoot.id).then(function () { refreshShootList(); refreshCrew(); });
  });

  /* ---------- exports ---------- */
  function tableLines() {
    var lines = [['Sr. No.', 'Name', 'Designation', 'Card No.', 'Time In', 'Signed In', 'Time Out', 'Signed Out', 'Amount']];
    st.rows.forEach(function (r, i) { lines.push([i + 1, r.name, r.desig, r.card, r.tin, r.sin ? 'Yes' : 'No', r.tout, r.sout ? 'Yes' : 'No', r.amt]); });
    return lines;
  }
  $('copyTsv').addEventListener('click', function () {
    var text = tableLines().map(function (l) { return l.map(safeCell).join('\t'); }).join('\n');
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) {}
      document.body.removeChild(ta);
      toast(ok ? 'Copied. Paste into Excel.' : 'Copy was blocked by this browser.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Copied. Paste into Excel.'); }, fallback);
    else fallback();
  });
  function safeCell(v) { var s = String(v == null ? '' : v); return /^[=+\-@]/.test(s) ? "'" + s : s; }
  function csvCell(v) { var s = safeCell(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  $('dlCsv').addEventListener('click', function () {
    var sh = st.shoot || {};
    var lines = tableLines().map(function (l, i) {
      var pre = i === 0 ? ['Date', 'Movie / Show', 'Location'] : [sh.date, sh.show, sh.loc];
      return pre.concat(l).map(csvCell).join(',');
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'attendance-' + (sh.date || 'sheet') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('CSV downloaded.');
  });
  $('printBtn').addEventListener('click', function () { window.print(); });

  /* ---------- footer signatures ---------- */
  function renderFoot() {
    var s = st.shoot || {};
    [['prod', 'sigProd'], ['sage', 'sigSage']].forEach(function (p) {
      var box = $('sig-' + p[0]), clr = document.querySelector('[data-footclear="' + p[0] + '"]');
      if (s[p[1]]) { box.innerHTML = '<img alt="Signature" src="' + esc(s[p[1]]) + '">'; clr.hidden = !canEdit(); }
      else { box.textContent = 'Tap to sign'; clr.hidden = true; }
      box.disabled = !canEdit();
    });
  }
  document.querySelectorAll('[data-foot]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!canEdit()) return;
      var k = b.getAttribute('data-foot');
      openPad({ kind: 'foot', key: k === 'prod' ? 'sigProd' : 'sigSage' }, k === 'prod' ? 'Production team' : 'SAGE team');
    });
  });
  document.querySelectorAll('[data-footclear]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!canEdit() || !st.shoot) return;
      var key = b.getAttribute('data-footclear') === 'prod' ? 'sigProd' : 'sigSage';
      st.shoot[key] = '';
      var o = {}; o[key] = '';
      queue('s', st.shoot.id, o, true);
      renderFoot();
    });
  });

  /* ---------- signature pad ---------- */
  var pad = $('pad'), ctx = null, drawing = false, dirty = false, target = null, last = null;
  function sizePad() {
    var ratio = window.devicePixelRatio || 1;
    pad.width = Math.round(pad.clientWidth * ratio); pad.height = Math.round(pad.clientHeight * ratio);
    ctx = pad.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1d2f8f';
    dirty = false;
  }
  function pos(e) { var r = pad.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  pad.addEventListener('pointerdown', function (e) {
    drawing = true; last = pos(e);
    try { pad.setPointerCapture(e.pointerId); } catch (err) {}
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(last.x + 0.01, last.y + 0.01); ctx.stroke();
    dirty = true; e.preventDefault();
  });
  pad.addEventListener('pointermove', function (e) {
    if (!drawing) return;
    var p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; e.preventDefault();
  });
  function endStroke() { drawing = false; }
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);
  /* shrink the signature before saving so it stays small in the database */
  function exportSig() {
    var scale = Math.min(1, 420 / pad.width);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(pad.width * scale)); c.height = Math.max(1, Math.round(pad.height * scale));
    c.getContext('2d').drawImage(pad, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
  function openPad(t, who) { target = t; $('modalTitle').textContent = 'Sign: ' + who; $('modal').hidden = false; sizePad(); }
  function closePad() { $('modal').hidden = true; target = null; }
  $('padClear').addEventListener('click', sizePad);
  $('padCancel').addEventListener('click', closePad);
  $('padSave').addEventListener('click', function () {
    if (!target || !st.shoot) return;
    var data = dirty ? exportSig() : '', t = target;
    closePad();
    if (t.kind === 'row') {
      var i = rowIndex(t.id);
      if (i < 0) return;
      st.rows[i][t.key] = data;
      var o = {}; o[t.key] = data;
      queue('r', t.id, o, true);
      refreshRowDom(t.id);
    } else {
      st.shoot[t.key] = data;
      var p = {}; p[t.key] = data;
      queue('s', st.shoot.id, p, true);
      renderFoot();
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('modal').hidden) closePad(); });

  /* ---------- team access (editors only) ---------- */
  function refreshTeam() {
    if (B.mode !== 'cloud' || !canEdit()) return;
    B.listTeam().then(function (list) {
      var waiting = list.filter(function (p) { return p.role === 'pending'; }).length;
      $('teamSum').textContent = 'Team access' + (waiting ? ' \u00B7 ' + waiting + ' waiting for approval' : '');
      list.sort(function (a, b) { return (a.role === 'pending' ? 0 : 1) - (b.role === 'pending' ? 0 : 1); });
      $('teamList').innerHTML = list.map(function (p) {
        var me = st.user && p.id === st.user.id;
        return '<div class="trow' + (p.role === 'pending' ? ' pend' : '') + '"><span class="tm-mail">' + esc(p.email) + (me ? ' (you)' : '') + '</span>' +
          '<select data-team="' + p.id + '" aria-label="Access for ' + esc(p.email) + '"' + (me ? ' disabled' : '') + '>' +
          '<option value="pending"' + (p.role === 'pending' ? ' selected' : '') + '>Pending</option>' +
          '<option value="viewer"' + (p.role === 'viewer' ? ' selected' : '') + '>Viewer</option>' +
          '<option value="editor"' + (p.role === 'editor' ? ' selected' : '') + '>Editor</option></select></div>';
      }).join('') || '<div class="empty-note">No accounts yet.</div>';
    }, function (e) { $('teamList').textContent = 'Could not load the team: ' + (e && e.message ? e.message : e); });
  }
  $('teamBox').addEventListener('toggle', function () { if ($('teamBox').open) refreshTeam(); });
  $('teamList').addEventListener('change', function (e) {
    var id = e.target.getAttribute('data-team');
    if (!id) return;
    Promise.resolve(B.setRole(id, e.target.value)).then(function (r) {
      if (r && r.error) showError('Could not change access: ' + r.error.message); else { toast('Access updated.'); refreshTeam(); }
    });
  });

  /* ---------- offline support ---------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  /* ---------- start ---------- */
  show('loading');
  B.init().then(function (r) {
    if (r && r.user) handleAuth(r.user, r.role); else handleAuth(null);
  }, function () { handleAuth(null); });
  renderConn();
})();
