/* Sincronização entre aparelhos da Agenda do Corretor (Firebase: login Google + Firestore).
   Cada tarefa é um documento próprio (vence a edição mais recente); apagar vira "marca de exclusão".
   Nunca apaga tarefa local sem a nuvem dizer que ela foi apagada depois da última edição. */
(function () {
  'use strict';
  var CONFIG = {
    apiKey: 'AIzaSyBaECMgmm9YCuaDpfhc6cwSEETg2CiIRMA',
    authDomain: 'agenda-corretor-serrano.firebaseapp.com',
    projectId: 'agenda-corretor-serrano',
    storageBucket: 'agenda-corretor-serrano.firebasestorage.app',
    messagingSenderId: '350295822937',
    appId: '1:350295822937:web:081d524a1ce030868f5748'
  };
  var META = 'agenda-sync-v1';
  var A = null, B = null, uid = null, unsub = null, timer = null, ready = false, busy = false;
  var meta = loadMeta();

  function loadMeta() { try { var m = JSON.parse(localStorage.getItem(META)); if (m && typeof m === 'object') return m; } catch (e) {} return { uid: null, known: {}, sU: 0, sSig: '', want: false }; }
  function saveMeta() { try { localStorage.setItem(META, JSON.stringify(meta)); } catch (e) {} }

  // ---------- Assinaturas (o que conta como "mudou") ----------
  var VOLATILE = { lastRemind: 1, snoozeUntil: 1, u: 1 };
  function strip(t) { var o = {}; Object.keys(t).forEach(function (k) { if (!VOLATILE[k]) o[k] = t[k]; }); return o; }
  function taskSig(t) { var o = strip(t), keys = Object.keys(o).sort(), r = {}; keys.forEach(function (k) { r[k] = o[k]; }); return JSON.stringify(r); }
  function settingsData(s) { var o = {}; Object.keys(s).forEach(function (k) { if (k !== 'customSound') o[k] = s[k]; }); return o; }
  function settingsSig(s) { var o = settingsData(s), r = {}; Object.keys(o).sort().forEach(function (k) { r[k] = o[k]; }); return JSON.stringify(r); }
  function nextU(prev) { return Math.max(Date.now(), (prev || 0) + 1); }

  // ---------- Envio ----------
  function schedule() { if (!uid || !B) return; clearTimeout(timer); timer = setTimeout(pushDiff, 400); }
  function pushDiff() {
    if (!uid || !B || !ready) return;
    var st = A.get(), docs = [], cur = {}, known = meta.known, touched = false, now = Date.now();
    st.tasks.forEach(function (t) {
      var sig = taskSig(t); cur[t.id] = sig;
      if (known[t.id] !== sig) { t.u = nextU(t.u); touched = true; docs.push({ id: 't_' + t.id, k: 't', u: t.u, del: false, d: JSON.stringify(strip(t)) }); }
    });
    Object.keys(known).forEach(function (id) {
      if (!(id in cur)) { docs.push({ id: 't_' + id, k: 't', u: nextU(meta['d_' + id] || 0), del: true, d: '' }); }
    });
    if (st.settings && st.settings.setupDone) {
      var ss = settingsSig(st.settings);
      if (ss !== meta.sSig) { meta.sU = nextU(meta.sU); meta.sSig = ss; docs.push({ id: 'settings', k: 's', u: meta.sU, del: false, d: JSON.stringify(settingsData(st.settings)) }); }
    }
    if (!docs.length) return;
    if (touched) A.persist();
    var prevKnown = meta.known; meta.known = cur; saveMeta();
    B.put(uid, docs).then(function () { setStatus('ok'); }).catch(function (err) {
      // não conseguiu enviar: marca para tentar de novo na próxima mudança
      docs.forEach(function (d) { if (d.k === 't') { if (d.del) meta.known[d.id.slice(2)] = prevKnown[d.id.slice(2)] || 'x'; else delete meta.known[d.id.slice(2)]; } else meta.sSig = ''; });
      saveMeta(); setStatus('erro', err);
    });
  }

  // ---------- Recebimento ----------
  function applyRemote(docs) {
    var st = A.get(), changed = false;
    docs.forEach(function (r) {
      if (r.k === 't') {
        var id = r.id.slice(2), i = -1, l = null;
        for (var n = 0; n < st.tasks.length; n++) { if (st.tasks[n].id === id) { i = n; l = st.tasks[n]; break; } }
        if (r.del) {
          meta['d_' + id] = r.u;
          if (l && (l.u || 0) <= r.u) { st.tasks.splice(i, 1); delete meta.known[id]; changed = true; }
          else if (!l) { delete meta.known[id]; }
          return;
        }
        var parsed; try { parsed = JSON.parse(r.d); } catch (e) { return; }
        if (!l || r.u > (l.u || 0)) {
          var nt = A.normalizeTask(parsed); if (!nt) return;
          nt.id = id; nt.u = r.u;
          if (l) { nt.lastRemind = l.lastRemind || 0; nt.snoozeUntil = l.snoozeUntil || 0; st.tasks[i] = nt; } else { st.tasks.push(nt); }
          meta.known[id] = taskSig(nt); delete meta['d_' + id]; changed = true;
        } else if (l.u === r.u) { meta.known[id] = taskSig(l); }
      } else if (r.k === 's') {
        if (r.u <= (meta.sU || 0)) return;
        var s; try { s = JSON.parse(r.d); } catch (e) { return; }
        if (!s || typeof s !== 'object') return;
        if (!s.setupDone && st.settings.setupDone) return;
        var merged = Object.assign({}, st.settings, s);
        st.settings = A.normalizeSettings(merged);
        meta.sU = r.u; meta.sSig = settingsSig(st.settings); changed = true; A.closeSetup();
      }
    });
    saveMeta();
    if (changed) { A.persist(); A.refresh(); }
  }

  // ---------- Estado na tela ----------
  var btns = [];
  function setStatus(s, err) {
    if (!btns.length) return;
    if (err) { try { console.warn('sync', err); } catch (e) {} }
    var label, title;
    if (s === 'off') { label = '☁ Entrar para sincronizar'; title = 'Entre com sua conta Google para ver a mesma agenda em todos os aparelhos'; }
    else if (s === 'conectando') { label = '☁ Conectando…'; title = 'Conectando'; }
    else if (s === 'erro') { label = '☁ Sem sincronizar'; title = 'Não consegui sincronizar agora. Suas tarefas continuam salvas neste aparelho e serão enviadas depois.'; }
    else { label = '☁ Sincronizado ✓'; title = 'Sincronizando com ' + (meta.email || 'sua conta Google') + '. Toque para sair.'; }
    btns.forEach(function (b, i) { b.textContent = (i && s !== 'ok' && s !== 'conectando' && s !== 'erro') ? '☁ Já uso em outro aparelho? Entrar e trazer minha agenda' : label; b.title = title; b.setAttribute('data-state', s); });
  }

  function onUser(u) {
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    ready = false;
    if (!u) { uid = null; setStatus('off'); return; }
    if (meta.uid !== u.uid) { meta = { uid: u.uid, known: {}, sU: 0, sSig: '', want: true }; }
    meta.want = true; meta.email = u.email || ''; saveMeta();
    uid = u.uid; setStatus('conectando');
    var first = true;
    unsub = B.listen(uid, function (docs, fromServer) {
      applyRemote(docs);
      if (first) { first = false; ready = true; pushDiff(); if (fromServer !== false) setStatus('ok'); }
      else if (fromServer !== false) setStatus('ok');
    }, function (err) { setStatus('erro', err); });
  }

  // ---------- Backend Firebase ----------
  function firebaseBackend() {
    var V = '10.14.1', base = 'https://www.gstatic.com/firebasejs/' + V + '/';
    var P = Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]).then(function (m) {
      var app = m[0].initializeApp(CONFIG), auth = m[1].getAuth(app), fs = m[2], db;
      try { db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); } catch (e) { db = fs.getFirestore(app); }
      return { auth: auth, au: m[1], fs: fs, db: db };
    });
    return {
      onAuth: function (cb) { P.then(function (f) { f.au.getRedirectResult(f.auth).then(function (r) { try { var cr = r && f.au.GoogleAuthProvider.credentialFromResult(r); if (cr && cr.accessToken && window.AgendaGcal) window.AgendaGcal.setToken(cr.accessToken); } catch (e) {} }).catch(function () {}); f.au.onAuthStateChanged(f.auth, cb); }).catch(function (e) { setStatus('erro', e); }); },
      signIn: function () {
        return P.then(function (f) {
          var prov = new f.au.GoogleAuthProvider();
          return f.au.signInWithPopup(f.auth, prov).catch(function (e) {
            var c = e && e.code;
            if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment' || c === 'auth/web-storage-unsupported') { return f.au.signInWithRedirect(f.auth, prov); }
            throw e;
          });
        });
      },
      gcalAuth: function () {
        return P.then(function (f) {
          var prov = new f.au.GoogleAuthProvider();
          prov.addScope('https://www.googleapis.com/auth/calendar.events');
          var tok = function (r) { var cr = f.au.GoogleAuthProvider.credentialFromResult(r); return cr && cr.accessToken; };
          return f.au.signInWithPopup(f.auth, prov).then(tok).catch(function (e) {
            var c = e && e.code;
            if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment' || c === 'auth/web-storage-unsupported') { return f.au.signInWithRedirect(f.auth, prov).then(function () { return null; }); }
            throw e;
          });
        });
      },
      signOut: function () { return P.then(function (f) { return f.au.signOut(f.auth); }); },
      listen: function (u, cb, errCb) {
        var off = function () {}, dead = false;
        P.then(function (f) {
          if (dead) return;
          off = f.fs.onSnapshot(f.fs.collection(f.db, 'users', u, 'items'), { includeMetadataChanges: true }, function (snap) {
            var docs = []; snap.docChanges().forEach(function (c) { var x = c.doc.data(); docs.push({ id: c.doc.id, k: x.k, u: x.u, del: !!x.del, d: x.d || '' }); });
            cb(docs, !snap.metadata.fromCache);
          }, errCb);
        }).catch(errCb);
        return function () { dead = true; off(); };
      },
      put: function (u, docs) {
        return P.then(function (f) {
          var jobs = [];
          for (var i = 0; i < docs.length; i += 400) {
            var b = f.fs.writeBatch(f.db);
            docs.slice(i, i + 400).forEach(function (d) { b.set(f.fs.doc(f.db, 'users', u, 'items', d.id), { k: d.k, u: d.u, del: d.del, d: d.d }); });
            jobs.push(b.commit());
          }
          return Promise.all(jobs);
        });
      }
    };
  }

  // ---------- Início ----------
  function ensureBackend() { if (!B) { B = (window.AGENDA_SYNC_BACKEND ? window.AGENDA_SYNC_BACKEND() : firebaseBackend()); B.onAuth(onUser); } return B; }
  function init() {
    A = window.AgendaApp; if (!A) return;
    btns = [].slice.call(document.querySelectorAll('[data-sync]')); if (!btns.length) return;
    setStatus('off');
    btns.forEach(function (btn) { btn.addEventListener('click', onClick); });
    function onClick() {
      if (busy) return;
      if (uid) { if (window.confirm('Parar de sincronizar neste aparelho? Suas tarefas continuam aqui.')) { meta.want = false; saveMeta(); B.signOut().catch(function () {}); } return; }
      busy = true; setStatus('conectando'); ensureBackend();
      meta.want = true; saveMeta();
      B.signIn().then(function () { busy = false; }).catch(function (e) { busy = false; setStatus('off'); A.toast(e && e.code === 'auth/popup-closed-by-user' ? 'Login cancelado.' : 'Não consegui entrar com o Google agora. Tente de novo.'); try { console.warn('sync', e); } catch (x) {} });
    }
    if (meta.want) { setStatus('conectando'); ensureBackend(); }
    window.addEventListener('online', function () { if (uid) schedule(); });
  }

  window.AgendaSync = { changed: schedule, gcalAuth: function () { ensureBackend(); return B.gcalAuth(); }, _taskSig: taskSig, _meta: function () { return meta; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
