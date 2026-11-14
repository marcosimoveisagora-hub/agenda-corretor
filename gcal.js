/* Aviso no celular pelo Google Agenda (opcional).
   Cria um evento com alarme na hora de cada tarefa pendente; o Google avisa no celular mesmo com o app fechado.
   Só mexe em eventos criados por esta agenda (id próprio). Se algo falhar, os avisos do app continuam normais. */
(function () {
  'use strict';
  var KEY = 'agenda-gcal-v1', API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events/', TZ = 'America/Sao_Paulo';
  var S = load(), timer = null, running = false, rerun = false, btn = null;

  function load() { try { var m = JSON.parse(localStorage.getItem(KEY)); if (m && typeof m === 'object') { m.map = m.map || {}; return m; } } catch (e) {} return { on: false, map: {}, tok: '', exp: 0 }; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function A() { return window.AgendaApp; }
  function toast(m) { try { A().toast(m); } catch (e) {} }

  // id fixo por tarefa (letras a-v e números): vários aparelhos não duplicam o evento
  function evId(id) { var h = 'agd'; for (var i = 0; i < id.length; i++) h += id.charCodeAt(i).toString(32); return h.toLowerCase(); }
  function hasTok() { return !!S.tok && Date.now() < S.exp; }
  function setToken(t) { if (!t) return; S.tok = t; S.exp = Date.now() + 55 * 60 * 1000; S.on = true; save(); paint(); schedule(); }

  function addMin(hhmm, m) { var p = hhmm.split(':'), v = (+p[0]) * 60 + (+p[1]) + m; v = Math.min(v, 23 * 60 + 59); return ('0' + Math.floor(v / 60)).slice(-2) + ':' + ('0' + (v % 60)).slice(-2); }
  function wanted(t) {
    if (t.done || t.cancelled || !t.date || !t.start) return false;
    return new Date(t.date + 'T' + t.start + ':00').getTime() > Date.now() - 60000;
  }
  function sigOf(t) { return [t.title, t.date, t.start, t.end || ''].join('|'); }
  function body(t, id) {
    var end = (t.end && t.end > t.start) ? t.end : addMin(t.start, 30);
    return { id: id, summary: t.title, description: 'Agenda do Corretor', start: { dateTime: t.date + 'T' + t.start + ':00', timeZone: TZ }, end: { dateTime: t.date + 'T' + end + ':00', timeZone: TZ },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] }, status: 'confirmed' };
  }
  function call(method, id, payload) {
    return fetch(API + (id || ''), { method: method, headers: { Authorization: 'Bearer ' + S.tok, 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
  }
  function upsert(t) {
    var id = evId(t.id), b = body(t, id);
    return call('POST', '', b).then(function (r) { if (r.status === 409) return call('PUT', id, b); return r; });
  }

  function run() {
    if (!S.on || !A()) return Promise.resolve();
    if (!hasTok()) { paint(); return Promise.resolve(); }
    if (running) { rerun = true; return Promise.resolve(); }
    running = true;
    var tasks = A().get().tasks, byId = {}, jobs = [], failed = false, expired = false;
    tasks.forEach(function (t) { byId[t.id] = t; });
    tasks.forEach(function (t) {
      if (!wanted(t)) return;
      var sig = sigOf(t); if (S.map[t.id] === sig) return;
      jobs.push(upsert(t).then(function (r) {
        if (r.status === 401) expired = true; else if (r.ok) S.map[t.id] = sig; else failed = true;
      }).catch(function () { failed = true; }));
    });
    Object.keys(S.map).forEach(function (id) {
      if (byId[id] && wanted(byId[id])) return;
      if (byId[id] && !byId[id].done && !byId[id].cancelled) { delete S.map[id]; return; } // já passou: o Google já avisou
      jobs.push(call('DELETE', evId(id)).then(function (r) {
        if (r.status === 401) expired = true; else if (r.ok || r.status === 404 || r.status === 410) delete S.map[id]; else failed = true;
      }).catch(function () { failed = true; }));
    });
    return Promise.all(jobs).then(function () {
      if (expired) { S.exp = 0; toast('O Google pediu para você confirmar de novo. Toque em "Avisar no celular".'); }
      else if (failed) toast('Não consegui atualizar o Google Agenda agora. Tento de novo na próxima mudança.');
      save(); paint();
    }).then(function () { running = false; if (rerun) { rerun = false; schedule(); } });
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(run, 800); }

  function paint() {
    if (!btn) return;
    var st = !S.on ? 'off' : (hasTok() ? 'ok' : 'renew');
    btn.setAttribute('data-state', st);
    btn.textContent = st === 'ok' ? '🔔 Avisando no celular ✓' : (st === 'renew' ? '🔔 Reativar aviso no celular' : '🔔 Avisar no celular (Google Agenda)');
    btn.title = st === 'ok' ? 'Cada tarefa vira um evento com alarme no seu Google Agenda. Toque para desligar.' : 'Faz o celular avisar na hora da tarefa, mesmo com o app fechado, usando seu Google Agenda.';
  }

  function turnOff() {
    var ids = Object.keys(S.map), jobs = hasTok() ? ids.map(function (id) { return call('DELETE', evId(id)).catch(function () {}); }) : [];
    return Promise.all(jobs).then(function () {
      S.on = false; S.map = {}; S.tok = ''; S.exp = 0; save(); paint();
      toast(jobs.length ? 'Aviso pelo Google Agenda desligado e eventos removidos.' : 'Aviso pelo Google Agenda desligado. Eventos já criados continuam no seu Google Agenda.');
    });
  }
  function onClick() {
    if (S.on && hasTok()) { if (window.confirm('Desligar o aviso pelo Google Agenda? Os eventos criados serão removidos.')) turnOff(); return; }
    if (!window.AgendaSync || !window.AgendaSync.gcalAuth) { toast('Não consegui abrir o login do Google agora.'); return; }
    window.AgendaSync.gcalAuth().then(function (tok) { if (tok) { setToken(tok); toast('Pronto! Suas tarefas vão avisar também pelo Google Agenda.'); } })
      .catch(function (e) { toast(e && e.code === 'auth/popup-closed-by-user' ? 'Login cancelado.' : 'Não consegui ativar o Google Agenda agora. Tente de novo.'); });
  }

  function init() {
    btn = document.getElementById('gcalBtn'); if (!A()) return;
    if (btn) { btn.addEventListener('click', onClick); paint(); }
    if (window.AgendaSync && window.AgendaSync.changed) { var o = window.AgendaSync.changed; window.AgendaSync.changed = function () { try { o.apply(this, arguments); } catch (e) {} schedule(); }; }
    if (S.on) schedule();
  }
  window.AgendaGcal = { setToken: setToken, run: run, _state: function () { return S; }, _evId: evId };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
