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
    onReportRow: function (type, row) { applyRemoteReportRow(type, row); },
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
    if (st.shoot && st.view !== 'att') renderReport();
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
      st.shoot = r.shoot; st.rows = r.rows; st.rrows = r.rrows || [];
      fillMeta(); renderRows(); renderFoot(); renderUser();
      setView(st.view);
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
      st.shoot = r.shoot; st.rows = r.rows; st.rrows = r.rrows || [];
      fillMeta(); renderRowsKeepFocus(); renderFoot();
      if (st.view !== 'att') renderReport();
      updateNav();
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
  function queue(kind, id, fields, now, keys) {
    var key = kind + ':' + id;
    var p = pend[key] || (pend[key] = { kind: kind, id: id, fields: {}, keys: {}, timer: null });
    (keys || []).forEach(function (k) { p.keys[k] = 1; });
    Object.keys(fields).forEach(function (k) { p.fields[k] = fields[k]; });
    clearTimeout(p.timer);
    if (now) flushKey(key); else p.timer = setTimeout(function () { flushKey(key); }, 350);
  }
  function flushKey(key) {
    var p = pend[key];
    if (!p) return;
    clearTimeout(p.timer); delete pend[key];
    if (p.kind === 'r') B.patchRow(p.id, p.fields); else if (p.kind === 'rr') B.patchReportRow(p.id, p.fields); else B.patchShoot(p.id, p.fields);
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
      markEmpty(el);
    });
  }
  document.querySelectorAll('[data-m]').forEach(function (el) {
    el.addEventListener('input', function () {
      if (!st.shoot || !canEdit()) return;
      var k = el.getAttribute('data-m');
      st.shoot[k] = el.value;
      markEmpty(el);
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
    if (!st.shoot.sigs || typeof st.shoot.sigs !== 'object') st.shoot.sigs = {};
    fillMeta(); renderFoot(); renderRFoot();
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
    } else if (t.kind === 'rrow') {
      var ri = rrIndex(t.id);
      if (ri < 0) return;
      st.rrows[ri].d[t.key] = data;
      saveRR(st.rrows[ri], t.key, true);
      refreshRRDom(t.id);
    } else if (t.kind === 'rfoot') {
      var ns = Object.assign({}, sigs());
      if (data) ns[t.key] = data; else delete ns[t.key];
      st.shoot.sigs = ns;
      queue('s', st.shoot.id, { sigs: ns }, true);
      renderRFoot();
    } else {
      st.shoot[t.key] = data;
      var p = {}; p[t.key] = data;
      queue('s', st.shoot.id, p, true);
      renderFoot();
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('modal').hidden) closePad(); });

  /* ---------- more reports: vehicle, camera, picture vehicle, vanity van + generator ---------- */
  var T = 'text', TM = 'time', NUM = 'num', YN = 'yn', SIG = 'sig', CT = 'calcTime', CK = 'calcKm';
  function C(k, l, t, w, o) { var c = { k: k, l: l, t: t, w: w || 'minmax(110px,1fr)' }; if (o) Object.keys(o).forEach(function (x) { c[x] = o[x]; }); return c; }
  function n0(v) { var x = parseFloat(v); return isNaN(x) ? 0 : x; }
  function minutes(v) { var m = /^(\d{1,2}):(\d{2})/.exec(v || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function calcVal(c, d) {
    if (c.t === CT) {
      var a = minutes(d[c.from]), b = minutes(d[c.to]);
      if (a == null || b == null) return '';
      var diff = (b - a + 1440) % 1440;
      return Math.floor(diff / 60) + ':' + String(diff % 60).padStart(2, '0');
    }
    var x = parseFloat(d[c.from]), y = parseFloat(d[c.to]);
    if (isNaN(x) || isNaN(y) || y < x) return '';
    return String(Math.round((y - x) * 10) / 10);
  }
  function usageCols() {
    var out = [];
    for (var i = 1; i <= 4; i++) { out.push(C('s' + i, 'Usage start ' + i, TM, '132px', { now: false })); out.push(C('e' + i, 'Usage end ' + i, TM, '132px', { now: false })); }
    return out;
  }
  var REPORTS = {
    veh: {
      title: 'Vehicle report',
      tables: [{ grp: '', cols: [
        C('vname', 'Vehicle name', T, 'minmax(130px,1.2fr)', { wide: 1 }), C('vno', 'Vehicle number', T, '130px'),
        C('vendor', 'Vendor name', T, 'minmax(130px,1.2fr)', { wide: 1 }), C('driver', 'Driver name', T, 'minmax(120px,1fr)', { wide: 1 }),
        C('sign', 'Sign.', SIG, '100px'), C('rep', 'Reporting time', TM, '198px'), C('pack', 'Packup time', TM, '198px'),
        C('ttime', 'Total time', CT, '80px', { from: 'rep', to: 'pack' }),
        C('skm', 'Start km', NUM, '92px'), C('ekm', 'End km', NUM, '92px'), C('tkm', 'Total km', CK, '80px', { from: 'skm', to: 'ekm' }),
        C('called', 'Called by', T, 'minmax(110px,1fr)'), C('rem', 'Remarks', T, 'minmax(150px,1.4fr)', { wide: 1 })] }],
      stats: function (rows) {
        var km = 0, out = 0, done = 0;
        rows.forEach(function (r) { km += n0(calcVal({ t: CK, from: 'skm', to: 'ekm' }, r.d)); if (r.d.rep && !r.d.pack) out++; if (r.d.pack) done++; });
        return [[rows.length, 'Vehicles'], [Math.round(km * 10) / 10, 'Total km'], [out, 'Still out', 'warn'], [done, 'Packed up', 'good']];
      }
    },
    cam: {
      title: 'Camera report', sub: 'To include only items purchased by Spot Dept.',
      tables: [{ grp: '', cols: [
        C('item', 'Item', T, 'minmax(160px,1.4fr)', { wide: 1 }), C('qty', 'Quantity', NUM, '100px'),
        C('vendor', 'Vendor name & address', T, 'minmax(180px,1.6fr)', { wide: 1 }), C('attdts', 'No. of attdts.', NUM, '100px'),
        C('util', 'Utilization', YN, '110px'), C('rem', 'Remarks', T, 'minmax(150px,1.4fr)', { wide: 1 })] }],
      stats: function (rows) {
        var q = 0, a = 0, y = 0;
        rows.forEach(function (r) { q += n0(r.d.qty); a += n0(r.d.attdts); if (r.d.util === 'Yes') y++; });
        return [[rows.length, 'Items'], [q, 'Total quantity'], [a, 'Attendants'], [y, 'Utilised', 'good']];
      }
    },
    pic: {
      title: 'Picture vehicle report',
      tables: [{ grp: '', cols: [
        C('vname', 'Vehicle name', T, 'minmax(130px,1.2fr)', { wide: 1 }), C('vno', 'Vehicle number', T, '130px'),
        C('vendor', 'Vendor name', T, 'minmax(140px,1.3fr)', { wide: 1 }),
        C('rep', 'Reporting time', TM, '198px'), C('pack', 'Packup time', TM, '198px'),
        C('ttime', 'Total time', CT, '80px', { from: 'rep', to: 'pack' }),
        C('called', 'Called by', T, 'minmax(110px,1fr)'), C('rem', 'Remark', T, 'minmax(150px,1.4fr)', { wide: 1 })] }],
      stats: function (rows) {
        var out = 0, done = 0;
        rows.forEach(function (r) { if (r.d.rep && !r.d.pack) out++; if (r.d.pack) done++; });
        return [[rows.length, 'Vehicles'], [out, 'Still out', 'warn'], [done, 'Packed up', 'good']];
      }
    },
    van: {
      title: 'Vanity van report',
      tables: [
        { grp: '', cols: [
          C('vtype', 'Vanity type', T, 'minmax(120px,1fr)'), C('vendor', 'Vendor name', T, 'minmax(130px,1.2fr)', { wide: 1 }),
          C('vno', 'Vehicle number', T, '130px'), C('attendant', 'Attendant', T, 'minmax(110px,1fr)'),
          C('tin', 'Time in', TM, '198px'), C('sin', 'Sign in', SIG, '100px'),
          C('tout', 'Time out', TM, '198px'), C('sout', 'Sign out', SIG, '100px'),
          C('used', 'Used (Y/N)', YN, '100px'), C('purpose', 'Purpose', T, 'minmax(150px,1.4fr)', { wide: 1 })] },
        { grp: 'gen', title: 'Generator report', cols: [
          C('item', 'Item', T, 'minmax(130px,1.2fr)', { wide: 1 }), C('qty', 'Qty', NUM, '70px'),
          C('vendor', 'Vendor name & address', T, 'minmax(170px,1.5fr)', { wide: 1 }), C('kw', 'KW', NUM, '76px')
        ].concat(usageCols()).concat([
          C('util', 'Utilisation', T, 'minmax(100px,1fr)'), C('rem', 'Remark (stands by / others)', T, 'minmax(150px,1.4fr)', { wide: 1 })]) }
      ],
      stats: function (rows) {
        var vans = 0, use = 0, gens = 0;
        rows.forEach(function (r) { if (r.grp === 'gen') gens++; else { vans++; if (r.d.tin && !r.d.tout) use++; } });
        return [[vans, 'Vanity vans'], [use, 'In use now', 'warn'], [gens, 'Generators']];
      }
    }
  };
  var VIEWS = ['att', 'veh', 'cam', 'pic', 'van'];
  st.view = 'att'; st.rrows = [];
  var rToastTimer = null;

  function rowsOf(report, grp) {
    return st.rrows.filter(function (r) { return r.report === report && (grp == null || (r.grp || '') === grp); });
  }
  function rrIndex(id) { for (var i = 0; i < st.rrows.length; i++) if (st.rrows[i].id === id) return i; return -1; }
  function tableOfRow(r) {
    var def = REPORTS[r.report], tabs = def ? def.tables : [];
    for (var i = 0; i < tabs.length; i++) if (tabs[i].grp === (r.grp || '')) return tabs[i];
    return tabs[0];
  }
  function gridOf(tb) {
    var minw = 48 + 34, widths = tb.cols.map(function (c) { var m = /\d+/.exec(c.w); minw += m ? +m[0] : 100; return c.w; });
    minw += 8 * (tb.cols.length + 2) + 32;
    /* on paper the columns share the page width instead of using fixed pixel widths */
    var weight = { text: 1.1, num: 0.6, time: 0.85, yn: 0.55, sig: 0.8, calcTime: 0.6, calcKm: 0.6 };
    var pw = tb.cols.map(function (c) { return ((weight[c.t] || 1) * (c.wide ? 1.35 : 1)).toFixed(2) + 'fr'; });
    return { cols: '48px ' + widths.join(' ') + ' 34px', minw: minw, pcols: '0.35fr ' + pw.join(' ') };
  }
  function sigs() { var s = st.shoot && st.shoot.sigs; return s && typeof s === 'object' ? s : {}; }

  function rSig(r, k) {
    var data = r.d[k], dis = canEdit() ? '' : ' disabled';
    if (data) return '<button type="button" class="sigthumb" data-act="sign" data-k="' + k + '"' + dis + ' aria-label="Edit signature"><img alt="Signature" src="' + esc(data) + '"></button>';
    return '<button type="button" class="btn ghost sm" data-act="sign" data-k="' + k + '"' + dis + '>Sign</button>';
  }
  function rCell(c, r, dis) {
    var v = r.d[c.k] || '', lab = ' data-l="' + esc(c.l) + '"', cls = 'c' + (c.wide ? ' wide' : ''), al = ' aria-label="' + esc(c.l) + '"';
    if (c.t === T) return '<div class="' + cls + '"' + lab + '><input type="text" data-f="' + c.k + '" value="' + esc(v) + '"' + al + dis + '></div>';
    if (c.t === NUM) return '<div class="' + cls + '"' + lab + '><input type="number" inputmode="decimal" step="any" data-f="' + c.k + '" value="' + esc(v) + '"' + al + dis + '></div>';
    if (c.t === TM) return '<div class="' + cls + '"' + lab + '><div class="tm"><input type="time" data-f="' + c.k + '" value="' + esc(v) + '"' + (v ? '' : ' data-e="1"') + al + dis + '>' +
      (c.now === false ? '' : '<button type="button" class="btn ghost sm" data-act="now" data-k="' + c.k + '"' + dis + '>Now</button>') + '</div></div>';
    if (c.t === YN) return '<div class="' + cls + '"' + lab + '><select class="yn" data-f="' + c.k + '"' + al + dis + '>' +
      ['', 'Yes', 'No'].map(function (o) { return '<option value="' + o + '"' + (v === o ? ' selected' : '') + '>' + (o || '–') + '</option>'; }).join('') + '</select></div>';
    if (c.t === SIG) return '<div class="' + cls + '"' + lab + ' data-sig="' + c.k + '">' + rSig(r, c.k) + '</div>';
    var cv = calcVal(c, r.d);
    return '<div class="' + cls + '"' + lab + '><output class="calc' + (cv ? '' : ' empty') + '" data-calc="' + c.k + '">' + (cv || '–') + '</output></div>';
  }
  function rRowHTML(r, i, tb) {
    var dis = canEdit() ? '' : ' disabled';
    return '<div class="rrow" data-id="' + r.id + '"><div class="c srw"><span class="srn">' + (i + 1) + '</span></div>' +
      tb.cols.map(function (c) { return rCell(c, r, dis); }).join('') +
      '<div class="c dl"><button type="button" class="del" data-act="del"' + dis + ' aria-label="Remove row ' + (i + 1) + '">&times;</button></div></div>';
  }
  function rStatsHTML() {
    var def = REPORTS[st.view];
    return def.stats(rowsOf(st.view)).map(function (s) { return '<div class="stat ' + (s[2] || '') + '"><b>' + s[0].toLocaleString('en-IN') + '</b><span>' + esc(s[1]) + '</span></div>'; }).join('');
  }
  function rFootHTML() {
    var sg = sigs();
    return [['prod', 'Production team signature'], ['sage', 'SAGE team signature']].map(function (p) {
      var data = sg[st.view + '_' + p[0]];
      return '<div class="sigbox"><span class="lbl">' + p[1] + '</span><button type="button" class="sigarea" data-rfoot="' + p[0] + '"' + (canEdit() ? '' : ' disabled') + '>' +
        (data ? '<img alt="Signature" src="' + esc(data) + '">' : 'Tap to sign') + '</button>' +
        (data && canEdit() ? '<button type="button" class="clear" data-rfootclear="' + p[0] + '">Clear signature</button>' : '') + '</div>';
    }).join('');
  }
  function renderRFoot() { var el = $('rfoot'); if (el && st.view !== 'att') el.innerHTML = rFootHTML(); }
  function updateRStats() { var el = $('rstats'); if (el && st.view !== 'att') el.innerHTML = rStatsHTML(); }

  function renderReport() {
    var def = REPORTS[st.view];
    if (!def) return;
    var keepScroll = [], old = $('view-rep').querySelectorAll('.rscroll');
    for (var q = 0; q < old.length; q++) keepScroll.push(old[q].scrollLeft);
    var html = '<section class="panel"><div class="rhead"><div><h2>' + esc(def.title) + '</h2>' + (def.sub ? '<div class="rsub">' + esc(def.sub) + '</div>' : '') + '</div>' +
      '<div class="reg-actions"><span class="toast" id="rtoast" role="status"></span><button class="btn ghost sm" type="button" data-ract="copy">Copy for Excel</button>' +
      '<button class="btn ghost sm" type="button" data-ract="csv">Download CSV</button><button class="btn sm" type="button" data-ract="print">Print / Save PDF</button></div></div>' +
      '<div class="counts solo"><div class="stats" id="rstats">' + rStatsHTML() + '</div></div></section>';
    def.tables.forEach(function (tb) {
      var rows = rowsOf(st.view, tb.grp), g = gridOf(tb);
      html += '<section class="panel rtable" aria-label="' + esc(tb.title || def.title) + '">' + (tb.title ? '<div class="reg-head"><h2>' + esc(tb.title) + '</h2></div>' : '') +
        '<div class="rscroll"><div class="rgrid" style="--cols:' + g.cols + ';--pcols:' + g.pcols + ';--minw:' + g.minw + 'px">' +
        '<div class="rcols" aria-hidden="true"><span>Sr.</span>' + tb.cols.map(function (c) { return '<span>' + esc(c.l) + '</span>'; }).join('') + '<span></span></div>' +
        '<div class="rrows" data-grp="' + tb.grp + '">' + (rows.length ? rows.map(function (r, i) { return rRowHTML(r, i, tb); }).join('') :
          '<div class="rrow" style="grid-template-columns:1fr"><div class="empty-note">' + (canEdit() ? 'No rows yet. Tap “Add row” to start.' : 'An editor has not added anything here for this day yet.') + '</div></div>') +
        '</div></div></div><div class="radd"><button type="button" class="btn sm" data-radd="' + tb.grp + '">+ Add row</button><span class="hint">' + rows.length + (rows.length === 1 ? ' row' : ' rows') + '</span></div></section>';
    });
    html += '<section class="panel foot" id="rfoot" aria-label="Team signatures">' + rFootHTML() + '</section>';
    $('view-rep').innerHTML = html;
    var nw = $('view-rep').querySelectorAll('.rscroll');
    for (var z = 0; z < nw.length; z++) if (keepScroll[z]) nw[z].scrollLeft = keepScroll[z];
  }

  function updateNav() {
    document.querySelectorAll('[data-nc]').forEach(function (el) {
      var k = el.getAttribute('data-nc'), n = k === 'att' ? st.rows.length : rowsOf(k).length;
      el.textContent = n ? String(n) : '';
    });
  }
  function setView(v, fromClick) {
    if (VIEWS.indexOf(v) < 0) v = 'att';
    st.view = v;
    $('view-att').hidden = v !== 'att';
    $('view-rep').hidden = v === 'att';
    document.querySelectorAll('.navb').forEach(function (b) {
      if (b.getAttribute('data-view') === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('subTitle').textContent = 'Shoot review sheet · ' + (v === 'att' ? 'Attendance report' : REPORTS[v].title);
    if (v !== 'att') renderReport();
    updateNav();
    try { localStorage.setItem('docket-view', v); } catch (e) {}
    try { if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v); } catch (e) {}
    if (fromClick) window.scrollTo(0, 0);
  }
  $('nav').addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]');
    if (b) setView(b.getAttribute('data-view'), true);
  });
  function startView() {
    var v = (location.hash || '').replace('#', '');
    if (VIEWS.indexOf(v) < 0) { try { v = localStorage.getItem('docket-view') || 'att'; } catch (e) { v = 'att'; } }
    st.view = VIEWS.indexOf(v) < 0 ? 'att' : v;
  }
  startView();
  function rToast(msg) {
    var t = $('rtoast'); if (!t) return;
    t.textContent = msg; clearTimeout(rToastTimer);
    rToastTimer = setTimeout(function () { var x = $('rtoast'); if (x) x.textContent = ''; }, 2500);
  }

  /* editing report rows */
  function rRowEl(id) { return $('view-rep').querySelector('.rrow[data-id="' + id + '"]'); }
  function refreshRRDom(id) {
    var i = rrIndex(id), el = rRowEl(id);
    if (i < 0 || !el) return;
    var r = st.rrows[i], tb = tableOfRow(r);
    el.querySelectorAll('[data-f]').forEach(function (inp) {
      if (inp !== document.activeElement) inp.value = r.d[inp.getAttribute('data-f')] || '';
      markEmpty(inp);
    });
    tb.cols.forEach(function (c) {
      if (c.t === SIG) { var cell = el.querySelector('[data-sig="' + c.k + '"]'); if (cell) cell.innerHTML = rSig(r, c.k); }
      else if (c.t === CT || c.t === CK) {
        var o = el.querySelector('[data-calc="' + c.k + '"]'), cv = calcVal(c, r.d);
        if (o) { o.textContent = cv || '–'; o.className = 'calc' + (cv ? '' : ' empty'); }
      }
    });
    updateRStats();
  }
  /* lets the print stylesheet hide the empty "--:-- --" placeholder of time boxes */
  function markEmpty(el) { if (el && el.type === 'time') { if (el.value) el.removeAttribute('data-e'); else el.setAttribute('data-e', '1'); } }
  function saveRR(r, key, now) {
    queue('rr', r.id, { d: JSON.parse(JSON.stringify(r.d)) }, now, [key]);
  }
  $('view-rep').addEventListener('input', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-f');
    if (!f || !canEdit()) return;
    var rw = e.target.closest('.rrow'), i = rrIndex(rw && rw.getAttribute('data-id'));
    if (i < 0) return;
    st.rrows[i].d[f] = e.target.value;
    markEmpty(e.target);
    saveRR(st.rrows[i], f);
    refreshRRDom(st.rrows[i].id);
  });
  var rArm = null;
  $('view-rep').addEventListener('click', function (e) {
    var t = e.target;
    var ra = t.closest('[data-ract]');
    if (ra) { reportAction(ra.getAttribute('data-ract')); return; }
    if (!canEdit() || !st.shoot) return;
    var add = t.closest('[data-radd]');
    if (add) {
      var row = { id: B.uuid(), report: st.view, grp: add.getAttribute('data-radd') || '', created: new Date().toISOString(), d: {} };
      st.rrows.push(row); B.addReportRow(st.shoot.id, row);
      renderReport(); updateNav(); renderConn();
      var fresh = rRowEl(row.id), first = fresh && fresh.querySelector('input:not([type=hidden])');
      if (first) first.focus();
      return;
    }
    var rf = t.closest('[data-rfoot]');
    if (rf) { var k = rf.getAttribute('data-rfoot'); openPad({ kind: 'rfoot', key: st.view + '_' + k }, k === 'prod' ? 'Production team' : 'SAGE team'); return; }
    var rc = t.closest('[data-rfootclear]');
    if (rc) {
      var key = st.view + '_' + rc.getAttribute('data-rfootclear'), ns = Object.assign({}, sigs());
      delete ns[key]; st.shoot.sigs = ns;
      queue('s', st.shoot.id, { sigs: ns }, true);
      renderRFoot(); return;
    }
    var btn = t.closest('[data-act]');
    if (!btn) return;
    var rw = btn.closest('.rrow'), id = rw && rw.getAttribute('data-id'), i = rrIndex(id);
    if (i < 0) return;
    var r = st.rrows[i], act = btn.getAttribute('data-act'), kk = btn.getAttribute('data-k');
    if (act === 'now') {
      r.d[kk] = nowHM(); saveRR(r, kk, true); refreshRRDom(id);
      var inp = rw.querySelector('[data-f="' + kk + '"]'); if (inp) inp.value = r.d[kk];
    } else if (act === 'sign') {
      openPad({ kind: 'rrow', id: id, key: kk }, (tableOfRow(r).cols.filter(function (c) { return c.k === kk; })[0] || {}).l || 'Signature');
    } else if (act === 'del') {
      if (btn.getAttribute('data-armed')) {
        clearTimeout(rArm);
        st.rrows.splice(i, 1); delete pend['rr:' + id];
        B.deleteReportRow(id);
        renderReport(); updateNav(); renderConn();
      } else {
        btn.setAttribute('data-armed', '1'); btn.textContent = 'Sure?'; btn.classList.add('armed');
        clearTimeout(rArm);
        rArm = setTimeout(function () { btn.removeAttribute('data-armed'); btn.innerHTML = '&times;'; btn.classList.remove('armed'); }, 3000);
      }
    }
  });

  function applyRemoteReportRow(type, row) {
    if (type === 'delete') {
      var di = rrIndex(row.id);
      if (di >= 0) { var rep = st.rrows[di].report; st.rrows.splice(di, 1); if (st.view === rep) renderReport(); updateNav(); }
      return;
    }
    var i = rrIndex(row.id);
    if (i >= 0) {
      var cur = st.rrows[i], p = pend['rr:' + row.id];
      Object.keys(row.d || {}).forEach(function (k) { if (!(p && p.keys && p.keys[k])) cur.d[k] = row.d[k]; });
      if (st.view === cur.report) refreshRRDom(row.id);
    } else {
      st.rrows.push({ id: row.id, report: row.report, grp: row.grp || '', created: row.created || '', d: row.d || {} });
      st.rrows.sort(function (a, b) { return (a.created || '') < (b.created || '') ? -1 : 1; });
      if (st.view === row.report) renderReport();
    }
    updateNav();
  }

  /* exports for the report screens */
  function reportLines() {
    var def = REPORTS[st.view], out = [];
    def.tables.forEach(function (tb, ti) {
      if (ti) out.push({ blank: true });
      if (tb.title) out.push({ title: tb.title });
      out.push({ head: true, cells: ['Sr. No.'].concat(tb.cols.map(function (c) { return c.l; })) });
      rowsOf(st.view, tb.grp).forEach(function (r, i) {
        out.push({ cells: [i + 1].concat(tb.cols.map(function (c) {
          if (c.t === SIG) return r.d[c.k] ? 'Yes' : 'No';
          if (c.t === CT || c.t === CK) return calcVal(c, r.d);
          return r.d[c.k] || '';
        })) });
      });
    });
    return out;
  }
  function reportAction(a) {
    var sh = st.shoot || {}, def = REPORTS[st.view], lines = reportLines();
    if (a === 'print') { window.print(); return; }
    if (a === 'copy') {
      var text = lines.map(function (l) { return l.blank ? '' : l.title ? l.title : l.cells.map(safeCell).join('\t'); }).join('\n');
      var done = function (ok) { rToast(ok ? 'Copied. Paste into Excel.' : 'Copy was blocked by this browser.'); };
      var fb = function () {
        var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); var ok = false;
        try { ok = document.execCommand('copy'); } catch (err) {}
        document.body.removeChild(ta); done(ok);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fb); else fb();
      return;
    }
    var csv = lines.map(function (l) {
      if (l.blank) return '';
      if (l.title) return csvCell(l.title);
      var pre = l.head ? ['Date', 'Movie / Show', 'Location'] : [sh.date, sh.show, sh.loc];
      return pre.concat(l.cells).map(csvCell).join(',');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob), el = document.createElement('a');
    el.href = url; el.download = st.view + '-report-' + (sh.date || 'sheet') + '.csv';
    document.body.appendChild(el); el.click(); document.body.removeChild(el);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    rToast('CSV downloaded.');
  }

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
