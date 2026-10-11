const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#f3eee5'); tg.setBackgroundColor('#f3eee5'); } catch (_) {}
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const random = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

const TASKS = [
  { key: 'dribble', name: 'ДРИБЛИНГ', icon: '●', color: '#3287e8', voice: 'Дриблинг!' },
  { key: 'shot', name: 'БРОСОК', icon: '⌒', color: '#e17836', voice: 'Броски!' },
  { key: 'jump', name: 'ПРЫЖКИ', icon: '↑', color: '#5d9b65', voice: 'Прыжки!' }
];

const TURN_PATTERNS = [
  [{ d: 31, ms: 290, hold: 170 }, { d: 31, ms: 270, hold: 150 }, { d: -47, ms: 230, hold: 360 }],
  [{ d: -32, ms: 285, hold: 170 }, { d: -32, ms: 265, hold: 150 }, { d: 49, ms: 225, hold: 360 }],
  [{ d: 24, ms: 250, hold: 105 }, { d: 24, ms: 245, hold: 105 }, { d: 24, ms: 240, hold: 105 }, { d: 24, ms: 235, hold: 320 }],
  [{ d: -25, ms: 250, hold: 105 }, { d: -25, ms: 245, hold: 105 }, { d: -25, ms: 240, hold: 105 }, { d: -25, ms: 235, hold: 320 }],
  [{ d: 54, ms: 270, hold: 120 }, { d: -27, ms: 185, hold: 120 }, { d: 49, ms: 235, hold: 390 }],
  [{ d: -54, ms: 270, hold: 120 }, { d: 27, ms: 185, hold: 120 }, { d: -49, ms: 235, hold: 390 }]
];

const state = {
  running: false, sound: true, score: 0, combo: 0, maxCombo: 0, suspicion: 0,
  checks: 0, correctChecks: 0, currentTask: TASKS[0], sequence: [], sequenceIndex: 0,
  sequenceStartedAt: null, watched: false, needProof: false, watchStartedAt: 0,
  caughtLockUntil: 0, styleLockUntil: 0, angle: 20, turn: null, timers: [],
  reactionTimer: null, coachTimer: null, roundStartedAt: 0, timeLeft: 90, raf: null, taskSerial: 1
};

const ui = {
  score: $('#scoreValue'), combo: $('#comboValue'), time: $('#timeValue'), taskChip: $('#taskChip'),
  taskIcon: $('#taskIcon'), taskName: $('#taskName'), wallScore: $('#wallScore'), court: $('#court'),
  vision: $('#visionCone'), trainer: $('#trainer'), trainerRig: $('.trainer-rig'), coachBubble: $('#coachBubble'),
  player: $('#player'), reaction: $('#reaction'), dots: $$('#suspicionDots i'), controls: $('#controls'),
  modeKicker: $('#modeKicker'), modeTitle: $('#modeTitle'), sequence: $('#comboSequence'), speed: $('#speedLabel'),
  startOverlay: $('#startOverlay'), resultOverlay: $('#resultOverlay')
};

let audio = null;
function ensureAudio(){if(!state.sound)return null;try{audio||=new(window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();return audio}catch(_){return null}}
function oscillator(freq,duration,gain=.025,type='sine',when=0){const ctx=ensureAudio();if(!ctx)return;const osc=ctx.createOscillator(),amp=ctx.createGain(),start=ctx.currentTime+when;osc.type=type;osc.frequency.setValueAtTime(freq,start);amp.gain.setValueAtTime(gain,start);amp.gain.exponentialRampToValueAtTime(.0001,start+duration);osc.connect(amp);amp.connect(ctx.destination);osc.start(start);osc.stop(start+duration)}
function bounceSound(delay=0){oscillator(135,.08,.035,'sine',delay);oscillator(72,.09,.018,'triangle',delay+.01)}
function whistleSound(){oscillator(2150,.22,.032,'square');oscillator(2670,.18,.018,'sine',.015)}
function whooshSound(){oscillator(280,.08,.009,'triangle');oscillator(430,.07,.006,'sine',.025)}
function swishSound(){const ctx=ensureAudio();if(!ctx)return;const len=Math.floor(ctx.sampleRate*.16),buffer=ctx.createBuffer(1,len,ctx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*(1-i/len);const src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();filter.type='highpass';filter.frequency.value=1200;gain.gain.value=.035;src.buffer=buffer;src.connect(filter);filter.connect(gain);gain.connect(ctx.destination);src.start()}
function successSound(){oscillator(620,.07,.018,'sine');oscillator(820,.08,.018,'sine',.065);oscillator(1050,.09,.016,'sine',.13)}
function haptic(type='light'){try{tg?.HapticFeedback?.impactOccurred(type)}catch(_){}}
function notify(type='error'){try{tg?.HapticFeedback?.notificationOccurred(type)}catch(_){}}
function coachSay(text){if(!state.sound||!('speechSynthesis'in window))return;try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='ru-RU';u.rate=1.35;u.pitch=.82;u.volume=.28;window.speechSynthesis.speak(u)}catch(_){}}
function later(fn,ms){const id=setTimeout(()=>{state.timers=state.timers.filter(x=>x!==id);fn()},ms);state.timers.push(id);return id}
function clearTimers(){state.timers.forEach(clearTimeout);state.timers=[];clearTimeout(state.reactionTimer);clearTimeout(state.coachTimer);if(state.raf)cancelAnimationFrame(state.raf);state.raf=null}
function normalizedAngle(deg){return((deg%360)+360)%360}
function angularDistance(a,b){const d=Math.abs(normalizedAngle(a)-normalizedAngle(b));return Math.min(d,360-d)}
function easeInOut(t){return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2}
function showCoach(text,duration=650){clearTimeout(state.coachTimer);ui.coachBubble.textContent=text;ui.coachBubble.classList.add('show');state.coachTimer=setTimeout(()=>ui.coachBubble.classList.remove('show'),duration)}
function flashReaction(text,kind='good',duration=650){clearTimeout(state.reactionTimer);ui.reaction.textContent=text;ui.reaction.className=`reaction show ${kind}`;state.reactionTimer=setTimeout(()=>{ui.reaction.className='reaction'},duration)}
function updateHud(){ui.score.textContent=Math.round(state.score).toLocaleString('ru-RU');ui.combo.textContent=`×${state.combo}`;ui.time.textContent=Math.max(0,Math.ceil(state.timeLeft));ui.dots.forEach((dot,i)=>dot.classList.toggle('on',i<state.suspicion))}
function setTask(task,announce=true){state.currentTask=task;state.taskSerial+=1;ui.court.dataset.task=task.key;ui.taskChip.style.setProperty('--task',task.color);ui.taskIcon.textContent=task.icon;ui.taskName.textContent=task.name;ui.wallScore.textContent=String(((state.taskSerial-1)%99)+1).padStart(2,'0');$$('[data-task]').forEach(btn=>{btn.style.setProperty('--task',task.color);btn.classList.toggle('active',btn.dataset.task===task.key)});if(state.watched)ui.modeTitle.textContent=`ДЕЛАЙ: ${task.name}`;if(state.running&&announce){showCoach(task.voice.toUpperCase(),720);coachSay(task.voice);oscillator(560,.055,.012,'sine')}}
function scheduleTaskChange(){if(!state.running)return;later(()=>{const next=pick(TASKS.filter(t=>t.key!==state.currentTask.key));setTask(next,true);scheduleTaskChange()},random(5200,7900))}
function generateSequence(){const values=['1','2','3','4'],seq=[];while(seq.length<5){const next=pick(values);if(seq.length>=2&&seq.at(-1)===next&&seq.at(-2)===next)continue;seq.push(next)}state.sequence=seq;state.sequenceIndex=0;state.sequenceStartedAt=null;renderSequence()}
function renderSequence(){ui.sequence.innerHTML=state.sequence.map((value,i)=>`<i class="${i<state.sequenceIndex?'done':i===state.sequenceIndex?'next':''}">${value}</i>`).join('')}
function setControlMode(watched){ui.controls.classList.toggle('controls-task',watched);ui.controls.classList.toggle('controls-style',!watched);ui.player.classList.toggle('watched',watched);ui.modeKicker.textContent=watched?'ТРЕНЕР СМОТРИТ НА ТЕБЯ':'ТРЕНЕР НЕ СМОТРИТ';ui.modeTitle.textContent=watched?`ДЕЛАЙ: ${state.currentTask.name}`:'БЫСТРО НАБЕЙ КОМБО'}
function updateTrainerFace(angle){const n=normalizedAngle(angle);let face='up';if(n>=45&&n<135)face='right';else if(n>=135&&n<225)face='down';else if(n>=225&&n<315)face='left';ui.trainer.dataset.face=face}
function setAngle(angle){state.angle=angle;ui.vision.style.setProperty('--angle',`${angle}deg`);updateTrainerFace(angle)}
function startTurn(delta,duration){if(!state.running)return;const now=performance.now();state.turn={start:state.angle,target:state.angle+delta,started:now,duration};const lean=clamp(delta*.055,-6,6);ui.trainerRig.style.transform=`translateX(-50%) rotate(${lean}deg)`;later(()=>{ui.trainerRig.style.transform='translateX(-50%) rotate(0deg)'},duration*.82);whooshSound()}
function runPattern(pattern,index=0){if(!state.running)return;if(index>=pattern.length){later(scheduleTurnPattern,random(430,780));return}const step=pattern[index],intensity=1-Math.min(.22,state.suspicion*.04),duration=Math.round(step.ms*intensity),hold=Math.round(step.hold*intensity);startTurn(step.d,duration);later(()=>runPattern(pattern,index+1),duration+hold)}
function scheduleTurnPattern(){if(!state.running)return;runPattern(pick(TURN_PATTERNS),0)}
function enterWatch(now){if(state.watched||now<state.caughtLockUntil)return;state.watched=true;state.needProof=true;state.watchStartedAt=now;state.checks+=1;setControlMode(true);haptic('medium');if(now<state.styleLockUntil)caught('ФРИСТАЙЛ ПОД НОСОМ')}
function leaveWatch(){if(!state.watched)return;state.watched=false;state.needProof=false;setControlMode(false)}
function updateWatch(now){const seesPlayer=angularDistance(state.angle,180)<=34;if(seesPlayer)enterWatch(now);else leaveWatch();if(state.watched&&state.needProof&&now-state.watchStartedAt>520)caught('НИЧЕГО НЕ ДЕЛАЕШЬ')}
function resetFlow(){state.combo=0;generateSequence();updateHud()}
function caught(reason){if(!state.running||performance.now()<state.caughtLockUntil)return;state.caughtLockUntil=performance.now()+650;state.needProof=false;state.suspicion=Math.min(5,state.suspicion+1);resetFlow();whistleSound();notify('error');showCoach(pick(['Я ВИЖУ!','РАБОТАЕМ!','НЕ ОТВЛЕКАЕМСЯ!']),900);coachSay(pick(['Я всё вижу!','Работаем!','Не отвлекаемся!']));flashReaction(`СВИСТОК · ${reason}`,'bad',1000);if(state.suspicion>=5)later(()=>endGame(true),720)}
function animatePlayer(className,duration){['action-dribble','action-shot','action-jump','style-1','style-2','style-3','style-4'].forEach(c=>ui.player.classList.remove(c));void ui.player.offsetWidth;ui.player.classList.add(className);later(()=>ui.player.classList.remove(className),duration)}
function performTask(key){if(!state.running||!state.watched)return;haptic('light');if(key!==state.currentTask.key){caught('НЕ ТО ЗАДАНИЕ');return}if(state.needProof)state.correctChecks+=1;state.needProof=false;state.score+=35;if(key==='dribble'){animatePlayer('action-dribble',650);bounceSound();later(()=>bounceSound(),250)}else if(key==='shot'){animatePlayer('action-shot',720);oscillator(380,.05,.012,'triangle');later(swishSound,250)}else{animatePlayer('action-jump',520);oscillator(310,.06,.012,'triangle')}flashReaction('ЧИСТО · РАБОТАЙ','good',430);updateHud()}
function comboSpeedScore(elapsed){if(elapsed<=1100)return{mult:1.75,label:'МОЛНИЯ'};if(elapsed<=1700)return{mult:1.5,label:'ОЧЕНЬ БЫСТРО'};if(elapsed<=2500)return{mult:1.25,label:'БЫСТРО'};if(elapsed<=4000)return{mult:1,label:'НОРМ'};return{mult:.72,label:'МЕДЛЕННО'}}
function performStyle(value){if(!state.running)return;if(state.watched){caught('ПОПАЛСЯ НА ФИНТЕ');return}const expected=state.sequence[state.sequenceIndex];if(value!==expected){oscillator(145,.07,.025,'square');flashReaction('СБИЛ КОМБО','bad',520);resetFlow();return}const now=performance.now();if(!state.sequenceStartedAt)state.sequenceStartedAt=now;state.sequenceIndex+=1;state.combo+=1;state.maxCombo=Math.max(state.maxCombo,state.combo);state.score+=10+Math.min(12,Math.floor(state.combo/3));state.styleLockUntil=now+120+Number(value)*22;animatePlayer(`style-${value}`,170+Number(value)*30);haptic(value==='4'?'medium':'light');oscillator(430+Number(value)*78,.035,.012,'triangle');renderSequence();if(state.sequenceIndex>=5){const elapsed=now-state.sequenceStartedAt,speed=comboSpeedScore(elapsed),base=310+Math.min(260,state.combo*7),reward=Math.round(base*speed.mult);state.score+=reward;successSound();flashReaction(`${speed.label} · +${reward} STYLE`,'good',760);generateSequence()}updateHud()}
function updateSpeed(now){if(!state.sequenceStartedAt){ui.speed.textContent='готов';ui.speed.classList.remove('hot');return}const elapsed=now-state.sequenceStartedAt;ui.speed.textContent=`${(elapsed/1000).toFixed(1)} сек`;ui.speed.classList.toggle('hot',elapsed<1700)}
function frame(now){if(!state.running)return;if(state.turn){const p=clamp((now-state.turn.started)/state.turn.duration,0,1),angle=state.turn.start+(state.turn.target-state.turn.start)*easeInOut(p);setAngle(angle);if(p>=1){setAngle(state.turn.target);state.turn=null}}updateWatch(now);updateSpeed(now);state.timeLeft=Math.max(0,90-(now-state.roundStartedAt)/1000);updateHud();if(state.timeLeft<=0){endGame(false);return}state.raf=requestAnimationFrame(frame)}
function startGame(){clearTimers();try{window.speechSynthesis?.cancel()}catch(_){}Object.assign(state,{running:true,score:0,combo:0,maxCombo:0,suspicion:0,checks:0,correctChecks:0,watched:false,needProof:false,caughtLockUntil:0,styleLockUntil:0,angle:random(-15,35),turn:null,timeLeft:90,taskSerial:1});ensureAudio();ui.startOverlay.classList.remove('overlay-visible');ui.resultOverlay.classList.remove('overlay-visible');setAngle(state.angle);setControlMode(false);generateSequence();setTask(pick(TASKS),false);updateHud();state.roundStartedAt=performance.now();whistleSound();showCoach('НАЧАЛИ!',650);coachSay('Начали!');scheduleTaskChange();later(scheduleTurnPattern,650);state.raf=requestAnimationFrame(frame);try{tg?.requestFullscreen?.();tg?.lockOrientation?.()}catch(_){}}
function endGame(benched=false){if(!state.running)return;state.running=false;clearTimers();leaveWatch();try{window.speechSynthesis?.cancel()}catch(_){}const rank=benched?'D':state.score>=6500&&state.suspicion<=1?'S':state.score>=4500?'A':state.score>=2500?'B':'C',title=benched?'СЕГОДНЯ БЕЗ ИГРОВОЙ ЧАСТИ':rank==='S'?'ТРЕНЕР НИЧЕГО НЕ ЗАПОДОЗРИЛ':rank==='A'?'СИЛЬНЫЙ STYLE. ПОЧТИ ЧИСТО':rank==='B'?'НЕПЛОХО, НО ТРЕНЕР ЧТО-ТО ПОНЯЛ':'НАДО БЫТЬ БЫСТРЕЕ';$('#resultKicker').textContent=benched?'НА СКАМЕЙКУ':'ТРЕНИРОВКА ОКОНЧЕНА';$('#resultRank').textContent=rank;$('#resultTitle').textContent=title;$('#resultScore').textContent=Math.round(state.score).toLocaleString('ru-RU');$('#resultCombo').textContent=`×${state.maxCombo}`;$('#resultCaught').textContent=state.suspicion;$('#resultTasks').textContent=`${state.correctChecks}/${state.checks}`;const key='sfera-trainer-watch-v2-best',previous=Number(localStorage.getItem(key)||0),current=Math.round(state.score);if(current>previous){localStorage.setItem(key,String(current));$('#bestScore').textContent=`НОВЫЙ РЕКОРД · ${current.toLocaleString('ru-RU')}`;notify('success')}else $('#bestScore').textContent=previous?`ЛИЧНЫЙ РЕКОРД · ${previous.toLocaleString('ru-RU')}`:'';ui.resultOverlay.classList.add('overlay-visible')}

$('#startButton').addEventListener('click',startGame);$('#restartButton').addEventListener('click',startGame);$('#soundButton').addEventListener('click',e=>{state.sound=!state.sound;e.currentTarget.textContent=state.sound?'♪':'×';if(!state.sound)try{window.speechSynthesis?.cancel()}catch(_){}else{ensureAudio();oscillator(660,.05,.014)}});$$('[data-style]').forEach(btn=>btn.addEventListener('pointerdown',e=>{e.preventDefault();performStyle(btn.dataset.style)}));$$('[data-task]').forEach(btn=>btn.addEventListener('pointerdown',e=>{e.preventDefault();performTask(btn.dataset.task)}));document.addEventListener('keydown',e=>{if(!state.running)return;if(['1','2','3','4'].includes(e.key))performStyle(e.key);if(e.key.toLowerCase()==='q')performTask('dribble');if(e.key.toLowerCase()==='w')performTask('shot');if(e.key.toLowerCase()==='e')performTask('jump')});

setAngle(state.angle);generateSequence();setTask(TASKS[0],false);setControlMode(false);updateHud();
