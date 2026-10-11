const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#080808'); tg.setBackgroundColor('#080808'); } catch (_) {}
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const tasks = [
  { key: 'dribble', name: 'ДРИБЛИНГ', icon: '↔', color: '#4aa8ff' },
  { key: 'pass', name: 'ПАС В СТЕНУ', icon: '⇄', color: '#59d98e' },
  { key: 'close', name: 'БЛИЖНИЙ БРОСОК', icon: '◉', color: '#ffd23f' },
  { key: 'long', name: 'ДАЛЬНИЙ БРОСОК', icon: '◎', color: '#ff6b68' }
];

const tricks = {
  cross: { label: 'A', score: 50, duration: 330 },
  spin: { label: 'B', score: 140, duration: 650 },
  special: { label: 'C', score: 360, duration: 1150 }
};

const lookTargets = ['left1', 'left2', 'right1', 'right2'];

const state = {
  running: false,
  timeLeft: 90,
  score: 0,
  combo: 0,
  maxCombo: 0,
  suspicion: 0,
  correctTasks: 0,
  checks: 0,
  currentTask: tasks[0],
  watched: false,
  turning: false,
  needProof: false,
  activeTrick: null,
  sequence: [],
  sequenceIndex: 0,
  timers: [],
  tick: null,
  reactionTimer: null,
  sound: true,
  endedByBench: false
};

const ui = {
  score: $('#scoreValue'), combo: $('#comboValue'), time: $('#timeValue'),
  taskBubble: $('#taskBubble'), taskIcon: $('#taskIcon'), taskName: $('#taskName'),
  trainer: $('#trainer'), player: $('#player'), reaction: $('#reaction'), warning: $('#warning'),
  suspicionDots: $$('#suspicionDots i'), suspicionCopy: $('#suspicionCopy'),
  modePanel: $('#modePanel'), modeKicker: $('#modeKicker'), modeTitle: $('#modeTitle'), modePill: $('#modePill'),
  comboSequence: $('#comboSequence'), startOverlay: $('#startOverlay'), resultOverlay: $('#resultOverlay')
};

function random(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function haptic(type = 'light') { try { tg?.HapticFeedback?.impactOccurred(type); } catch (_) {} }
function notify(type = 'error') { try { tg?.HapticFeedback?.notificationOccurred(type); } catch (_) {} }

let audioContext = null;
function tone(freq = 440, duration = 0.05, gain = 0.025) {
  if (!state.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioContext.createOscillator();
    const amp = audioContext.createGain();
    osc.frequency.value = freq;
    amp.gain.value = gain;
    osc.connect(amp); amp.connect(audioContext.destination);
    osc.start(); osc.stop(audioContext.currentTime + duration);
  } catch (_) {}
}

function later(fn, ms) {
  const id = setTimeout(() => {
    state.timers = state.timers.filter(x => x !== id);
    fn();
  }, ms);
  state.timers.push(id);
  return id;
}

function clearTimers() {
  state.timers.forEach(clearTimeout);
  state.timers = [];
  clearInterval(state.tick);
  state.tick = null;
  clearTimeout(state.reactionTimer);
}

function updateHud() {
  ui.score.textContent = Math.round(state.score).toLocaleString('ru-RU');
  ui.combo.textContent = `×${state.combo}`;
  ui.time.textContent = Math.max(0, Math.ceil(state.timeLeft));
  ui.suspicionDots.forEach((dot, i) => dot.classList.toggle('on', i < state.suspicion));
  ui.suspicionCopy.textContent = ['чисто', 'заметил', 'подозревает', 'следит', 'почти всё', 'скамейка'][state.suspicion];
  $('#suspicionDots').setAttribute('aria-label', `Палево ${state.suspicion} из 5`);
}

function setTask(task = pick(tasks)) {
  state.currentTask = task;
  ui.taskBubble.style.setProperty('--task', task.color);
  ui.taskIcon.textContent = task.icon;
  ui.taskName.textContent = task.name;
  $$('.training-actions button').forEach(btn => btn.classList.toggle('active', btn.dataset.task === task.key));
  if (state.running) {
    tone(620, 0.04, 0.02);
    flashReaction(`НОВОЕ: ${task.name}`, 'good', 650);
  }
}

function scheduleTaskChange() {
  if (!state.running) return;
  later(() => {
    let next = pick(tasks.filter(t => t.key !== state.currentTask.key));
    setTask(next);
    scheduleTaskChange();
  }, random(4300, 7200));
}

function generateSequence() {
  const keys = Object.keys(tricks);
  state.sequence = Array.from({ length: state.combo >= 8 ? 4 : 3 }, () => pick(keys));
  state.sequenceIndex = 0;
  renderSequence();
}

function renderSequence() {
  ui.comboSequence.innerHTML = state.sequence.map((key, i) => {
    const cls = i < state.sequenceIndex ? 'done' : i === state.sequenceIndex ? 'next' : '';
    return `<i class="${cls}">${tricks[key].label}</i>`;
  }).join('');
}

function setMode(watched) {
  ui.modePanel.classList.toggle('mode-panel--training', watched);
  ui.modePanel.classList.toggle('mode-panel--freestyle', !watched);
  ui.modeKicker.textContent = watched ? 'ТРЕНЕР СМОТРИТ НА ТЕБЯ' : 'ТРЕНЕР НЕ СМОТРИТ';
  ui.modeTitle.textContent = watched ? 'ВЫПОЛНЯЙ ЗАДАНИЕ' : 'НАБИВАЙ STYLE';
  ui.modePill.textContent = watched ? 'TRAINING' : 'FREESTYLE';
  ui.player.classList.toggle('is-watched', watched);
}

function flashReaction(text, kind = 'good', duration = 850) {
  clearTimeout(state.reactionTimer);
  ui.reaction.textContent = text;
  ui.reaction.className = `reaction show ${kind}`;
  state.reactionTimer = setTimeout(() => { ui.reaction.className = 'reaction'; }, duration);
}

function showWarning(show) {
  state.turning = show;
  ui.warning.classList.toggle('show', show);
  if (show) { haptic('medium'); tone(250, 0.05, 0.035); }
}

function setLook(target) {
  ui.trainer.dataset.look = target;
}

function scheduleLookCycle() {
  if (!state.running) return;
  state.watched = false;
  state.needProof = false;
  setMode(false);
  setLook(pick(lookTargets));

  later(() => {
    if (!state.running) return;
    showWarning(true);

    later(() => {
      if (!state.running) return;
      showWarning(false);

      const fake = Math.random() < 0.14;
      if (fake) {
        flashReaction('ФЕЙК · ЗРЯ ИСПУГАЛСЯ', 'good', 720);
        tone(520, 0.035, 0.018);
        setLook(pick(lookTargets));
        later(scheduleLookCycle, random(800, 1300));
        return;
      }

      const chancePlayer = Math.min(0.58, 0.20 + state.suspicion * 0.075);
      const target = Math.random() < chancePlayer ? 'player' : pick(lookTargets);
      setLook(target);

      if (target === 'player') beginWatch();

      later(() => {
        if (!state.running) return;
        if (target === 'player') endWatch();
        scheduleLookCycle();
      }, target === 'player' ? random(1300, 2200) : random(900, 1700));
    }, random(520, 760));
  }, random(1500, 3300));
}

function beginWatch() {
  state.watched = true;
  state.needProof = true;
  state.checks += 1;
  setMode(true);
  haptic('heavy'); tone(180, 0.07, 0.045);

  if (state.activeTrick) {
    caught('ФРИСТАЙЛ ПОД НОСОМ');
    return;
  }

  later(() => {
    if (state.running && state.watched && state.needProof) caught('НИЧЕГО НЕ ДЕЛАЕШЬ');
  }, 850);
}

function endWatch() {
  state.watched = false;
  state.needProof = false;
  setMode(false);
}

function caught(reason) {
  if (!state.running) return;
  state.needProof = false;
  state.activeTrick = null;
  ui.player.classList.remove('is-performing');
  state.suspicion = Math.min(5, state.suspicion + 1);
  state.combo = 0;
  state.sequenceIndex = 0;
  renderSequence();
  updateHud();
  notify('error'); tone(110, 0.12, 0.055);
  flashReaction(`СВИСТОК · ${reason}`, 'bad', 1100);

  if (state.suspicion >= 5) {
    state.endedByBench = true;
    later(() => endGame(true), 650);
  }
}

function performTraining(key) {
  if (!state.running) return;
  haptic('light');

  if (!state.watched) {
    state.combo = 0;
    state.sequenceIndex = 0;
    renderSequence(); updateHud();
    flashReaction('РАНО · ОН НЕ СМОТРИТ', 'good', 520);
    return;
  }

  if (key !== state.currentTask.key) {
    caught('НЕ ТО ЗАДАНИЕ');
    return;
  }

  if (state.needProof) state.correctTasks += 1;
  state.needProof = false;
  ui.player.classList.add('is-performing');
  later(() => ui.player.classList.remove('is-performing'), 320);
  flashReaction('ЧИСТО · РАБОТАЙ', 'good', 520);
  tone(720, 0.04, 0.025);
  updateHud();
}

function performTrick(key) {
  if (!state.running || state.activeTrick) return;
  if (state.watched) {
    caught('Я ВСЁ ВИЖУ');
    return;
  }

  const trick = tricks[key];
  const expected = state.sequence[state.sequenceIndex];
  if (key !== expected) {
    state.combo = 0;
    state.sequenceIndex = 0;
    renderSequence(); updateHud();
    flashReaction('СБИЛ КОМБО', 'bad', 520);
    tone(150, 0.045, 0.03);
    return;
  }

  state.activeTrick = key;
  ui.player.classList.add('is-performing');
  haptic(key === 'special' ? 'heavy' : 'light');
  tone(key === 'special' ? 760 : 560, 0.04, 0.02);

  later(() => {
    if (!state.running || state.activeTrick !== key) return;
    state.activeTrick = null;
    ui.player.classList.remove('is-performing');
    if (state.watched) return;

    state.combo += 1;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    const multiplier = 1 + Math.floor(state.combo / 4) * 0.25;
    const earned = Math.round(trick.score * multiplier);
    state.score += earned;
    state.sequenceIndex += 1;

    if (state.sequenceIndex >= state.sequence.length) {
      const bonus = 180 + state.combo * 15;
      state.score += bonus;
      flashReaction(`COMBO ×${state.combo} · +${earned + bonus}`, 'good', 650);
      generateSequence();
    } else {
      flashReaction(`+${earned} STYLE`, 'good', 430);
      renderSequence();
    }
    updateHud();
  }, trick.duration);
}

function startGame() {
  clearTimers();
  Object.assign(state, {
    running: true, timeLeft: 90, score: 0, combo: 0, maxCombo: 0, suspicion: 0,
    correctTasks: 0, checks: 0, watched: false, turning: false, needProof: false,
    activeTrick: null, endedByBench: false
  });
  ui.startOverlay.classList.remove('overlay--visible');
  ui.resultOverlay.classList.remove('overlay--visible');
  showWarning(false); setMode(false); setTask(pick(tasks)); generateSequence(); updateHud();

  try { tg?.requestFullscreen?.(); tg?.lockOrientation?.(); } catch (_) {}

  const startedAt = performance.now();
  let hiddenAt = null;
  let hiddenTotal = 0;
  state.tick = setInterval(() => {
    if (!state.running) return;
    if (document.hidden) {
      if (hiddenAt === null) hiddenAt = performance.now();
      return;
    }
    if (hiddenAt !== null) {
      hiddenTotal += performance.now() - hiddenAt;
      hiddenAt = null;
    }
    const elapsed = (performance.now() - startedAt - hiddenTotal) / 1000;
    state.timeLeft = Math.max(0, 90 - elapsed);
    updateHud();
    if (state.timeLeft <= 0) endGame(false);
  }, 100);

  scheduleTaskChange();
  scheduleLookCycle();
  haptic('medium'); tone(440, 0.05, 0.025);
}

function endGame(benched = false) {
  if (!state.running) return;
  state.running = false;
  clearTimers();
  showWarning(false);
  state.activeTrick = null;
  ui.player.classList.remove('is-performing');

  const rank = benched ? 'D' : state.suspicion === 0 && state.score >= 3000 ? 'S' : state.score >= 2200 ? 'A' : state.score >= 1200 ? 'B' : 'C';
  const title = benched ? 'СЕГОДНЯ БЕЗ ИГРОВОЙ ЧАСТИ' : rank === 'S' ? 'ТРЕНЕР НИЧЕГО НЕ ЗАПОДОЗРИЛ' : rank === 'A' ? 'КРАСИВО. ПОЧТИ НЕ СПАЛИЛСЯ' : rank === 'B' ? 'НОРМАЛЬНО, НО ОН ЧТО-ТО ПОНЯЛ' : 'НАДО БЫТЬ ХИТРЕЕ';

  $('#resultKicker').textContent = benched ? 'НА СКАМЕЙКУ' : 'ТРЕНИРОВКА ОКОНЧЕНА';
  $('#resultRank').textContent = rank;
  $('#resultTitle').textContent = title;
  $('#resultScore').textContent = Math.round(state.score).toLocaleString('ru-RU');
  $('#resultCombo').textContent = `×${state.maxCombo}`;
  $('#resultCaught').textContent = state.suspicion;
  $('#resultTasks').textContent = `${state.correctTasks}/${state.checks}`;

  const previous = Number(localStorage.getItem('sfera-trainer-watch-best') || 0);
  const current = Math.round(state.score);
  if (current > previous) {
    localStorage.setItem('sfera-trainer-watch-best', String(current));
    $('#bestScore').textContent = `НОВЫЙ РЕКОРД · ${current.toLocaleString('ru-RU')}`;
    notify('success');
  } else {
    $('#bestScore').textContent = previous ? `ЛИЧНЫЙ РЕКОРД · ${previous.toLocaleString('ru-RU')}` : '';
  }
  ui.resultOverlay.classList.add('overlay--visible');
}

$('#startButton').addEventListener('click', startGame);
$('#restartButton').addEventListener('click', startGame);
$('#soundButton').addEventListener('click', (e) => {
  state.sound = !state.sound;
  e.currentTarget.textContent = state.sound ? '♪' : '×';
  haptic('light');
});

$$('[data-task]').forEach(btn => btn.addEventListener('click', () => performTraining(btn.dataset.task)));
$$('[data-trick]').forEach(btn => btn.addEventListener('click', () => performTrick(btn.dataset.trick)));

document.addEventListener('keydown', (e) => {
  if (!state.running) return;
  const key = e.key.toLowerCase();
  if (key === 'a') performTrick('cross');
  if (key === 'b') performTrick('spin');
  if (key === 'c') performTrick('special');
  if (key === '1') performTraining('dribble');
  if (key === '2') performTraining('pass');
  if (key === '3') performTraining('close');
  if (key === '4') performTraining('long');
});

setTask(tasks[0]);
generateSequence();
updateHud();