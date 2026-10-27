/* Sonic Universe: an original browser flight, with no external runtime. */
(() => {
  'use strict';
  const C = SonicFlightCore, $ = id => document.getElementById(id);
  const canvas = $('flightCanvas'), g = canvas.getContext('2d');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const COUNT_IN = C.BEAT * 3, LOOK_AHEAD = 3.6, BEST_KEY = 'sonic-universe-flight-first-light-v1';
  const query = matchMedia('(prefers-reduced-motion: reduce)');
  let calm = query.matches, mute = false, phase = 'ready', run = C.createRun(), buffer = null, building = null;
  let ac = null, bus = null, analyser = null, samples = null, source = null, token = 0, ticks = [];
  let anchorTime = 0, anchorPosition = -COUNT_IN, frozenPosition = -COUNT_IN, resumeAt = 0;
  let best = null, storageFailed = false, pointer = null, lastAnnounced = -1, w = 0, h = 0, dpr = 1, lastFrame = 0, level = 0;
  let currentLane = 1, lastVisualTime = 0, paintedFeedback = null;
  const stars = Array.from({ length: 170 }, (_, i) => ({ x: ((i * 7919 + 2341) % 10000) / 10000, y: ((i * 6577 + 4983) % 10000) / 10000, size: .45 + (i % 7) * .19, speed: .2 + (i % 5) * .15 }));

  function readBest() {
    try {
      const v = JSON.parse(localStorage.getItem(BEST_KEY) || 'null');
      if (v?.version === 1 && v.chart === 'first-light-v1' && Number.isInteger(v.score) && v.score >= 0 && v.score <= 25000 && Number.isInteger(v.maxCombo) && v.maxCombo >= 0 && v.maxCombo <= C.totalRings && ['S','A','B','C','D'].includes(v.grade)) best = v;
    } catch { storageFailed = true; }
    renderBest();
  }
  function renderBest() {
    $('flightBest').textContent = best ? best.score.toLocaleString('zh-CN') + ' / ' + best.grade : '尚未启航';
    $('flightBestHud').textContent = best ? best.score.toLocaleString('zh-CN') : '0';
    $('flightRecordNote').textContent = storageFailed ? '浏览器未能保存纪录 · 本页成绩仍可继续挑战' : best ? '纪录保存在当前浏览器' : '完成航程后记录成绩';
  }
  function setPhase(value) {
    phase = value; document.body.dataset.phase = value;
    const active = ['countdown', 'playing', 'paused', 'resuming'].includes(value);
    $('flightIntro').hidden = !['ready', 'loading'].includes(value);
    $('flightHud').hidden = !active; $('flightFooter').hidden = active || value === 'result';
    $('flightCountdown').hidden = !['countdown', 'resuming'].includes(value);
    $('flightPausePanel').hidden = value !== 'paused'; $('flightResultPanel').hidden = value !== 'result';
    $('flightLaneControls').hidden = !['playing', 'countdown', 'resuming'].includes(value);
    $('flightPlayHint').hidden = !['playing', 'countdown', 'resuming'].includes(value);
    $('flightPause').disabled = !active; $('flightPause').innerHTML = value === 'paused' ? '继续 <span aria-hidden="true">▷</span>' : '暂停 <span aria-hidden="true">Ⅱ</span>';
    $('flightPause').setAttribute('aria-label', value === 'paused' ? '继续航行' : '暂停航行');
    if (value !== 'playing') { $('flightFeedback').hidden = true; $('flightComboBox').hidden = true; }
  }
  function audioSetup() {
    if (ac && ac.state !== 'closed') return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('此浏览器暂不支持音频，请换用新版 Chrome、Edge 或 Safari。');
    ac = new Audio(); bus = ac.createGain(); bus.gain.value = mute ? 0 : .72;
    analyser = ac.createAnalyser(); analyser.fftSize = 256; samples = new Uint8Array(analyser.fftSize); bus.connect(analyser); analyser.connect(ac.destination);
    ac.addEventListener('statechange', () => { if (['playing', 'countdown', 'resuming'].includes(phase) && ac.state !== 'running') pause('浏览器暂停了声音。音乐与航路已一起停下。'); });
  }
  async function buildSoundtrack() {
    if (buffer) return buffer; if (building) return building;
    building = (async () => {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Offline) throw new Error('此浏览器暂不支持生成航行音景，请尝试新版浏览器。');
      const rate = 22050, length = COUNT_IN + C.DURATION + .1, off = new Offline(2, Math.ceil(rate * length), rate);
      const mix = off.createGain(), comp = off.createDynamicsCompressor(); mix.gain.value = .68; comp.threshold.value = -18; comp.ratio.value = 4; mix.connect(comp); comp.connect(off.destination);
      const wet = off.createDelay(1), feedback = off.createGain(); wet.delayTime.value = C.BEAT * .75; feedback.gain.value = .2; wet.connect(feedback); feedback.connect(wet); feedback.connect(mix);
      let seed = 18427; const noise = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647 * 2 - 1; };
      const noiseBuffer = off.createBuffer(1, rate * .18, rate); const noiseData = noiseBuffer.getChannelData(0); for (let i = 0; i < noiseData.length; i++) noiseData[i] = noise() * Math.exp(-i / 700);
      function tone(midi, start, duration, gain, type = 'sine', pan = 0) {
        const end = Math.min(length - .01, start + duration); if (end <= start + .01) return;
        const osc = off.createOscillator(), env = off.createGain(), p = off.createStereoPanner(); osc.type = type; osc.frequency.value = 440 * 2 ** ((midi - 69) / 12); p.pan.value = pan;
        env.gain.setValueAtTime(.0001, start); env.gain.exponentialRampToValueAtTime(gain, start + .015); env.gain.exponentialRampToValueAtTime(.0001, end);
        osc.connect(env); env.connect(p); p.connect(mix); p.connect(wet); osc.start(start); osc.stop(end);
      }
      for (let i = 0; i < 3; i++) tone(81, i * C.BEAT, .12, .1);
      const chords = [[45,52,57,60],[41,48,53,57],[48,55,60,64],[43,50,55,59]];
      for (let beat = 0; beat < 96; beat++) {
        const time = COUNT_IN + beat * C.BEAT, chord = chords[Math.floor(beat / 16) % 4];
        if (beat % 4 === 0) for (let j = 0; j < 4; j++) tone(chord[j], time, 3.1, .045, 'triangle', (j - 1.5) * .34);
        tone(chord[0] - 12, time, .42, .17, 'sine');
        const kick = off.createOscillator(), env = off.createGain(); kick.frequency.setValueAtTime(125, time); kick.frequency.exponentialRampToValueAtTime(37, time + .22); env.gain.setValueAtTime(.0001, time); env.gain.exponentialRampToValueAtTime(.32, time + .008); env.gain.exponentialRampToValueAtTime(.0001, time + .32); kick.connect(env); env.connect(mix); kick.start(time); kick.stop(time + .35);
        const hat = off.createBufferSource(), hp = off.createBiquadFilter(), hg = off.createGain(); hat.buffer = noiseBuffer; hp.type = 'highpass'; hp.frequency.value = beat % 2 ? 4500 : 6500; hg.gain.value = beat % 2 ? .14 : .08; hat.connect(hp); hp.connect(hg); hg.connect(mix); hat.start(time + C.BEAT / 2);
        if (beat >= 20 && beat < 68) tone(chord[(beat + 1) % 4] + 24, time + C.BEAT / 2, .25, .035, 'sine', Math.sin(beat) * .6);
      }
      for (const event of C.chart) if (event.type === 'ring') { const chord = chords[Math.floor(event.time / C.BEAT / 16) % 4]; tone(chord[event.lane + 1] + 12, COUNT_IN + event.time, .7, .14, 'sine', (event.lane - 1) * .6); }
      const output = await off.startRendering();
      for (let ch = 0; ch < output.numberOfChannels; ch++) { const data = output.getChannelData(ch); for (let i = 0; i < rate; i++) data[data.length - 1 - i] *= i / rate; }
      buffer = output; return output;
    })();
    try { return await building; } catch (error) { building = null; throw error; }
  }
  function stopSource() {
    if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); source = null; }
    for (const oscillator of ticks) { try { oscillator.stop(); } catch {} } ticks = [];
  }
  function clock() { return ['playing', 'countdown', 'resuming'].includes(phase) && ac ? anchorPosition + ac.currentTime - anchorTime : frozenPosition; }
  function schedule(position, lead) {
    stopSource(); anchorPosition = position; anchorTime = ac.currentTime + lead;
    source = ac.createBufferSource(); source.buffer = buffer; source.connect(bus); source.start(anchorTime, COUNT_IN + position);
    if (lead) for (let i = 0; i < 3; i++) { const osc = ac.createOscillator(), env = ac.createGain(), time = ac.currentTime + i * C.BEAT; osc.frequency.value = 880; env.gain.setValueAtTime(.0001, time); env.gain.exponentialRampToValueAtTime(.07, time + .008); env.gain.exponentialRampToValueAtTime(.0001, time + .1); osc.connect(env); env.connect(bus); osc.start(time); osc.stop(time + .12); ticks.push(osc); }
    source.onended = () => { if (phase === 'playing' && !run.ended) { C.advance(run, C.DURATION); finish(); } };
  }
  async function start() {
    if (phase === 'loading') return;
    const request = ++token; stopSource(); run = C.createRun(); currentLane = 1; paintedFeedback = null; lastAnnounced = -1; frozenPosition = -COUNT_IN;
    setPhase('loading'); $('flightStart').disabled = true; $('flightLoadStatus').textContent = buffer ? '正在准备航路…' : '首次启航，正在生成原创音景…';
    try {
      audioSetup(); await ac.resume(); await buildSoundtrack(); if (request !== token) return;
      if (document.hidden || ac.state !== 'running') { setPhase('ready'); $('flightLoadStatus').textContent = '准备好了。回到此页面后，再点开始航行。'; return; }
      $('flightLoadStatus').textContent = ''; schedule(-COUNT_IN, 0); resumeAt = 0; setPhase('countdown'); syncControls(); canvas.focus({ preventScroll: true });
      $('flightAnnouncement').textContent = '三拍后启航。用左右方向键、A D，或点击下方航道按钮移动。';
    } catch (error) { setPhase('ready'); $('flightLoadStatus').textContent = error.message || '音景未能准备好，请重试。'; } finally { $('flightStart').disabled = false; }
  }
  function pause(reason = '音乐与航路已一起暂停。') {
    if (phase === 'loading') { token++; setPhase('ready'); $('flightLoadStatus').textContent = '已暂停准备。回到页面后再点开始航行。'; return; }
    if (!['playing', 'countdown', 'resuming'].includes(phase)) return;
    token++; const time = phase === 'resuming' ? frozenPosition : clock();
    if (phase === 'playing') { C.advance(run, time); if (run.ended) { finish(); return; } }
    frozenPosition = clamp(time, -COUNT_IN, C.DURATION); stopSource(); setPhase('paused');
    $('flightPauseReason').textContent = reason; $('flightPauseTitle').focus({ preventScroll: true }); $('flightAnnouncement').textContent = '航行已暂停';
  }
  async function resume() {
    if (phase !== 'paused') return; if (frozenPosition < 0) { start(); return; }
    const request = ++token; $('flightResume').disabled = true;
    try { await ac.resume(); if (request !== token || phase !== 'paused') return; if (document.hidden || ac.state !== 'running') throw new Error('请回到此页面后，再点继续航行。'); resumeAt = frozenPosition; schedule(frozenPosition, COUNT_IN); setPhase('resuming'); $('flightAnnouncement').textContent = '三拍后继续，当前分数与航路保留。'; }
    catch (error) { $('flightPauseReason').textContent = error.message || '暂时无法恢复声音，请重试。'; } finally { $('flightResume').disabled = false; }
  }
  function finish() {
    if (phase === 'result') return; token++; frozenPosition = run.time; stopSource();
    const result = C.result(run), previous = best?.score || 0, newBest = !best || result.score > previous;
    if (newBest) best = { version: 1, chart: 'first-light-v1', score: result.score, grade: result.grade, maxCombo: result.maxCombo };
    try { if (best) localStorage.setItem(BEST_KEY, JSON.stringify(best)); storageFailed = false; } catch { storageFailed = true; }
    renderBest(); $('flightGrade').textContent = result.grade; $('flightFinalScore').textContent = result.score.toLocaleString('zh-CN');
    $('flightAccuracy').textContent = result.accuracy + '%'; $('flightMaxCombo').textContent = result.maxCombo; $('flightDistance').textContent = Math.floor(result.time) + 's';
    $('flightResultEyebrow').textContent = result.complete ? 'VOYAGE COMPLETE' : 'A NEW VOYAGE AWAITS';
    $('flightResultTitle').textContent = result.complete ? '你点亮了这段星河。' : '调整航向，再出发。';
    $('flightResultSubtitle').textContent = result.complete ? '60 秒的旋律，留下你的轨迹。' : '能量耗尽。提前看清星环所在的航道。';
    $('flightBreakdown').textContent = '精准 ' + result.perfect + ' · 命中 ' + result.good + ' · 错过 ' + result.misses + ' · 碰撞 ' + result.collisions;
    $('flightSaveStatus').textContent = storageFailed ? '纪录未能保存到浏览器，本页仍保留。请检查网站存储权限。' : '最高分保存在当前浏览器 · 当前关卡：初航';
    $('flightNewBest').hidden = !newBest; setPhase('result'); $('flightResultTitle').focus({ preventScroll: true });
    $('flightAnnouncement').textContent = (result.complete ? '航行完成' : '能量耗尽') + '。得分 ' + result.score + '，评级 ' + result.grade + '，最高连击 ' + result.maxCombo;
  }
  function selectLane(lane) {
    if (!['playing', 'countdown', 'resuming'].includes(phase)) return;
    const time = phase === 'playing' ? clock() : run.time; C.move(run, lane, time); if (run.ended) { finish(); return; } currentLane = run.movement.to; syncControls();
  }
  function syncControls() { for (const b of document.querySelectorAll('[data-flight-lane]')) b.setAttribute('aria-pressed', String(Number(b.dataset.flightLane) === currentLane)); }
  function format(time) { const n = Math.max(0, Math.floor(time)); return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
  function updateHud(time) {
    $('flightScore').textContent = String(run.score).padStart(6, '0'); $('flightTime').textContent = format(time) + ' / 01:00';
    $('flightProgress').value = Math.max(0, time); $('flightEnergy').textContent = run.energy; $('flightEnergyBar').value = run.energy; $('flightEnergyBar').parentElement.dataset.low = String(run.energy <= 32);
    $('flightChapter').textContent = time < 15 ? '01 / 星光初醒' : time < 42.5 ? '02 / 逐光而行' : '03 / 星潮归航';
    $('flightCombo').textContent = run.combo; $('flightComboBox').hidden = phase !== 'playing' || run.combo < 2;
    const event = run.last; $('flightFeedback').hidden = phase !== 'playing' || !event || time - event.time > .7;
    if (event && event !== paintedFeedback) { paintedFeedback = event; const names = { perfect: 'PERFECT', good: 'GOOD', miss: '错过星环', rock: '注意陨石' }; $('flightJudgment').textContent = names[event.kind]; $('flightJudgmentDetail').textContent = event.points ? '+' + event.points + ' · 星光入舱' : event.kind === 'miss' ? '提前移动到发光航道' : '换一条航道，继续飞行'; $('flightFeedback').dataset.kind = event.kind; }
    if (run.maxCombo >= lastAnnounced + 10) { lastAnnounced = Math.floor(run.maxCombo / 10) * 10; if (lastAnnounced) $('flightAnnouncement').textContent = lastAnnounced + ' 连击'; }
    document.body.dataset.time = Math.max(0, time).toFixed(3); document.body.dataset.lane = currentLane; document.body.dataset.score = run.score; document.body.dataset.combo = run.combo; document.body.dataset.energy = run.energy; document.body.dataset.next = run.next;
  }

  function resize() { w = canvas.clientWidth; h = canvas.clientHeight; dpr = Math.min(devicePixelRatio || 1, 1.75); canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function project(lane, distance, time) {
    const p = Math.max(0, 1 - distance / LOOK_AHEAD), depth = p * p, play = !['ready', 'loading'].includes(phase);
    const cx = w * (play ? .5 : w < 600 ? .55 : .68), horizon = h * (w < 600 ? .43 : .32), bottom = h * (w < 600 ? play ? .78 : .69 : .79);
    const spread = w * (w < 600 ? .285 : .205);
    const curve = calm ? 0 : Math.sin(time * .13) * w * .025 * (1 - depth);
    return { x: cx + curve + (lane - 1) * spread * (.04 + depth * .96), y: horizon + (bottom - horizon) * depth, scale: .05 + depth * .95, cx, horizon, bottom, spread };
  }
  function ellipse(x, y, rx, ry, color, width = 1) { g.beginPath(); g.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), 0, 0, Math.PI * 2); g.strokeStyle = color; g.lineWidth = width; g.stroke(); }
  function draw(time, dt, now) {
    const backdrop = g.createLinearGradient(0, 0, w, h); backdrop.addColorStop(0, '#070b19'); backdrop.addColorStop(.5, '#11142a'); backdrop.addColorStop(1, '#050c18'); g.fillStyle = backdrop; g.fillRect(0, 0, w, h);
    const active = !['ready', 'loading'].includes(phase), p0 = project(1, LOOK_AHEAD, time);
    const nebula = g.createRadialGradient(w * .68, h * .36, 0, w * .68, h * .36, w * .55); nebula.addColorStop(0, '#6a4b9b24'); nebula.addColorStop(.4, '#253d6d18'); nebula.addColorStop(1, '#080b1800'); g.fillStyle = nebula; g.fillRect(0, 0, w, h);
    const starTime = calm ? 0 : time;
    for (const star of stars) { const x = star.x * w, y = ((star.y + starTime * .001 * star.speed) % 1) * h; g.fillStyle = 'rgba(191,204,239,' + (.16 + star.size * .23) + ')'; g.beginPath(); g.arc(x, y, star.size, 0, Math.PI * 2); g.fill(); }
    const planetX = w * (active ? .8 : .79), planetY = h * (w < 600 ? .35 : .25), planetR = Math.min(w * .064, h * .105);
    const planet = g.createRadialGradient(planetX - planetR * .4, planetY - planetR * .4, 0, planetX, planetY, planetR); planet.addColorStop(0, '#a89bcf'); planet.addColorStop(.32, '#514d82'); planet.addColorStop(.8, '#191c38'); planet.addColorStop(1, '#0b1125'); g.fillStyle = planet; g.beginPath(); g.arc(planetX, planetY, planetR, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(planetX, planetY); g.rotate(-.35); ellipse(0, 0, planetR * 1.8, planetR * .3, '#b7b2e52b'); g.restore();
    const glow = g.createRadialGradient(p0.cx, p0.horizon, 0, p0.cx, p0.horizon, w * .28); glow.addColorStop(0, '#d6bcff20'); glow.addColorStop(.35, '#5966bf14'); glow.addColorStop(1, '#8ea8ff00'); g.fillStyle = glow; g.fillRect(0, 0, w, h);
    for (let lane = -.5; lane <= 2.5; lane++) {
      g.beginPath(); for (let i = 0; i <= 48; i++) { const p = project(lane, LOOK_AHEAD * (1 - i / 48), time); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }
      g.strokeStyle = lane === -.5 || lane === 2.5 ? '#a7c4f74a' : '#959fe32a'; g.lineWidth = lane === -.5 || lane === 2.5 ? 1.2 : .7; g.stroke();
    }
    const gridTime = calm ? 0 : -time;
    for (let i = 0; i < 18; i++) { const span = 18 * C.BEAT, d = ((i * C.BEAT + gridTime) % span + span) % span / span * LOOK_AHEAD, left = project(-.5, d, time), right = project(2.5, d, time); g.beginPath(); g.moveTo(left.x, left.y); g.lineTo(right.x, right.y); g.strokeStyle = 'rgba(136,166,230,' + (.02 + left.scale * .12) + ')'; g.lineWidth = .6; g.stroke(); }
    const pad = project(currentLane, 0, time);
    if (active) { const beam = g.createLinearGradient(pad.x, p0.horizon, pad.x, pad.bottom + 30); beam.addColorStop(0, '#9ce9ee00'); beam.addColorStop(1, '#9ce9ee12'); g.fillStyle = beam; const l = project(currentLane - .42, 0, time), r = project(currentLane + .42, 0, time); g.beginPath(); g.moveTo(p0.cx, p0.horizon); g.lineTo(r.x, r.y + 18); g.lineTo(l.x, l.y + 18); g.closePath(); g.fill(); }
    const drawEvents = active ? C.chart : [{ time: time + .85, lane: 1, type: 'ring' }, { time: time + 1.7, lane: 0, type: 'ring' }, { time: time + 2.35, lane: 2, type: 'ring' }, { time: time + 2.7, lane: 1, type: 'ring' }];
    const ringBase = Math.min(w * .075, 47);
    for (let i = drawEvents.length - 1; i >= 0; i--) {
      const event = drawEvents[i], distance = event.time - time; if (distance > LOOK_AHEAD || distance < -.28 || active && event.time <= run.time && i < run.next) continue;
      const p = project(event.lane, distance, time), alpha = clamp((LOOK_AHEAD - distance) * 2, 0, 1) * clamp(1 + distance * 3, 0, 1);
      g.save(); g.globalAlpha = alpha;
      if (event.type === 'ring') {
        const rx = ringBase * p.scale, ry = rx * 1.12; g.shadowColor = '#a4e6f4'; g.shadowBlur = calm ? 0 : 17 * p.scale;
        ellipse(p.x, p.y - ry * .6, rx, ry, '#a7ecf5', 1 + p.scale * 1.7); g.shadowBlur = 0; ellipse(p.x, p.y - ry * .6, rx * .76, ry * .76, '#b2b3ff7a', .8);
        g.fillStyle = '#edecff'; g.beginPath(); g.arc(p.x, p.y - ry * .6, Math.max(1, 2.5 * p.scale), 0, Math.PI * 2); g.fill();
      } else {
        const radius = ringBase * .65 * p.scale; g.translate(p.x, p.y - radius * .5); if (!calm) g.rotate(time * .6 + event.time); g.beginPath(); for (let j = 0; j < 7; j++) { const a = j / 7 * Math.PI * 2, r = radius * (j % 2 ? .7 : 1); j ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fillStyle = '#392b36'; g.fill(); g.strokeStyle = '#eda76b'; g.lineWidth = 1 + p.scale; g.stroke(); g.beginPath(); g.moveTo(-radius * .4, -radius * .3); g.lineTo(radius * .3, radius * .3); g.moveTo(radius * .3, -radius * .3); g.lineTo(-radius * .3, radius * .3); g.strokeStyle = '#ffca9355'; g.stroke();
      }
      g.restore();
    }
    if (active) { for (let lane = 0; lane < 3; lane++) { const p = project(lane, 0, time); ellipse(p.x, p.y + 10, ringBase * .9, 8, lane === currentLane ? '#b3e4ef7a' : '#879ac52e', lane === currentLane ? 1.4 : .8); } }
    const lane = active ? C.laneAt(run, run.time) : 1, ship = project(lane, 0, time), shipSize = w < 600 ? 18 : 25;
    const shipY = ship.y - 10 + (calm || phase === 'paused' ? 0 : Math.sin(now * .002) * 1.7);
    g.save(); g.translate(ship.x, shipY);
    const flare = g.createLinearGradient(0, 8, 0, 63); flare.addColorStop(0, '#bddfffcc'); flare.addColorStop(.35, '#afa3ff66'); flare.addColorStop(1, '#a4c7ff00'); g.fillStyle = flare; g.beginPath(); g.moveTo(-5, 8); g.lineTo(0, calm ? 46 : 48 + level * 16); g.lineTo(5, 8); g.fill();
    g.shadowColor = '#aeccff'; g.shadowBlur = calm ? 0 : 18; g.beginPath(); g.moveTo(0, -shipSize); g.lineTo(-shipSize * .82, shipSize * .55); g.lineTo(-shipSize * .2, shipSize * .35); g.lineTo(0, shipSize * .62); g.lineTo(shipSize * .2, shipSize * .35); g.lineTo(shipSize * .82, shipSize * .55); g.closePath();
    const body = g.createLinearGradient(0, -shipSize, 0, shipSize); body.addColorStop(0, '#f1f4ff'); body.addColorStop(.5, '#b7b6ee'); body.addColorStop(1, '#555d9b'); g.fillStyle = body; g.fill(); g.shadowBlur = 0; g.strokeStyle = '#e1e5ff'; g.lineWidth = .8; g.stroke(); g.beginPath(); g.moveTo(0, -shipSize * .65); g.lineTo(-3, shipSize * .15); g.lineTo(3, shipSize * .15); g.closePath(); g.fillStyle = '#647ea9'; g.fill(); g.restore();
    const hit = run.last, age = hit ? time - hit.time : 10;
    if (active && age >= 0 && age < .55 && !calm) { const p = project(hit.lane, 0, time); g.globalAlpha = 1 - age / .55; ellipse(p.x, p.y, ringBase + age * 95, ringBase * .3 + age * 25, hit.points ? '#a7ebf0' : '#edb078', 1.2); g.globalAlpha = 1; }
  }
  function frame(now) {
    requestAnimationFrame(frame); const dt = Math.min(.1, (now - (lastFrame || now)) / 1000); lastFrame = now;
    let time = ['ready', 'loading'].includes(phase) ? 0 : frozenPosition;
    if (['playing', 'countdown', 'resuming'].includes(phase)) {
      const current = clock();
      if (phase === 'countdown' || phase === 'resuming') {
        const remaining = resumeAt - current; $('flightCount').textContent = Math.max(1, Math.ceil(remaining / C.BEAT)); $('flightCountLabel').textContent = phase === 'resuming' ? '跟随三拍，继续航行' : '准备启航';
        if (remaining <= 0) setPhase('playing');
      }
      time = phase === 'resuming' ? frozenPosition : Math.max(-COUNT_IN, current);
      if (phase === 'playing') { C.advance(run, current); frozenPosition = run.time; time = run.time; if (run.ended) finish(); }
    } else if (phase === 'result') time = run.time;
    if (analyser && ['playing', 'countdown', 'resuming'].includes(phase)) { analyser.getByteTimeDomainData(samples); let sum = 0; for (const value of samples) sum += ((value - 128) / 128) ** 2; level = Math.sqrt(sum / samples.length); } else level = 0;
    document.body.dataset.audioLevel = level.toFixed(5); document.body.dataset.audioState = ac?.state || 'idle'; document.body.dataset.calm = String(calm);
    updateHud(time); if (!lastVisualTime || now - lastVisualTime >= (calm ? 1000 / 30 : 1000 / 60) - 1) { lastVisualTime = now; draw(time, dt, now); }
  }

  // Handle a touch tap once, without depending on synthesized mouse clicks after a swipe.
  for (const button of document.querySelectorAll('button')) {
    let tap = null;
    button.addEventListener('touchstart', event => { const t = event.touches[0]; tap = event.touches.length === 1 ? { x: t.clientX, y: t.clientY, id: t.identifier } : null; }, { passive: true });
    button.addEventListener('touchcancel', () => { tap = null; }, { passive: true });
    button.addEventListener('touchend', event => {
      const t = Array.from(event.changedTouches).find(t => t.identifier === tap?.id), origin = tap; tap = null;
      if (!t || !origin || button.disabled || Math.hypot(t.clientX - origin.x, t.clientY - origin.y) > 12 || !event.cancelable) return;
      event.preventDefault(); button.click();
    }, { passive: false });
  }
  $('flightStart').addEventListener('click', start); $('flightAgain').addEventListener('click', start); $('flightRestart').addEventListener('click', start);
  $('flightResume').addEventListener('click', resume); $('flightPause').addEventListener('click', () => phase === 'paused' ? resume() : pause());
  for (const button of document.querySelectorAll('[data-flight-lane]')) button.addEventListener('click', () => selectLane(Number(button.dataset.flightLane)));
  $('flightMute').addEventListener('click', () => { mute = !mute; if (bus) bus.gain.setTargetAtTime(mute ? 0 : .72, ac.currentTime, .025); $('flightMute').setAttribute('aria-pressed', String(mute)); $('flightMute').textContent = mute ? '声音 关' : '声音 开'; });
  function syncMotion() { $('flightMotion').setAttribute('aria-pressed', String(calm)); }
  $('flightMotion').addEventListener('click', () => { calm = !calm; syncMotion(); }); query.addEventListener('change', event => { calm = event.matches; syncMotion(); }); syncMotion();
  document.addEventListener('keydown', event => {
    const target = event.target instanceof Element ? event.target : document.activeElement;
    if (event.altKey || event.ctrlKey || event.metaKey || target?.closest('input,textarea,select')) return;
    if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(event.code) && ['playing', 'countdown', 'resuming'].includes(phase)) { event.preventDefault(); if (!event.repeat) selectLane(clamp(currentLane + (['ArrowLeft', 'KeyA'].includes(event.code) ? -1 : 1), 0, 2)); }
    if (event.code === 'Space' && !target?.closest('button,a')) { event.preventDefault(); if (event.repeat) return; phase === 'paused' ? resume() : pause(); }
    if (event.code === 'Escape') { event.preventDefault(); if (phase !== 'paused') pause(); }
    if (event.code === 'KeyM' && !event.repeat) $('flightMute').click();
  });
  canvas.addEventListener('pointerdown', event => { if (!['playing', 'countdown', 'resuming'].includes(phase)) return; pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointerup', event => { if (!pointer || pointer.id !== event.pointerId) return; const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y; if (Math.abs(dx) > 22 && Math.abs(dx) > Math.abs(dy)) selectLane(clamp(currentLane + Math.sign(dx), 0, 2)); else if (Math.abs(dx) < 22 && Math.abs(dy) < 22) { const p = project(1, 0, run.time); selectLane(clamp(Math.round((event.clientX - p.cx) / p.spread + 1), 0, 2)); } pointer = null; });
  canvas.addEventListener('pointercancel', () => { pointer = null; });
  window.addEventListener('blur', () => pause('窗口已离开，音乐与航路自动暂停。'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pointer = null; pause('页面切到后台，音乐与航路自动暂停。'); } });
  window.addEventListener('pagehide', () => { token++; stopSource(); if (ac) ac.close().catch(() => {}); }); window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  window.addEventListener('resize', resize); if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  readBest(); resize(); setPhase('ready'); requestAnimationFrame(frame);
})();
