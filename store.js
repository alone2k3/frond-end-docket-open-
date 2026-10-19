/* Data layer for Front End Docket.

   DocketStore.local(hooks)  keeps everything on this device (demo mode, no login).
   DocketStore.cloud(cfg, hooks)  uses Supabase: shared database, login, live updates,
   and an offline queue that uploads saved changes when the connection returns.

   Both expose the same methods, so the app code does not care which one it talks to. */
(function () {
  'use strict';

  function jget(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var CLIENT = jget('docket-client', null);
  if (!CLIENT) { CLIENT = uuid(); jset('docket-client', CLIENT); }

  /* app field name -> database column */
  var SHOOT_MAP = { date: 'shoot_date', show: 'show', loc: 'location', schedFrom: 'sched_from', schedTo: 'sched_to', actFrom: 'act_from', actTo: 'act_to', sigProd: 'sig_prod', sigSage: 'sig_sage', sigs: 'sigs' };
  var ROW_MAP = { name: 'name', desig: 'desig', card: 'card', tin: 'time_in', tout: 'time_out', sin: 'sign_in', sout: 'sign_out', amt: 'amount' };

  function toDb(map, obj) {
    var o = {};
    Object.keys(obj).forEach(function (k) {
      if (!map[k]) return;
      var v = obj[k];
      if (k === 'amt') v = (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
      o[map[k]] = v;
    });
    return o;
  }
  /* only the keys present in rec are returned, so a partial live update never blanks other fields */
  function fromDb(map, rec) {
    var o = {};
    Object.keys(map).forEach(function (k) {
      var v = rec[map[k]];
      if (v === undefined) return;
      o[k] = v == null ? '' : (typeof v === 'number' ? String(v) : v);
    });
    if (rec.id) o.id = rec.id;
    if (rec.created_at) o.created = rec.created_at;
    if (rec.shoot_id) o.shootId = rec.shoot_id;
    return o;
  }
  /* report rows: one table for the Vehicle, Camera, Picture Vehicle and Vanity Van / Generator reports */
  function rrToDb(r) {
    var o = {};
    if (r.report !== undefined) o.report = r.report;
    if (r.grp !== undefined) o.grp = r.grp || '';
    if (r.d !== undefined) o.data = r.d;
    return o;
  }
  function rrFromDb(rec) {
    var o = {};
    if (rec.id) o.id = rec.id;
    if (rec.report !== undefined) o.report = rec.report;
    if (rec.grp !== undefined) o.grp = rec.grp || '';
    if (rec.data !== undefined) o.d = rec.data || {};
    if (rec.created_at) o.created = rec.created_at;
    if (rec.shoot_id) o.shootId = rec.shoot_id;
    return o;
  }
  function byCreated(a, b) { return (a.created || '') < (b.created || '') ? -1 : (a.created || '') > (b.created || '') ? 1 : (a.id < b.id ? -1 : 1); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  /* ======================= local (demo) ======================= */
  function local(hooks) {
    var KEY = 'docket-local-v1';
    var db = jget(KEY, null);

    function persist() { jset(KEY, db); }
    function mkShoot(date, from) {
      return { id: uuid(), date: date, show: from ? from.show : '', loc: from ? from.loc : '', schedFrom: from ? from.schedFrom : '', schedTo: from ? from.schedTo : '', actFrom: '', actTo: '', sigProd: '', sigSage: '', sigs: {} };
    }
    function seed() {
      var people = [
        ['Arjun Raman', 'PRODUCTION TEAM', 'P-101', '06:30', '19:10'], ['Meena Sundar', 'PRODUCTION TEAM', 'P-102', '06:35', '19:05'],
        ['Karthik Vel', 'PRODUCTION TEAM', 'P-103', '06:40', ''], ['Vasanth Kumar', 'SPOT INCHARGE', 'S-001', '06:20', ''],
        ['Dinesh Babu', 'SPOT BOY', 'S-014', '06:45', '19:00'], ['Ganesh Mani', 'SPOT BOY', 'S-015', '06:50', ''],
        ['Prakash Raj', 'SPOT BOY', 'S-016', '06:55', ''], ['Selvam Durai', 'SPOT BOY', 'S-017', '', ''],
        ['Lakshmi Priya', 'HOUSE KEEPING', 'H-021', '07:00', ''], ['Thangam Ammal', 'HOUSE KEEPING', 'H-022', '07:05', ''],
        ['Saroja Devi', 'WATER WOMEN', 'W-031', '07:10', ''], ['Murugan R', 'CO-ELECTRICIAN', 'E-041', '06:25', ''],
        ['Suresh Anand', 'CO-ELECTRICIAN', 'E-042', '', '']
      ];
      var s = mkShoot(today(), { show: 'Untitled Feature', loc: 'Studio Floor 2', schedFrom: '07:00', schedTo: '19:00' });
      var t = Date.now();
      var rows = people.map(function (p, i) {
        return { id: uuid(), created: new Date(t + i).toISOString(), name: p[0], desig: p[1], card: p[2], tin: p[3], tout: p[4], sin: '', sout: '', amt: '' };
      });
      var d = { sample: true, shoots: [s], rows: {}, crew: people.map(function (p) { return { id: uuid(), name: p[0], desig: p[1], card: p[2] }; }) };
      d.rows[s.id] = rows;
      var rt = Date.now() + 100;
      function rr(report, grp, f) { return { id: uuid(), report: report, grp: grp, created: new Date(rt++).toISOString(), d: f }; }
      d.rrows = {};
      d.rrows[s.id] = [
        rr('veh', '', { vname: 'Tempo Traveller', vno: 'TN 09 AB 1234', vendor: 'Sri Murugan Travels', driver: 'Selvam', rep: '06:30', pack: '19:15', skm: '45210', ekm: '45288', called: 'Vasanth', rem: '' }),
        rr('veh', '', { vname: 'Innova', vno: 'TN 10 CD 5678', vendor: 'City Cabs', driver: 'Raja', rep: '07:00', pack: '', skm: '88120', ekm: '', called: 'Arjun', rem: '' }),
        rr('cam', '', { item: 'Camera body A', qty: '1', vendor: 'Frames Rentals, T Nagar', attdts: '2', util: 'Yes', rem: '' }),
        rr('cam', '', { item: 'Lens kit', qty: '1', vendor: 'Frames Rentals, T Nagar', attdts: '1', util: 'No', rem: 'Not needed today' }),
        rr('pic', '', { vname: 'Van', vno: 'TN 22 EF 9012', vendor: 'Kumar Motors', rep: '06:45', pack: '18:50', called: 'Meena', rem: '' }),
        rr('van', '', { vtype: 'Star van', vendor: 'Royal Vanity', vno: 'TN 01 GH 3456', attendant: 'Ravi', tin: '07:10', tout: '', used: 'Yes', purpose: 'Lead actor' }),
        rr('van', 'gen', { item: 'Silent generator', qty: '1', vendor: 'Power Hire, Guindy', kw: '45', s1: '07:00', e1: '12:30', s2: '13:30', e2: '19:00', util: 'Used', rem: '' })
      ];
      return d;
    }
    if (!db || !db.shoots) { db = seed(); persist(); }
    if (!db.rrows) { db.rrows = {}; persist(); }

    function findShoot(id) { for (var i = 0; i < db.shoots.length; i++) if (db.shoots[i].id === id) return db.shoots[i]; return null; }
    function findRow(id) {
      for (var sid in db.rows) { var list = db.rows[sid]; for (var i = 0; i < list.length; i++) if (list[i].id === id) return { list: list, i: i, row: list[i] }; }
      return null;
    }

    return {
      mode: 'local',
      uuid: uuid,
      init: function () { return Promise.resolve({ user: { id: 'local', email: 'This device' }, role: 'editor' }); },
      refreshRole: function () { return Promise.resolve('editor'); },
      signIn: function () { return Promise.resolve({}); },
      signUp: function () { return Promise.resolve({}); },
      signOut: function () { return Promise.resolve(); },
      listShoots: function () { return Promise.resolve(copy(db.shoots).sort(function (a, b) { return a.date < b.date ? 1 : -1; })); },
      getShoot: function (id) {
        var s = findShoot(id);
        return Promise.resolve({ shoot: copy(s), rows: copy(db.rows[id] || []).sort(byCreated), rrows: copy(db.rrows[id] || []).sort(byCreated) });
      },
      openDate: function (date, defaults) {
        for (var i = 0; i < db.shoots.length; i++) if (db.shoots[i].date === date) return Promise.resolve(copy(db.shoots[i]));
        var s = mkShoot(date, defaults);
        db.shoots.push(s); db.rows[s.id] = []; db.rrows[s.id] = []; persist();
        return Promise.resolve(copy(s));
      },
      patchShoot: function (id, fields) { var s = findShoot(id); if (s) { Object.assign(s, fields); persist(); } },
      addRow: function (shootId, row) {
        if (!db.rows[shootId]) db.rows[shootId] = [];
        db.rows[shootId].push(copy(row)); persist();
      },
      patchRow: function (id, fields) { var f = findRow(id); if (f) { Object.assign(f.row, fields); persist(); } },
      deleteRow: function (id) { var f = findRow(id); if (f) { f.list.splice(f.i, 1); persist(); } },
      addReportRow: function (shootId, row) {
        if (!db.rrows[shootId]) db.rrows[shootId] = [];
        db.rrows[shootId].push(copy(row)); persist();
      },
      patchReportRow: function (id, fields) {
        for (var sid in db.rrows) { var l = db.rrows[sid]; for (var i = 0; i < l.length; i++) if (l[i].id === id) { Object.assign(l[i], copy(fields)); persist(); return; } }
      },
      deleteReportRow: function (id) {
        for (var sid in db.rrows) { var l = db.rrows[sid]; for (var i = 0; i < l.length; i++) if (l[i].id === id) { l.splice(i, 1); persist(); return; } }
      },
      listCrew: function () { return Promise.resolve(copy(db.crew)); },
      addCrew: function (c) {
        for (var i = 0; i < db.crew.length; i++) if (db.crew[i].name.toLowerCase() === c.name.toLowerCase()) return;
        db.crew.push({ id: uuid(), name: c.name, desig: c.desig, card: c.card }); persist();
      },
      listTeam: function () { return Promise.resolve([]); },
      setRole: function () { return Promise.resolve({}); },
      watch: function () {}, unwatch: function () {},
      isSample: function () { return !!db.sample; },
      clearSample: function () {
        Object.keys(db.rows).forEach(function (k) { db.rows[k] = []; });
        Object.keys(db.rrows).forEach(function (k) { db.rrows[k] = []; });
        db.shoots.forEach(function (s) { s.show = ''; s.loc = ''; });
        db.crew = []; db.sample = false; persist();
      },
      pending: function () { return 0; }
    };
  }

  /* ======================= cloud (Supabase) ======================= */
  function cloud(cfg, hooks) {
    var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    var user = null, role = 'pending', channel = null, curShoot = null;
    var conn = 'connecting', wasDown = false;
    var outbox = jget('docket-outbox', []);
    var flushing = false, retryTimer = null, hiddenAt = 0;

    function saveBox() {
      jset('docket-outbox', outbox.map(function (o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== 'flying') c[k] = o[k]; }); return c; }));
    }
    function setConn(s) {
      if (s === 'offline') wasDown = true;
      conn = s;
      if (hooks.onStatus) hooks.onStatus(s);
    }
    function fail(error) { throw error; }

    /* ---- offline queue ---- */
    function enqueue(op) {
      if (op.t === 'patch') {
        for (var i = 0; i < outbox.length; i++) {
          var o = outbox[i];
          if (o.table === op.table && o.id === op.id) {
            if (o.t === 'delete') return;
            if (!o.flying && o.t === 'patch') { Object.assign(o.fields, op.fields); saveBox(); kick(); return; }
            if (!o.flying && o.t === 'insert') { Object.assign(o.row, op.fields); saveBox(); kick(); return; }
          }
        }
      }
      outbox.push(op); saveBox(); kick();
    }
    function kick() { if (!flushing) setTimeout(flush, 0); }
    function schedule() { clearTimeout(retryTimer); retryTimer = setTimeout(flush, 5000); }
    function run(op) {
      if (op.t === 'insert') return sb.from(op.table).upsert(op.row, { onConflict: op.conflict || 'id', ignoreDuplicates: true });
      if (op.t === 'patch') return sb.from(op.table).update(op.fields).eq('id', op.id);
      return sb.from(op.table).delete().eq('id', op.id);
    }
    function isRetry(res) {
      var err = res.error;
      if (!err.code) return true;
      if (err.code === 'PGRST301' || err.code === 'PGRST303') return true;
      return res.status === 0 || res.status === 401 || res.status >= 500;
    }
    function flush() {
      if (flushing || !user) return Promise.resolve();
      if (!outbox.length) return Promise.resolve();
      flushing = true;
      function stop() { flushing = false; if (outbox[0]) outbox[0].flying = false; schedule(); setConn('offline'); }
      function next() {
        if (!outbox.length) { flushing = false; setConn(channel ? 'live' : conn); if (hooks.onStatus) hooks.onStatus(conn); return Promise.resolve(); }
        var op = outbox[0]; op.flying = true;
        return Promise.resolve(run(op)).then(function (res) {
          res = res || {};
          if (!res.error) { outbox.shift(); saveBox(); return next(); }
          if (isRetry(res)) { if (res.status === 401 && sb.auth.refreshSession) sb.auth.refreshSession(); stop(); return; }
          outbox.shift(); saveBox();
          hooks.onError && hooks.onError(res.error.code === '42501' ? 'This account can view the sheet but not change it.' : ('Could not save: ' + res.error.message));
          return next();
        }, stop);
      }
      return next();
    }
    function overlay(shootId, rows) {
      var byId = {};
      rows.forEach(function (r) { byId[r.id] = r; });
      outbox.forEach(function (op) {
        if (op.table !== 'attendance') return;
        if (op.t === 'insert' && op.row.shoot_id === shootId && !byId[op.row.id]) { var nr = fromDb(ROW_MAP, op.row); byId[nr.id] = nr; }
        else if (op.t === 'patch' && byId[op.id]) Object.assign(byId[op.id], fromDb(ROW_MAP, op.fields));
        else if (op.t === 'delete') delete byId[op.id];
      });
      return Object.keys(byId).map(function (k) { return byId[k]; }).sort(byCreated);
    }

    function overlayR(shootId, rows) {
      var byId = {};
      rows.forEach(function (r) { byId[r.id] = r; });
      outbox.forEach(function (op) {
        if (op.table !== 'report_rows') return;
        if (op.t === 'insert' && op.row.shoot_id === shootId && !byId[op.row.id]) { var nr = rrFromDb(op.row); byId[nr.id] = nr; }
        else if (op.t === 'patch' && byId[op.id]) Object.assign(byId[op.id], rrFromDb(op.fields));
        else if (op.t === 'delete') delete byId[op.id];
      });
      return Object.keys(byId).map(function (k) { return byId[k]; }).sort(byCreated);
    }

    /* ---- session ---- */
    function loadRole() {
      return Promise.resolve(sb.from('profiles').select('role').eq('id', user.id).maybeSingle()).then(function (r) {
        if (r.error || !r.data) role = jget('docket-role-' + user.id, 'pending');
        else { role = r.data.role; jset('docket-role-' + user.id, role); }
      }, function () { role = jget('docket-role-' + user.id, 'pending'); });
    }
    function handleSession(sess) {
      if (!sess || !sess.user) { if (user) { user = null; hooks.onAuth && hooks.onAuth(null); } return Promise.resolve(); }
      if (user && user.id === sess.user.id) return Promise.resolve();
      user = { id: sess.user.id, email: sess.user.email };
      return loadRole().then(function () { hooks.onAuth && hooks.onAuth(user, role); kick(); });
    }

    window.addEventListener('online', function () { flush().then(function () { hooks.onResync && hooks.onResync(); }); });
    window.addEventListener('offline', function () { setConn('offline'); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (Date.now() - hiddenAt > 20000) { flush().then(function () { hooks.onResync && hooks.onResync(); }); }
    });

    return {
      mode: 'cloud',
      uuid: uuid,
      init: function () {
        sb.auth.onAuthStateChange(function (evt, sess) {
          if (evt === 'SIGNED_OUT') setTimeout(function () { handleSession(null); }, 0);
          else if (evt === 'SIGNED_IN') setTimeout(function () { handleSession(sess); }, 0);
        });
        return sb.auth.getSession().then(function (r) {
          var s = r && r.data && r.data.session;
          if (!s) return { user: null };
          user = { id: s.user.id, email: s.user.email };
          return loadRole().then(function () { kick(); return { user: user, role: role }; });
        }, function () { return { user: null }; });
      },
      refreshRole: function () { if (!user) return Promise.resolve('pending'); return loadRole().then(function () { return role; }); },
      signIn: function (email, password) { return sb.auth.signInWithPassword({ email: email, password: password }); },
      signUp: function (email, password) {
        return sb.auth.signUp({ email: email, password: password }).then(function (r) {
          return { error: r.error, session: r.data && r.data.session };
        });
      },
      signOut: function () { return sb.auth.signOut(); },

      listShoots: function () {
        return Promise.resolve(sb.from('shoots').select('*').order('shoot_date', { ascending: false }).limit(200)).then(function (r) {
          if (r.error) fail(r.error);
          var list = r.data.map(function (x) { return fromDb(SHOOT_MAP, x); });
          jset('docket-cache-shoots', list);
          return list;
        }).catch(function (e) {
          var c = jget('docket-cache-shoots', null);
          if (c) { setConn('offline'); return c; }
          throw e;
        });
      },
      getShoot: function (id) {
        return Promise.all([
          Promise.resolve(sb.from('shoots').select('*').eq('id', id).maybeSingle()),
          Promise.resolve(sb.from('attendance').select('*').eq('shoot_id', id).order('created_at', { ascending: true })),
          Promise.resolve(sb.from('report_rows').select('*').eq('shoot_id', id).order('created_at', { ascending: true }))
        ]).then(function (r) {
          if (r[0].error) fail(r[0].error);
          if (r[1].error) fail(r[1].error);
          var rdata = [];
          if (r[2].error) { if (r[2].error.code !== '42P01' && r[2].error.code !== 'PGRST205') fail(r[2].error); }
          else rdata = r[2].data;
          var shoot = fromDb(SHOOT_MAP, r[0].data);
          var rows = overlay(id, r[1].data.map(function (x) { return fromDb(ROW_MAP, x); }));
          var rrows = overlayR(id, rdata.map(rrFromDb));
          var out = { shoot: shoot, rows: rows, rrows: rrows };
          jset('docket-cache-shoot-' + id, out);
          return out;
        }).catch(function (e) {
          var c = jget('docket-cache-shoot-' + id, null);
          if (c) { setConn('offline'); c.rows = overlay(id, c.rows); c.rrows = overlayR(id, c.rrows || []); return c; }
          throw e;
        });
      },
      openDate: function (date, defaults) {
        defaults = defaults || {};
        return Promise.resolve(sb.from('shoots').select('*').eq('shoot_date', date).maybeSingle()).then(function (r) {
          if (r.error) fail(r.error);
          if (r.data) return fromDb(SHOOT_MAP, r.data);
          if (role !== 'editor') throw new Error('There is no sheet for ' + date + ' yet. An editor has to open it first.');
          var row = toDb(SHOOT_MAP, { date: date, show: defaults.show || '', loc: defaults.loc || '', schedFrom: defaults.schedFrom || '', schedTo: defaults.schedTo || '' });
          row.id = uuid(); row.client_id = CLIENT;
          return Promise.resolve(sb.from('shoots').upsert(row, { onConflict: 'shoot_date', ignoreDuplicates: true })).then(function (r2) {
            if (r2.error) fail(r2.error);
            return sb.from('shoots').select('*').eq('shoot_date', date).single();
          }).then(function (r3) {
            if (r3.error) fail(r3.error);
            return fromDb(SHOOT_MAP, r3.data);
          });
        });
      },
      patchShoot: function (id, fields) {
        var f = toDb(SHOOT_MAP, fields); f.client_id = CLIENT;
        enqueue({ t: 'patch', table: 'shoots', id: id, fields: f });
      },
      addRow: function (shootId, row) {
        var r = toDb(ROW_MAP, row);
        r.id = row.id; r.shoot_id = shootId; r.created_at = row.created; r.client_id = CLIENT;
        enqueue({ t: 'insert', table: 'attendance', row: r });
      },
      patchRow: function (id, fields) {
        var f = toDb(ROW_MAP, fields); f.client_id = CLIENT;
        enqueue({ t: 'patch', table: 'attendance', id: id, fields: f });
      },
      deleteRow: function (id) { enqueue({ t: 'delete', table: 'attendance', id: id }); },
      addReportRow: function (shootId, row) {
        var r = rrToDb(row);
        r.id = row.id; r.shoot_id = shootId; r.created_at = row.created; r.client_id = CLIENT;
        enqueue({ t: 'insert', table: 'report_rows', row: r });
      },
      patchReportRow: function (id, fields) {
        var f = rrToDb(fields); f.client_id = CLIENT;
        enqueue({ t: 'patch', table: 'report_rows', id: id, fields: f });
      },
      deleteReportRow: function (id) { enqueue({ t: 'delete', table: 'report_rows', id: id }); },
      listCrew: function () {
        return Promise.resolve(sb.from('crew').select('*').order('name', { ascending: true })).then(function (r) {
          if (r.error) fail(r.error);
          jset('docket-cache-crew', r.data);
          return r.data;
        }).catch(function () { return jget('docket-cache-crew', []); });
      },
      addCrew: function (c) {
        enqueue({ t: 'insert', table: 'crew', conflict: 'name', row: { id: uuid(), name: c.name, desig: c.desig, card: c.card } });
      },
      listTeam: function () {
        return Promise.resolve(sb.from('profiles').select('*').order('created_at', { ascending: true })).then(function (r) {
          if (r.error) fail(r.error);
          return r.data;
        });
      },
      setRole: function (id, newRole) { return sb.from('profiles').update({ role: newRole }).eq('id', id); },

      watch: function (shootId) {
        this.unwatch();
        curShoot = shootId;
        channel = sb.channel('docket-' + shootId + '-' + CLIENT.slice(0, 8));
        channel
          .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, function (p) {
            if (p.eventType === 'DELETE') { if (p.old && p.old.id) hooks.onRow('delete', { id: p.old.id }); return; }
            var rec = p.new;
            if (!rec || rec.shoot_id !== curShoot || rec.client_id === CLIENT) return;
            hooks.onRow('upsert', fromDb(ROW_MAP, rec));
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'report_rows' }, function (p) {
            if (p.eventType === 'DELETE') { if (p.old && p.old.id) hooks.onReportRow('delete', { id: p.old.id }); return; }
            var rec = p.new;
            if (!rec || rec.shoot_id !== curShoot || rec.client_id === CLIENT) return;
            hooks.onReportRow('upsert', rrFromDb(rec));
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'shoots' }, function (p) {
            var rec = p.new;
            if (rec && rec.id === curShoot && rec.client_id !== CLIENT) hooks.onShoot(fromDb(SHOOT_MAP, rec));
            hooks.onShootList && hooks.onShootList();
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'crew' }, function () { hooks.onCrew && hooks.onCrew(); })
          .subscribe(function (status) {
            if (status === 'SUBSCRIBED') {
              var resync = wasDown;
              wasDown = false;
              setConn('live');
              if (resync && hooks.onResync) hooks.onResync();
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              setConn('offline');
            }
          });
      },
      unwatch: function () { if (channel) { try { sb.removeChannel(channel); } catch (e) {} channel = null; } },
      isSample: function () { return false; },
      clearSample: function () {},
      pending: function () { return outbox.length; },
      flush: flush
    };
  }

  window.DocketStore = { local: local, cloud: cloud, uuid: uuid, today: today };
})();
