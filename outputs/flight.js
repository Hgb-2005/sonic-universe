/* Sonic Universe: an original browser flight, with no external runtime. */
(() => {
  'use strict';
  const C = SonicFlightCore, $ = id => document.getElementById(id);
  const canvas = $('flightCanvas'), g = canvas.getContext('2d');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const COUNT_IN = C.BEAT * 3, PREFS_KEY = 'sonic-universe-flight-settings-v1';
  const BEST_KEYS = { challenge: 'sonic-universe-flight-first-light-v1', casual: 'sonic-universe-flight-first-light-casual-v1' };
  const buffers = new Map(), buildings = new Map(), records = { casual: null, challenge: null };
  const laneNames = ['左航道', '中航道', '右航道'];
  const lessons = ['留在中航道收集', '移动到左航道', '移动到右航道', '回到中间避开陨石'];
  const query = matchMedia('(prefers-reduced-motion: reduce)');
  let calm = query.matches, mute = false, phase = 'ready', selectedMode = 'casual', playedMode = 'casual', run = C.createRun('casual'), buffer = null;
  let ac = null, bus = null, analyser = null, samples = null, source = null, token = 0, ticks = [];
  let anchorTime = 0, anchorPosition = -COUNT_IN, frozenPosition = -COUNT_IN, resumeAt = 0;
  let storageFailed = false, pointer = null, lastAnnounced = 0, w = 0, h = 0, dpr = 1, lastFrame = 0, level = 0;
  let currentLane = 1, lastVisualTime = 0, paintedFeedback = null;
  let tutorialSeen = false, offset = 0, particles = [], milestone = null, effects = new Set();
  let calibrationStart = null, calibrationNodes = new Set(), calibrationCaller = null, calibrationDraft = 0, calibrationRequest = 0;
  const stars = Array.from({ length: 170 }, (_, i) => ({ x: ((i * 7919 + 2341) % 10000) / 10000, y: ((i * 6577 + 4983) % 10000) / 10000, size: .45 + (i % 7) * .19, speed: .2 + (i % 5) * .15 }));

  const rules = () => C.modes[playedMode];
  function readBest() {
    try {
      const settings = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (settings?.version === 1) {
        if (['casual', 'challenge'].includes(settings.difficulty)) selectedMode = settings.difficulty;
        if (Number.isInteger(settings.offset) && Math.abs(settings.offset) <= 200) offset = Math.round(settings.offset / 10) * 10;
        tutorialSeen = settings.tutorialSeen === true;
      }
    } catch { storageFailed = true; }
    for (const mode of ['casual', 'challenge']) {
      try {
        const v = JSON.parse(localStorage.getItem(BEST_KEYS[mode]) || 'null');
        if (v?.version === 1 && v.chart === 'first-light-v1' && Number.isInteger(v.score) && v.score >= 0 && v.score <= 25000 && Number.isInteger(v.maxCombo) && v.maxCombo >= 0 && v.maxCombo <= C.modes[mode].totalRings && ['S','A','B','C','D'].includes(v.grade)) records[mode] = v;
      } catch { storageFailed = true; }
    }
    syncIntro();
  }
  function savePreferences() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ version: 1, difficulty: selectedMode, offset, tutorialSeen })); }
    catch { storageFailed = true; }
    renderBest();
  }
  function syncIntro() {
    for (const b of document.querySelectorAll('[data-flight-mode]')) b.setAttribute('aria-pressed', String(b.dataset.flightMode === selectedMode));
    $('flightStart').innerHTML = (tutorialSeen ? '开始' + C.modes[selectedMode].label + '航行' : '先练习，再启航') + ' <span aria-hidden="true">↗</span>';
    $('flightPractice').textContent = tutorialSeen ? '重温 15 秒练习' : '直接开始' + C.modes[selectedMode].label + '航行';
    $('flightLaunch').innerHTML = '开始' + C.modes[selectedMode].label + '航行 <span aria-hidden="true">↗</span>';
    $('flightStartHint').textContent = tutorialSeen ? '只需左右移动 · 穿过星环自动收集' : '15 秒安全练习 · 左右移动就能自动收集';
    $('flightOffsetLabel').textContent = (offset > 0 ? '+' : '') + offset + ' ms';
    renderBest();
  }
  function renderBest() {
    const best = records[selectedMode];
    $('flightBest').textContent = best ? best.score.toLocaleString('zh-CN') + ' / ' + best.grade : '尚未启航';
    $('flightBestLabel').textContent = C.modes[selectedMode].label + ' · 本机最高分';
    $('flightBestHud').textContent = records[playedMode]?.score.toLocaleString('zh-CN') || '0';
    $('flightRecordNote').textContent = storageFailed ? '浏览器存储不可用 · 本页仍保留成绩与设置' : '两种难度分别保存纪录 · 当前浏览器';
  }
  function setPhase(value) {
    phase = value; document.body.dataset.phase = value;
    const active = ['countdown', 'playing', 'paused', 'resuming'].includes(value);
    $('flightIntro').hidden = !['ready', 'loading'].includes(value);
    $('flightHud').hidden = !active; $('flightFooter').hidden = !['ready', 'loading'].includes(value);
    $('flightCountdown').hidden = !['countdown', 'resuming'].includes(value);
    $('flightPausePanel').hidden = value !== 'paused'; $('flightResultPanel').hidden = value !== 'result';
    $('flightPracticePanel').hidden = value !== 'practice-result';
    $('flightGuide').hidden = playedMode !== 'tutorial' || !['playing', 'countdown', 'resuming'].includes(value);
    $('flightDirection').hidden = value !== 'playing' || playedMode === 'tutorial';
    if (value !== 'playing') $('flightMilestone').hidden = true;
    document.body.dataset.mode = playedMode;
    for (const b of document.querySelectorAll('[data-flight-mode], [data-flight-calibrate], #flightPractice')) b.disabled = value === 'loading';
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
  async function buildSoundtrack(mode) {
    if (buffers.has(mode)) return buffers.get(mode); if (buildings.has(mode)) return buildings.get(mode);
    const modeRules = C.modes[mode];
    const building = (async () => {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Offline) throw new Error('此浏览器暂不支持生成航行音景，请尝试新版浏览器。');
      const rate = 22050, length = COUNT_IN + modeRules.duration + 1, off = new Offline(2, Math.ceil(rate * length), rate);
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
      for (let beat = 0; beat * C.BEAT < modeRules.duration; beat++) {
        const time = COUNT_IN + beat * C.BEAT, chord = chords[Math.floor(beat / 16) % 4];
        if (beat % 4 === 0) for (let j = 0; j < 4; j++) tone(chord[j], time, 3.1, .045, 'triangle', (j - 1.5) * .34);
        tone(chord[0] - 12, time, .42, .17, 'sine');
        const kick = off.createOscillator(), env = off.createGain(); kick.frequency.setValueAtTime(125, time); kick.frequency.exponentialRampToValueAtTime(37, time + .22); env.gain.setValueAtTime(.0001, time); env.gain.exponentialRampToValueAtTime(.32, time + .008); env.gain.exponentialRampToValueAtTime(.0001, time + .32); kick.connect(env); env.connect(mix); kick.start(time); kick.stop(time + .35);
        const hat = off.createBufferSource(), hp = off.createBiquadFilter(), hg = off.createGain(); hat.buffer = noiseBuffer; hp.type = 'highpass'; hp.frequency.value = beat % 2 ? 4500 : 6500; hg.gain.value = beat % 2 ? .14 : .08; hat.connect(hp); hp.connect(hg); hg.connect(mix); hat.start(time + C.BEAT / 2);
        if (beat >= 20 && beat < 68) tone(chord[(beat + 1) % 4] + 24, time + C.BEAT / 2, .25, .035, 'sine', Math.sin(beat) * .6);
      }
      for (const event of modeRules.chart) if (event.type === 'ring') { const chord = chords[Math.floor(event.time / C.BEAT / 16) % 4]; tone(chord[event.lane + 1] + 12, COUNT_IN + event.time, .7, .14, 'sine', (event.lane - 1) * .6); }
      const output = await off.startRendering();
      for (let ch = 0; ch < output.numberOfChannels; ch++) { const data = output.getChannelData(ch); for (let i = 0; i < rate; i++) data[data.length - 1 - i] *= i / rate; }
      buffers.set(mode, output); return output;
    })();
    buildings.set(mode, building);
    try { return await building; } finally { buildings.delete(mode); }
  }
  function stopSource() {
    if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); source = null; }
    for (const oscillator of ticks) { try { oscillator.stop(); } catch {} } ticks = [];
    for (const node of effects) { try { node.stop(); } catch {} } effects.clear();
  }
  function clock() { return ['playing', 'countdown', 'resuming'].includes(phase) && ac ? anchorPosition + ac.currentTime - anchorTime : frozenPosition; }
  function schedule(position, lead) {
    stopSource(); anchorPosition = position; anchorTime = ac.currentTime + lead;
    source = ac.createBufferSource(); source.buffer = buffer; source.connect(bus);
    const bufferPosition = COUNT_IN + position + offset / 1000;
    source.start(anchorTime + Math.max(0, -bufferPosition), Math.max(0, bufferPosition));
    if (lead) for (let i = 0; i < 3; i++) { const osc = ac.createOscillator(), env = ac.createGain(), time = ac.currentTime + i * C.BEAT; osc.frequency.value = 880; env.gain.setValueAtTime(.0001, time); env.gain.exponentialRampToValueAtTime(.07, time + .008); env.gain.exponentialRampToValueAtTime(.0001, time + .1); osc.connect(env); env.connect(bus); osc.start(time); osc.stop(time + .12); ticks.push(osc); }
    source.onended = () => { if (phase === 'playing' && !run.ended) { C.advance(run, rules().duration); finish(); } };
  }
  async function start(mode = selectedMode) {
    if (phase === 'loading') return;
    const request = ++token; stopSource(); playedMode = mode; run = C.createRun(mode); currentLane = 1; paintedFeedback = null; lastAnnounced = 0; particles = []; milestone = null; frozenPosition = -COUNT_IN;
    $('flightProgress').max = rules().duration;
    setPhase('loading'); $('flightStart').disabled = true; $('flightLoadStatus').textContent = buffers.has(mode) ? '正在准备航路…' : '正在生成原创音景…';
    renderBest();
    try {
      audioSetup(); await ac.resume(); const prepared = await buildSoundtrack(mode); if (request !== token) return; buffer = prepared;
      if (document.hidden || ac.state !== 'running') { setPhase('ready'); $('flightLoadStatus').textContent = '准备好了。回到此页面后，再点开始航行。'; return; }
      $('flightLoadStatus').textContent = ''; schedule(-COUNT_IN, 0); resumeAt = 0; setPhase('countdown'); syncControls(); canvas.focus({ preventScroll: true });
      $('flightAnnouncement').textContent = (mode === 'tutorial' ? '安全练习，不计入纪录。' : C.modes[mode].label + '模式。') + '三拍后启航。用方向键、A D 或下方按钮移动。';
    } catch (error) { setPhase('ready'); $('flightLoadStatus').textContent = error.message || '音景未能准备好，请重试。'; } finally { $('flightStart').disabled = false; }
  }
  function pause(reason = '音乐与航路已一起暂停。') {
    if (phase === 'loading') { token++; setPhase('ready'); $('flightLoadStatus').textContent = '已暂停准备。回到页面后再点开始航行。'; return; }
    if (!['playing', 'countdown', 'resuming'].includes(phase)) return;
    token++; const time = phase === 'resuming' ? frozenPosition : clock();
    if (phase === 'playing') { C.advance(run, time); if (run.ended) { finish(); return; } }
    frozenPosition = clamp(time, -COUNT_IN, rules().duration); paintedFeedback = run.last; stopSource(); setPhase('paused');
    $('flightPauseReason').textContent = reason; $('flightPauseTitle').focus({ preventScroll: true }); $('flightAnnouncement').textContent = '航行已暂停';
  }
  async function resume() {
    if (phase !== 'paused' || $('flightCalibration').open) return; if (frozenPosition < 0) { start(playedMode); return; }
    const request = ++token; $('flightResume').disabled = true;
    try { await ac.resume(); if (request !== token || phase !== 'paused') return; if (document.hidden || ac.state !== 'running') throw new Error('请回到此页面后，再点继续航行。'); resumeAt = frozenPosition; schedule(frozenPosition, COUNT_IN); setPhase('resuming'); $('flightAnnouncement').textContent = '三拍后继续，当前分数与航路保留。'; }
    catch (error) { $('flightPauseReason').textContent = error.message || '暂时无法恢复声音，请重试。'; } finally { $('flightResume').disabled = false; }
  }
  function finish() {
    if (['result', 'practice-result'].includes(phase)) return; token++; frozenPosition = run.time; stopSource();
    if (playedMode === 'tutorial') { finishPractice(); return; }
    const result = C.result(run), previous = records[playedMode]?.score || 0, newBest = !records[playedMode] || result.score > previous;
    let best = records[playedMode];
    if (newBest) best = { version: 1, chart: 'first-light-v1', score: result.score, grade: result.grade, maxCombo: result.maxCombo };
    records[playedMode] = best;
    let saved = false;
    try { localStorage.setItem(BEST_KEYS[playedMode], JSON.stringify(best)); saved = true; } catch { storageFailed = true; }
    renderBest(); $('flightGrade').textContent = result.grade; $('flightFinalScore').textContent = result.score.toLocaleString('zh-CN');
    $('flightAccuracy').textContent = result.accuracy + '%'; $('flightMaxCombo').textContent = result.maxCombo; $('flightDistance').textContent = Math.floor(result.time) + 's';
    $('flightResultEyebrow').textContent = result.complete ? 'VOYAGE COMPLETE' : 'A NEW VOYAGE AWAITS';
    $('flightResultTitle').textContent = result.complete ? '你点亮了这段星河。' : '调整航向，再出发。';
    $('flightResultSubtitle').textContent = C.modes[playedMode].label + '模式 · ' + (result.complete ? '60 秒的旋律，留下你的轨迹。' : '能量耗尽，可以试试更宽容的休闲模式。');
    $('flightBreakdown').textContent = '精准 ' + result.perfect + ' · 命中 ' + result.good + ' · 错过 ' + result.misses + ' · 碰撞 ' + result.collisions;
    $('flightAdvice').textContent = result.collisions > 2 ? '下次试试：橙色陨石靠近时提前换道，先保住连击。' : result.misses > rules().totalRings * .2 ? '下次试试：看向航道远处，跟着「下个星环」提前换道。' : result.good > result.perfect * .2 ? '下次试试：星环到来前站稳航道，精准命中的分数更高。' : result.grade === 'S' ? '漂亮的航行！可以换个难度，或继续追逐自己的最高分。' : '节奏越来越稳了。试着连续收集 10 个星环，点亮加分倍率。';
    $('flightAgain').innerHTML = '再飞一次 · ' + C.modes[playedMode].label + ' <span aria-hidden="true">↗</span>';
    $('flightSaveStatus').textContent = saved ? C.modes[playedMode].label + '纪录已保存 · 两种难度分别计分' : '纪录未能保存到浏览器，本页仍保留。请检查网站存储权限。';
    $('flightNewBest').hidden = !newBest; setPhase('result'); $('flightResultTitle').focus({ preventScroll: true });
    $('flightAnnouncement').textContent = (result.complete ? '航行完成' : '能量耗尽') + '。得分 ' + result.score + '，评级 ' + result.grade + '，最高连击 ' + result.maxCombo;
  }
  function finishPractice() {
    tutorialSeen = true; savePreferences(); syncIntro();
    const count = run.collected.length;
    $('flightPracticeTitle').textContent = count === 4 ? '准备好，去看更远的星海。' : '再熟悉一点，就能轻松启航。';
    $('flightPracticeSummary').textContent = '练习完成了 ' + count + ' / 4 个动作。练习不计入最高分，随时可以再来一次。';
    $('flightLessons').replaceChildren(...lessons.map((text, i) => { const li = document.createElement('li'); const done = run.collected.includes((i + 1) * 3.125); li.textContent = (done ? '✓ ' : '○ ') + text + (done ? '' : ' · 可以再试试'); li.dataset.done = String(done); return li; }));
    setPhase('practice-result'); $('flightPracticeTitle').focus({ preventScroll: true });
    $('flightAnnouncement').textContent = '练习完成，成功 ' + count + ' 个动作。可以启航，或重新练习。';
  }
  function ready() {
    token++; stopSource(); particles = []; milestone = null; paintedFeedback = null; playedMode = selectedMode; run = C.createRun(selectedMode); currentLane = 1; frozenPosition = -COUNT_IN;
    $('flightLoadStatus').textContent = ''; setPhase('ready'); syncIntro(); $('flightStart').focus({ preventScroll: true });
  }
  function stopCalibration() {
    calibrationRequest++; calibrationStart = null;
    for (const node of calibrationNodes) { try { node.stop(); } catch {} } calibrationNodes.clear();
    $('flightCalibrationPulse').dataset.lit = 'false'; $('flightCalibrationListen').textContent = '试听 8 拍';
  }
  function calibrationValue() {
    $('flightOffset').value = calibrationDraft;
    $('flightOffsetValue').textContent = (calibrationDraft > 0 ? '+' : '') + calibrationDraft + ' ms';
  }
  function openCalibration(event) {
    if (!['ready', 'paused'].includes(phase)) return;
    calibrationCaller = event.currentTarget; calibrationDraft = offset; calibrationValue(); stopCalibration();
    $('flightCalibrationStatus').textContent = '设置只影响航行模式，音乐星空保留原有设置。';
    $('flightCalibration').showModal();
  }
  function closeCalibration(save) {
    stopCalibration();
    if (save) { offset = calibrationDraft; savePreferences(); syncIntro(); }
    $('flightCalibration').close(); calibrationCaller?.focus({ preventScroll: true });
  }
  async function audition() {
    stopCalibration(); const request = calibrationRequest;
    try {
      audioSetup(); await ac.resume();
      if (request !== calibrationRequest || !$('flightCalibration').open || document.hidden || ac.state !== 'running') return;
      calibrationStart = ac.currentTime + .4;
      for (let i = 0; i < 8; i++) {
        const osc = ac.createOscillator(), env = ac.createGain(), time = calibrationStart + i * C.BEAT;
        osc.frequency.value = i % 4 === 0 ? 1046 : 784; env.gain.setValueAtTime(.0001, time); env.gain.exponentialRampToValueAtTime(.14, time + .006); env.gain.exponentialRampToValueAtTime(.0001, time + .09);
        osc.connect(env); env.connect(bus); calibrationNodes.add(osc); osc.onended = () => { calibrationNodes.delete(osc); osc.disconnect(); env.disconnect(); }; osc.start(time); osc.stop(time + .12);
      }
      $('flightCalibrationStatus').textContent = mute ? '当前声音已关闭。关闭面板并打开声音后，可重新试听。' : '每拍圆环亮起时应听到一声节拍；调节后可再次试听。';
      $('flightCalibrationListen').textContent = '重新试听';
    } catch (error) { $('flightCalibrationStatus').textContent = error.message || '无法试听，请重试。'; }
  }
  function updateCalibration() {
    if (calibrationStart === null || !ac) return;
    const position = (ac.currentTime - calibrationStart - calibrationDraft / 1000) / C.BEAT, beat = Math.floor(position), fraction = position - beat;
    $('flightCalibrationPulse').dataset.lit = String(beat >= 0 && beat < 8 && fraction < .2);
    $('flightCalibrationBeat').textContent = beat < 0 ? '准备…' : beat < 8 ? (beat + 1) + ' / 8' : '试听结束 · 可调整后重听';
    if (position >= 8.5) stopCalibration();
  }
  function selectLane(lane) {
    if (!['playing', 'countdown', 'resuming'].includes(phase)) return;
    const time = phase === 'playing' ? clock() : run.time; C.move(run, lane, time); if (run.ended) { finish(); return; } currentLane = run.movement.to; syncControls();
  }
  function syncControls() { for (const b of document.querySelectorAll('[data-flight-lane]')) b.setAttribute('aria-pressed', String(Number(b.dataset.flightLane) === currentLane)); }
  function format(time) { const n = Math.max(0, Math.floor(time)); return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
  function playEffect(kind, combo) {
    if (!ac || ac.state !== 'running' || mute) return;
    const bright = kind === 'perfect' || kind === 'good', osc = ac.createOscillator(), env = ac.createGain(), time = ac.currentTime;
    osc.type = bright ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(bright ? 660 + Math.min(combo, 30) * 9 : kind === 'rock' ? 130 : 210, time);
    osc.frequency.exponentialRampToValueAtTime(bright ? 1320 : 65, time + .12);
    env.gain.setValueAtTime(.0001, time); env.gain.exponentialRampToValueAtTime(bright ? .055 : .045, time + .008); env.gain.exponentialRampToValueAtTime(.0001, time + .2);
    osc.connect(env); env.connect(bus); effects.add(osc); osc.onended = () => { effects.delete(osc); osc.disconnect(); env.disconnect(); }; osc.start(time); osc.stop(time + .22);
  }
  function updateGuide(time) {
    const step = time < 4.1 ? 0 : time < 7.3 ? 1 : time < 10.4 ? 2 : 3;
    const titles = ['留在中航道，等待星环', '向左移动，接住下一束星光', '向右移动，跟随下一枚星环', '回到中间，让右侧陨石擦肩而过'];
    $('flightGuideStep').textContent = '0' + (step + 1) + ' / ' + ['自动收集', '向左换道', '向右换道', '避开陨石'][step];
    $('flightGuideTitle').textContent = titles[step];
    $('flightGuideText').textContent = ['星环到达飞船时自动收集，无需按键打击。', '按 ← / A，手机可左滑或点左航道。', '从左侧按两次 → / D，也可直接点击右航道。', '按 ← / A 回到中间，橙色陨石所在的航道要避开。'][step];
    const checks = $('flightGuideChecks').children;
    for (let i = 0; i < 4; i++) {
      const done = run.collected.includes((i + 1) * 3.125), passed = run.time >= (i + 1) * 3.125;
      checks[i].textContent = done ? '✓' : String(i + 1); checks[i].dataset.state = done ? 'done' : passed ? 'miss' : step === i ? 'current' : 'next';
      checks[i].setAttribute('aria-label', lessons[i] + (done ? '，已完成' : passed ? '，尚未完成' : '，等待练习'));
    }
    for (const b of document.querySelectorAll('[data-flight-lane]')) b.dataset.guide = String(Number(b.dataset.flightLane) === [1, 0, 2, 1][step]);
  }
  function updateHud(time) {
    $('flightScore').textContent = String(run.score).padStart(6, '0'); $('flightTime').textContent = format(time) + ' / ' + format(rules().duration);
    $('flightProgress').value = Math.max(0, time); $('flightEnergy').textContent = run.energy; $('flightEnergyBar').value = run.energy; $('flightEnergyBar').parentElement.dataset.low = String(run.energy <= 32);
    $('flightChapter').textContent = playedMode === 'tutorial' ? '安全练习 / 不计纪录' : C.modes[playedMode].label + ' / ' + (time < 15 ? '星光初醒' : time < 42.5 ? '逐光而行' : '星潮归航');
    $('flightCombo').textContent = run.combo; $('flightComboBox').hidden = phase !== 'playing' || run.combo < 2;
    $('flightMultiplier').textContent = '×' + (1 + Math.min(3, Math.floor(run.combo / 10)) * .25).toFixed(2);
    const event = run.last; $('flightFeedback').hidden = phase !== 'playing' || !event || time - event.time > .7;
    if (event && event !== paintedFeedback) {
      paintedFeedback = event; const names = { perfect: 'PERFECT', good: 'GOOD', miss: '错过星环', rock: '注意陨石' }; $('flightJudgment').textContent = names[event.kind]; $('flightJudgmentDetail').textContent = event.points ? '+' + event.points + ' · 星光入舱' : event.kind === 'miss' ? '提前移动到发光航道' : '换一条航道，继续飞行'; $('flightFeedback').dataset.kind = event.kind;
      if (phase === 'playing' && time - event.time < .25) {
        playEffect(event.kind, run.combo);
        if (!calm) for (let i = 0; i < (event.points ? 14 : 8); i++) particles.push({ lane: event.lane, time: event.time, angle: i * 2.399, speed: 28 + i * 5, color: event.points ? '#b2edf5' : '#f0b280' });
        if (run.combo && run.combo % 10 === 0 && run.combo !== lastAnnounced) { lastAnnounced = run.combo; milestone = { time, combo: run.combo }; $('flightMilestone').textContent = run.combo + ' 连击 · 星光加成 ×' + (1 + Math.min(3, run.combo / 10) * .25).toFixed(2); $('flightAnnouncement').textContent = run.combo + ' 连击'; }
      }
    }
    $('flightMilestone').hidden = phase !== 'playing' || !milestone || time - milestone.time > 1.6;
    if (playedMode === 'tutorial') updateGuide(time);
    else for (const b of document.querySelectorAll('[data-flight-lane]')) b.dataset.guide = 'false';
    if (phase === 'playing' && playedMode !== 'tutorial') {
      const next = rules().chart.slice(run.next).find(e => e.type === 'ring');
      const danger = rules().chart.slice(run.next).find(e => e.type === 'rock' && e.lane === currentLane && e.time - time < 1.5);
      $('flightDirection').textContent = danger ? '避开当前航道的陨石 ↔' : next ? '下个星环 · ' + ['← ', '◇ ', '→ '][next.lane] + laneNames[next.lane] : '航程即将完成 · 继续向前';
      $('flightDirection').dataset.danger = String(!!danger);
    }
    document.body.dataset.time = Math.max(0, time).toFixed(3); document.body.dataset.lane = currentLane; document.body.dataset.score = run.score; document.body.dataset.combo = run.combo; document.body.dataset.energy = run.energy; document.body.dataset.next = run.next;
  }

  function resize() { w = canvas.clientWidth; h = canvas.clientHeight; dpr = Math.min(devicePixelRatio || 1, 1.75); canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function project(lane, distance, time) {
    const LOOK_AHEAD = rules().lookAhead;
    const p = Math.max(0, 1 - distance / LOOK_AHEAD), depth = p * p, play = !['ready', 'loading'].includes(phase);
    const cx = w * (play ? .5 : w < 600 ? .55 : .68), horizon = h * (w < 600 ? .43 : .32), bottom = h * (w < 600 ? play ? .78 : .69 : .79);
    const spread = w * (w < 600 ? .285 : .205);
    const curve = calm ? 0 : Math.sin(time * .13) * w * .025 * (1 - depth);
    return { x: cx + curve + (lane - 1) * spread * (.04 + depth * .96), y: horizon + (bottom - horizon) * depth, scale: .05 + depth * .95, cx, horizon, bottom, spread };
  }
  function ellipse(x, y, rx, ry, color, width = 1) { g.beginPath(); g.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), 0, 0, Math.PI * 2); g.strokeStyle = color; g.lineWidth = width; g.stroke(); }
  function draw(time, dt, now) {
    const LOOK_AHEAD = rules().lookAhead, power = Math.min(3, Math.floor(run.combo / 10));
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
      g.strokeStyle = lane === -.5 || lane === 2.5 ? 'rgba(167,196,247,' + (.29 + power * .12) + ')' : '#959fe32a'; g.lineWidth = lane === -.5 || lane === 2.5 ? 1.2 + power * .35 : .7; g.stroke();
    }
    const gridTime = calm ? 0 : -time;
    for (let i = 0; i < 18; i++) { const span = 18 * C.BEAT, d = ((i * C.BEAT + gridTime) % span + span) % span / span * LOOK_AHEAD, left = project(-.5, d, time), right = project(2.5, d, time); g.beginPath(); g.moveTo(left.x, left.y); g.lineTo(right.x, right.y); g.strokeStyle = 'rgba(136,166,230,' + (.02 + left.scale * .12) + ')'; g.lineWidth = .6; g.stroke(); }
    const pad = project(currentLane, 0, time);
    if (active) { const beam = g.createLinearGradient(pad.x, p0.horizon, pad.x, pad.bottom + 30); beam.addColorStop(0, '#9ce9ee00'); beam.addColorStop(1, '#9ce9ee12'); g.fillStyle = beam; const l = project(currentLane - .42, 0, time), r = project(currentLane + .42, 0, time); g.beginPath(); g.moveTo(p0.cx, p0.horizon); g.lineTo(r.x, r.y + 18); g.lineTo(l.x, l.y + 18); g.closePath(); g.fill(); }
    const drawEvents = active ? rules().chart : [{ time: time + .85, lane: 1, type: 'ring' }, { time: time + 1.7, lane: 0, type: 'ring' }, { time: time + 2.35, lane: 2, type: 'ring' }, { time: time + 2.7, lane: 1, type: 'ring' }];
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
    g.shadowColor = '#aeccff'; g.shadowBlur = calm ? 0 : 18 + power * 7; g.beginPath(); g.moveTo(0, -shipSize); g.lineTo(-shipSize * .82, shipSize * .55); g.lineTo(-shipSize * .2, shipSize * .35); g.lineTo(0, shipSize * .62); g.lineTo(shipSize * .2, shipSize * .35); g.lineTo(shipSize * .82, shipSize * .55); g.closePath();
    const body = g.createLinearGradient(0, -shipSize, 0, shipSize); body.addColorStop(0, '#f1f4ff'); body.addColorStop(.5, '#b7b6ee'); body.addColorStop(1, '#555d9b'); g.fillStyle = body; g.fill(); g.shadowBlur = 0; g.strokeStyle = '#e1e5ff'; g.lineWidth = .8; g.stroke(); g.beginPath(); g.moveTo(0, -shipSize * .65); g.lineTo(-3, shipSize * .15); g.lineTo(3, shipSize * .15); g.closePath(); g.fillStyle = '#647ea9'; g.fill(); g.restore();
    const hit = run.last, age = hit ? time - hit.time : 10;
    if (active && age >= 0 && age < .55 && !calm) { const p = project(hit.lane, 0, time); g.globalAlpha = 1 - age / .55; ellipse(p.x, p.y, ringBase + age * 95, ringBase * .3 + age * 25, hit.points ? '#a7ebf0' : '#edb078', 1.2); g.globalAlpha = 1; }
    particles = particles.filter(p => time - p.time < .8);
    if (!calm && active) for (const particle of particles) { const age = Math.max(0, time - particle.time), p = project(particle.lane, 0, time); g.globalAlpha = 1 - age / .8; g.fillStyle = particle.color; g.beginPath(); g.arc(p.x + Math.cos(particle.angle) * age * particle.speed, p.y - 12 + Math.sin(particle.angle) * age * particle.speed * .7 - age * 28, 1.7 * (1 - age / 1.1), 0, Math.PI * 2); g.fill(); } g.globalAlpha = 1;
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
    updateHud(time); updateCalibration(); if (!lastVisualTime || now - lastVisualTime >= (calm ? 1000 / 30 : 1000 / 60) - 1) { lastVisualTime = now; draw(time, dt, now); }
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
  for (const b of document.querySelectorAll('[data-flight-mode]')) b.addEventListener('click', () => { if (!['ready', 'loading'].includes(phase)) return; selectedMode = b.dataset.flightMode; savePreferences(); syncIntro(); });
  $('flightStart').addEventListener('click', () => start(tutorialSeen ? selectedMode : 'tutorial'));
  $('flightPractice').addEventListener('click', () => start(tutorialSeen ? 'tutorial' : selectedMode));
  $('flightAgain').addEventListener('click', () => start(playedMode)); $('flightRestart').addEventListener('click', () => start(playedMode));
  $('flightLaunch').addEventListener('click', () => start(selectedMode)); $('flightRetryPractice').addEventListener('click', () => start('tutorial'));
  for (const b of document.querySelectorAll('[data-flight-ready]')) b.addEventListener('click', ready);
  for (const b of document.querySelectorAll('[data-flight-calibrate]')) b.addEventListener('click', openCalibration);
  $('flightCalibrationListen').addEventListener('click', audition);
  $('flightCalibrationClose').addEventListener('click', () => closeCalibration(false)); $('flightCalibrationDone').addEventListener('click', () => closeCalibration(true));
  $('flightCalibration').addEventListener('cancel', event => { event.preventDefault(); closeCalibration(false); });
  $('flightOffset').addEventListener('input', () => { calibrationDraft = clamp(Math.round(Number($('flightOffset').value) / 10) * 10, -200, 200); calibrationValue(); });
  $('flightCalibrationReset').addEventListener('click', () => { calibrationDraft = 0; calibrationValue(); });
  $('flightResume').addEventListener('click', resume); $('flightPause').addEventListener('click', () => phase === 'paused' ? resume() : pause());
  for (const button of document.querySelectorAll('[data-flight-lane]')) button.addEventListener('click', () => selectLane(Number(button.dataset.flightLane)));
  $('flightMute').addEventListener('click', () => { mute = !mute; if (bus) bus.gain.setTargetAtTime(mute ? 0 : .72, ac.currentTime, .025); $('flightMute').setAttribute('aria-pressed', String(mute)); $('flightMute').textContent = mute ? '声音 关' : '声音 开'; });
  function syncMotion() { $('flightMotion').setAttribute('aria-pressed', String(calm)); }
  $('flightMotion').addEventListener('click', () => { calm = !calm; syncMotion(); }); query.addEventListener('change', event => { calm = event.matches; syncMotion(); }); syncMotion();
  document.addEventListener('keydown', event => {
    if ($('flightCalibration').open) return;
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
  window.addEventListener('blur', () => { stopCalibration(); pause('窗口已离开，音乐与航路自动暂停。'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pointer = null; stopCalibration(); pause('页面切到后台，音乐与航路自动暂停。'); } });
  window.addEventListener('pagehide', () => { token++; stopCalibration(); stopSource(); if (ac) ac.close().catch(() => {}); }); window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  window.addEventListener('resize', resize); if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  $('flightGuideChecks').replaceChildren(...lessons.map(() => document.createElement('span')));
  readBest(); playedMode = selectedMode; run = C.createRun(selectedMode); renderBest(); resize(); setPhase('ready'); requestAnimationFrame(frame);
})();
