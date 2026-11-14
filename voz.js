/* Comando de voz da Agenda do Corretor: botão de microfone ao lado do "Criar".
   Usa o reconhecimento de voz do navegador (pt-BR). Nada é gravado nem enviado por este app. */
(function(){
  'use strict';
  var quick=document.getElementById('quick'), form=document.getElementById('quickForm');
  if(!quick||!form) return;
  var row=form.querySelector('.row'), submitBtn=row&&row.querySelector('button[type=submit]');
  if(!row||!submitBtn) return;

  var css=document.createElement('style');
  css.textContent=
   '#micBtn{width:46px;min-width:46px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff;border:2px solid var(--teal,#0F4C46);color:var(--teal,#0F4C46);position:relative}'+
   '#micBtn svg{width:22px;height:22px;fill:currentColor}'+
   '#micBtn.on{background:#D93025;border-color:#D93025;color:#fff;animation:micPulse 1.1s infinite}'+
   '@keyframes micPulse{0%{box-shadow:0 0 0 0 rgba(217,48,37,.55)}70%{box-shadow:0 0 0 14px rgba(217,48,37,0)}100%{box-shadow:0 0 0 0 rgba(217,48,37,0)}}'+
   '#voiceStatus{display:none;margin-top:8px;font-size:13px;font-weight:600;border-radius:10px;padding:8px 10px}'+
   '#voiceStatus.listen{display:block;background:#FDECEA;color:#B3261E}'+
   '#voiceStatus.info{display:block;background:#E7F3F1;color:#0F4C46}'+
   '#voiceStatus.err{display:block;background:#FFF4E0;color:#8A5200}'+
   '.voiceauto{display:flex;align-items:center;gap:10px;margin-top:6px;padding:6px 0;font-size:13.5px;color:#555}'+
   '.voiceauto input{width:24px;height:24px;margin:0;flex:none}';
  document.head.appendChild(css);

  var mic=document.createElement('button');
  mic.type='button'; mic.id='micBtn'; mic.setAttribute('aria-label','Falar a tarefa'); mic.title='Falar a tarefa';
  mic.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5.5A3.5 3.5 0 0 0 12 15zm6-3.5a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.9V20H9.5a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2H13v-2.6a6 6 0 0 0 5-5.9z"/></svg>';
  row.insertBefore(mic,submitBtn);

  var status=document.createElement('div'); status.id='voiceStatus'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  row.insertAdjacentElement('afterend',status);

  var auto=document.createElement('label'); auto.className='voiceauto';
  auto.innerHTML='<input type="checkbox" id="voiceAuto"> Criar a tarefa sozinha quando eu terminar de falar';
  status.insertAdjacentElement('afterend',auto);
  var autoBox=auto.querySelector('input');
  try{ autoBox.checked=localStorage.getItem('agenda-voz-auto')==='1'; }catch(e){}
  autoBox.addEventListener('change',function(){ try{ localStorage.setItem('agenda-voz-auto',autoBox.checked?'1':'0'); }catch(e){} });

  function say(kind,msg){ status.className=kind||''; status.textContent=msg||''; if(!kind) status.removeAttribute('class'); }
  function beep(f){ try{ var C=window.AudioContext||window.webkitAudioContext; if(!C) return; var c=new C(),o=c.createOscillator(),g=c.createGain(); o.frequency.value=f; g.gain.value=.08; o.connect(g); g.connect(c.destination); o.start(); setTimeout(function(){ o.stop(); c.close(); },110); }catch(e){} }
  function buzz(){ try{ if(navigator.vibrate) navigator.vibrate(25); }catch(e){} }

  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  var rec=null, listening=false, finalText='', failed=false, timer=null;

  function setUI(on){ listening=on; mic.classList.toggle('on',on); mic.setAttribute('aria-pressed',on?'true':'false'); mic.setAttribute('aria-label',on?'Parar de ouvir':'Falar a tarefa'); }
  function clean(t){ return String(t||'').replace(/\s+/g,' ').replace(/[.!?…]+$/,'').trim(); }
  function put(t){ quick.value=t; quick.dispatchEvent(new Event('input',{bubbles:true})); }

  function stop(){ clearTimeout(timer); if(rec){ try{ rec.stop(); }catch(e){} } }

  function start(){
    if(!SR){
      say('err','Este navegador não ouve a voz aqui. Use o microfone 🎤 do teclado do celular, ou abra a agenda no Chrome.');
      quick.focus(); return;
    }
    if(listening){ stop(); return; }
    finalText=''; failed=false; put('');
    rec=new SR(); rec.lang='pt-BR'; rec.interimResults=true; rec.continuous=false; rec.maxAlternatives=1;
    rec.onstart=function(){ setUI(true); say('listen','Ouvindo… fale a tarefa. Exemplo: amanhã às 9 e meia ligar para a Ana'); beep(880); buzz(); };
    rec.onresult=function(e){
      var t=''; for(var i=0;i<e.results.length;i++) t+=' '+e.results[i][0].transcript;
      finalText=clean(t); put(finalText);
    };
    rec.onerror=function(e){
      failed=true; var er=e&&e.error;
      if(er==='aborted') { failed=false; return; }
      var m={'not-allowed':'O microfone está bloqueado. Toque no cadeado ao lado do endereço e permita o microfone.',
             'service-not-allowed':'O microfone está bloqueado. Toque no cadeado ao lado do endereço e permita o microfone.',
             'no-speech':'Não ouvi nada. Toque no microfone e fale de novo.',
             'audio-capture':'Não encontrei um microfone neste aparelho.',
             'network':'Sem internet para entender a sua voz. Tente de novo ou digite.',
             'language-not-supported':'Este navegador não entende português por voz. Digite a tarefa.'};
      say('err',m[er]||'Não consegui ouvir agora. Tente de novo ou digite a tarefa.');
    };
    rec.onend=function(){
      clearTimeout(timer); setUI(false); beep(660);
      if(failed) return;
      if(!finalText){ say('err','Não ouvi nada. Toque no microfone e fale de novo.'); return; }
      if(autoBox.checked){ say('info','Criando: '+finalText); form.requestSubmit(); setTimeout(function(){ say('',''); },2500); }
      else { say('info','Confira o texto abaixo e toque em Criar. Para corrigir, edite o texto ou toque no microfone de novo.'); submitBtn.focus(); }
    };
    try{ rec.start(); timer=setTimeout(stop,15000); }
    catch(err){ setUI(false); say('err','Não consegui ativar o microfone agora. Tente de novo.'); }
  }
  mic.addEventListener('click',start);
  quick.addEventListener('input',function(){ if(!listening && status.className==='info') say('',''); });
})();
