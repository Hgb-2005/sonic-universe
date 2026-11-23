/* The room is a presentation of SonicPlayback, never a second audio player. */
(() => {
  'use strict';
  if (new URLSearchParams(location.search).has('sharedViewer')) return;
  const core = window.SonicListeningCore, api = window.SonicPlayback;
  const scenes = window.SonicReactiveScenes, effects = window.SonicLyricEffects;
  if (!core || !api || !effects) { document.documentElement.classList.remove('listening-enabled'); return; }
  const storageKey = 'sonic-listening-room-v1';
  let preferences;
  try { preferences = core.normalize(JSON.parse(localStorage.getItem(storageKey))); }
  catch { preferences = core.normalize(); }
  preferences.lyricEffect=effects.get(preferences.lyricEffect).id;
  const effectShapes='<span class="lr-fx-shapes" aria-hidden="true"><i></i><i></i><i></i></span>';
  const icons = {
    library:'<path d="M4 4h5v16H4Zm8 0v16m4-15 4 14"/>',
    settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    search:'<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
    expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
    music:'<path d="M9 18V5l11-2v13M9 8l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    play:'<path d="m8 4 13 8-13 8Z"/>', pause:'<path d="M6 4h4v16H6Zm8 0h4v16h-4Z"/>',
    previous:'<path d="M5 5v14m14-14L8 12l11 7Z"/>', next:'<path d="M19 5v14M5 5l11 7-11 7Z"/>',
    heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    volume:'<path d="m11 4-6 5H2v6h3l6 5Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    queue:'<path d="M4 6h16M4 12h16M4 18h10"/>', repeat:'<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>',
    queueAdd:'<path d="M3 6h17M3 12h11M3 18h11m5-5v8m-4-4h8"/>',
    up:'<path d="m6 15 6-6 6 6"/>', down:'<path d="m6 9 6 6 6-6"/>',
    grip:'<path d="M9 5h.01M15 5h.01M9 12h.01m5.99 0h.01M9 19h.01m5.99 0h.01" stroke-width="2.8"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>', desktop:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    sound:'<path d="M3 10v4m4-7v10m5-14v18m5-14v10m4-7v4"/>', mini:'<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="11" y="11" width="8" height="6" rx="1"/>',
    scene:'<path d="M2 17l5-6 4 4 4-7 7 9M2 20h20"/><circle cx="7" cy="6" r="2"/>',
    headphones:'<path d="M3 14v-2a9 9 0 0 1 18 0v2M3 14v4a2 2 0 0 0 2 2h2v-7H5a2 2 0 0 0-2 1Zm18 0v4a2 2 0 0 1-2 2h-2v-7h2a2 2 0 0 1 2 1Z"/>',
    lyrics:'<path d="M4 5h16M4 10h11M4 15h16M4 20h9"/>',
    arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>', folder:'<path d="M3 7a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  };
  const icon = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>';
  const root = document.createElement('div'); root.id = 'listeningRoom';
  root.innerHTML = `
    <canvas class="lr-background" aria-hidden="true"></canvas>
    <div class="lr-lyric-atmosphere" aria-hidden="true"></div>
    <div class="lr-mod-decoration" data-mod-decoration aria-hidden="true" hidden></div>
    <div class="lr-titlebar" data-desktop-only hidden aria-hidden="true"></div>
    <button type="button" class="lr-immersion-exit" data-action="exit-immersion" aria-keyshortcuts="Escape" hidden>${icon('close')}退出沉浸</button>
    <header class="lr-header">
      <button type="button" class="lr-brand" data-action="home" aria-label="声波宇宙首页"><img src="./assets/sonic-mark.svg" alt=""><span><span class="lr-brand-name">声波宇宙</span><small class="lr-brand-sub">SONIC UNIVERSE</small></span></button>
      <nav class="lr-tabs" aria-label="页面导航"><button class="lr-tab" data-room-mode="work" aria-pressed="true">${icon('headphones')}工作陪伴</button><button class="lr-tab" data-room-mode="listen" aria-pressed="false">${icon('music')}正在播放</button><button class="lr-tab" data-room-mode="visual" aria-pressed="false" ${scenes?'':'hidden'}>${icon('scene')}视觉舞台</button><button class="lr-tab" data-room-mode="library" aria-pressed="false">${icon('library')}音乐库</button></nav>
      <div class="lr-header-actions"><button class="lr-text-button" data-action="discovery" aria-label="音乐发现" title="音乐发现">${icon('music')}<span>发现</span></button><button class="lr-text-button" data-action="search" aria-label="搜索音乐" title="搜索音乐" aria-pressed="false">${icon('search')}<span>搜索</span></button><button class="lr-icon" data-action="external" data-external-header aria-label="管理外部声音联动" title="管理外部声音联动" hidden>${icon('sound')}</button><button class="lr-icon" data-action="settings" aria-label="调整氛围" title="调整氛围">${icon('settings')}</button><button class="lr-icon" data-action="fullscreen" aria-label="全屏欣赏">${icon('expand')}</button></div>
    </header>
    <main class="lr-stage">
      <span class="lr-live" data-live role="status" hidden></span>
      <section class="sl-library" data-music-library aria-label="本机音乐库" hidden></section>
      <button type="button" class="lr-beat-clock" data-action="beat-clock" aria-label="视觉舞台节拍联动" aria-pressed="true" title="根据音频实时估算速度。四拍分组仅作参考。" hidden>
        <span class="lr-beat-clock-steps" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span data-beat-status>等待音乐</span>
      </button>
      <section class="lr-visual-view" data-visual-view hidden aria-label="视觉舞台">
        <div class="lr-visual-caption"><p data-visual-mode>自动随曲</p><h1 data-visual-title></h1></div>
        <div class="lr-view-links" role="group" aria-label="视觉舞台操作">
          <button type="button" class="lr-scene-open" data-action="now-playing">正在播放</button>
          <button type="button" class="lr-scene-open" data-action="expand-lyrics" aria-controls="lrLyricReading" aria-expanded="false">${icon('lyrics')}同步歌词</button>
          <button type="button" class="lr-scene-open" data-action="scene-gallery">${icon('scene')}选择场景</button>
        </div>
      </section>
      <section class="lr-listen-view" id="lrListenView" data-listen hidden aria-label="正在播放" tabindex="-1">
        <div class="lr-now-composition">
        <div class="lr-now-artwork">
          <button type="button" class="lr-now-cover" data-action="expand-lyrics" aria-label="打开歌词视图" aria-controls="lrLyricReading" aria-expanded="false"><span data-now-cover-placeholder>${icon('music')}</span><img data-now-cover decoding="async" alt="" hidden></button>
          <h1 class="lr-now-title" data-now-title>选择一首歌</h1>
          <p class="lr-now-artist" data-now-artist></p>
        </div>
        <div class="lr-now-content">
        <section class="lr-seek-lyrics" data-seek-lyrics aria-label="进度预览" hidden>
          <span class="lr-seek-time" data-seek-time></span>
          <p class="lr-seek-line" data-seek-line></p>
          <p class="lr-seek-translation" data-seek-translation hidden></p>
        </section>
        <div class="lr-now-preview" data-lyric-preview>
          <div class="lr-now-lines" role="group" aria-label="同步歌词">
            <button type="button" class="lr-preview-row" data-preview-row="-1" hidden><span data-preview-line="-1"></span></button>
            <button type="button" class="lr-preview-row" data-preview-row="0" disabled><strong data-preview-line="0"></strong><span data-preview-translation hidden></span></button>
            <button type="button" class="lr-preview-row" data-preview-row="1" hidden><span data-preview-line="1"></span></button>
          </div>
          <div class="lr-now-actions">
            <div class="lr-view-links" role="group" aria-label="切换播放视图">
              <button type="button" class="lr-view-link lr-view-link-primary" data-now-lyrics data-action="full-lyrics" aria-controls="lrLyricReading" aria-expanded="false">${icon('lyrics')}全文歌词</button>
              <button type="button" class="lr-view-link lr-immersion-entry" data-action="enter-immersion" aria-controls="lrListenView">${icon('expand')}沉浸播放</button>
              <button type="button" class="lr-view-link" data-action="visual-stage" ${scenes?'':'hidden'}>${icon('scene')}视觉舞台</button>
            </div>
            <p class="lr-lyric-source" data-lyric-source-info role="status" hidden></p>
            <button type="button" class="lr-view-link" data-action="retry-lyrics" hidden>重新获取歌词</button>
          </div>
        </div>
        <div class="lr-expanded-lyrics" id="lrLyricReading" data-expanded-lyrics hidden>
        <div class="lr-lyric-window" data-stage-lyrics>
          <div class="lr-effect-stage" data-effect-stage hidden aria-hidden="true">${effectShapes}</div>
          <div class="lr-effect-surface" data-effect-surface hidden aria-hidden="true"></div>
          <div class="lr-lyric-timeline" data-lyric-timeline></div>
          <div class="lr-lyric-notice" data-lyric-notice hidden><p data-lyric-meta></p></div>
        </div>
        <div class="lr-full-tools" data-lyric-full-tools hidden>
          <h2 id="lrFullLyricsTitle">全文歌词</h2>
          <div class="lr-full-actions">
            <button type="button" class="lr-choice" data-lyric-follow hidden>回到当前句</button>
            <button type="button" class="lr-choice lr-immersion-entry" data-action="enter-immersion" aria-controls="lrListenView">${icon('expand')}沉浸播放</button>
          </div>
        </div>
        <div class="lr-full-lyrics" data-full-lyrics role="region" aria-labelledby="lrFullLyricsTitle" tabindex="0" hidden></div>
        <div class="lr-lyric-tools">
          <div class="lr-view-links" role="group" aria-label="切换播放视图"><button type="button" class="lr-lyrics-entry" data-action="collapse-lyrics">返回正在播放</button><button type="button" class="lr-lyrics-entry" data-action="full-lyrics" data-stage-full-lyrics hidden>全文歌词</button><button type="button" class="lr-lyrics-entry" data-action="visual-stage" ${scenes?'':'hidden'}>视觉舞台</button></div>
          <details class="lr-more-lyrics">
            <summary>更多</summary>
            <div class="lr-lyric-options">
              <div class="lr-lyric-styles" role="group" aria-label="歌词样式"><button data-lyric-style="list" aria-pressed="true">全文</button><button data-lyric-style="stage" aria-pressed="false">滚动</button><button data-lyric-style="fly" aria-pressed="false">飞入</button><button data-action="lyric-effects" aria-haspopup="dialog" aria-pressed="false">动效</button></div>
              <button class="lr-lyrics-entry" data-action="lyric-mods" data-desktop-only hidden>样式模组</button>
              <div class="lr-lyric-timing" data-lyric-timing role="group" aria-label="歌词时间校准" hidden><button type="button" class="lr-lyrics-entry" data-lyric-adjust="-0.1">提前 0.1 秒</button><output data-lyric-offset aria-live="polite"></output><button type="button" class="lr-lyrics-entry" data-lyric-adjust="0.1">延后 0.1 秒</button></div>
              <button class="lr-lyrics-entry" data-action="lyrics">${icon('settings')}导入或调整歌词</button>
              <span class="lr-lyric-source" data-lyric-source-info role="status" hidden></span>
              <button type="button" class="lr-lyrics-entry" data-action="retry-lyrics" hidden>重新获取歌词</button>
            </div>
          </details>
        </div>
        </div>
        </div>
        </div>
      </section>
      <section class="lr-home-card" data-work-only aria-labelledby="lrHomeTrackName">
        <div class="lr-art-frame" aria-hidden="true">
          <div class="lr-art-placeholder" data-art-placeholder>${icon('music')}</div>
          <img class="lr-art-cover" data-art-cover alt="" decoding="async" hidden>
        </div>
        <div class="lr-home-copy">
          <div class="lr-track-labels"><p class="lr-track-state" data-track-state>正在载入</p><p class="lr-track-source" data-track-source hidden></p></div>
          <h1 class="lr-home-title" id="lrHomeTrackName" data-home-title>正在准备音乐</h1>
          <p class="lr-home-artist"><span data-home-artist></span> <a data-sample-license href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer" aria-label="示例歌曲授权 CC0 1.0（在浏览器中打开）" hidden>CC0 1.0</a></p>
          <button type="button" class="lr-continue" data-action="continue" data-home-resume aria-labelledby="lrHomeResumeLabel lrHomeResumeTitle" aria-describedby="lrHomeResumeMeta lrHomeResumeStatus" hidden>
            <span class="lr-resume-track">
              <span class="lr-resume-title" id="lrHomeResumeTitle" data-resume-title></span>
              <span class="lr-resume-meta" id="lrHomeResumeMeta"><span data-resume-source></span><span data-resume-position></span></span>
            </span>
            <span class="lr-resume-action">${icon('play')}<span id="lrHomeResumeLabel" data-resume-label>继续听</span></span>
          </button>
          <p class="lr-resume-status" id="lrHomeResumeStatus" data-resume-status role="status" hidden></p>
          <button type="button" class="lr-choice" data-action="queue-skip" data-resume-skip hidden>跳过这首</button>
          <button type="button" class="lr-now-from-work" data-home-now-playing data-action="now-playing">打开正在播放 ${icon('arrow')}</button>
          <div class="lr-demo-actions" data-demo-actions hidden>
            <button type="button" class="lr-primary" data-action="demo-play"><span class="lr-play-icon" data-demo-icon>${icon('play')}</span><span data-sample-label>试听示例</span></button>
            <button type="button" class="lr-choice lr-start-import" data-action="import" data-start-import>${icon('folder')}导入音乐</button>
            <button type="button" class="lr-choice lr-demo-lyrics" data-demo-lyrics data-action="expand-lyrics" aria-controls="lrLyricReading" aria-expanded="false" hidden>${icon('lyrics')}同步歌词</button>
          </div>
        </div>
        <div class="lr-signal">
          <div class="lr-signal-label">${icon('sound')}实时频谱</div>
          <canvas data-spectrum width="480" height="58" aria-hidden="true"></canvas>
        </div>
      </section>
      <section class="lr-work-recent lr-work-panel" data-work-recent hidden aria-labelledby="lrRecentHeading">
        <div class="lr-panel-heading"><h2 id="lrRecentHeading">最近播放</h2></div>
        <div class="lr-recent-list" data-recent-list></div>
      </section>
      <section class="lr-work-caption lr-work-panel" data-work-caption hidden aria-labelledby="workLyricHeading">
        <div class="lr-panel-heading"><h2 id="workLyricHeading">${icon('lyrics')}同步歌词</h2><button class="lr-panel-link" data-caption-action data-action="listen"><span>打开歌词</span>${icon('arrow')}</button></div>
        <p data-small-line></p>
        <p data-small-next hidden></p>
      </section>
      <aside class="lr-work-side" data-work-only aria-label="播放队列与设置">
        <section class="lr-queue-preview lr-work-panel" aria-labelledby="workQueueHeading">
          <div class="lr-panel-heading"><h2 id="workQueueHeading">${icon('queue')}播放队列</h2><button class="lr-panel-link" data-action="queue">查看全部 ${icon('arrow')}</button></div>
          <div class="lr-queue-context"><span data-queue-scope></span><button class="lr-queue-mode" data-action="repeat">${icon('repeat')}<span data-repeat-label>列表循环</span></button></div>
          <ol class="lr-preview-list" data-work-queue></ol>
          <p class="lr-queue-note" data-work-queue-note hidden></p>
          <button class="lr-panel-link lr-queue-add" data-action="library" hidden data-work-queue-add>从音乐库选歌 ${icon('arrow')}</button>
        </section>
        <nav class="lr-source-shelf lr-work-panel" aria-labelledby="workSourcesHeading">
          <div class="lr-panel-heading"><h2 id="workSourcesHeading">音乐来源</h2></div>
          <button class="lr-source" data-action="online" aria-label="打开汽水音乐库">${icon('music')}<span>汽水音乐</span>${icon('arrow')}</button>
          <button class="lr-source" data-action="import">${icon('folder')}<span>导入音乐</span>${icon('arrow')}</button>
          <button class="lr-source" data-action="external" aria-label="联动正在播放的声音">${icon('sound')}<span>外部声音联动</span><small data-source-status hidden>已连接</small>${icon('arrow')}</button>
        </nav>
        <section class="lr-ambience lr-work-panel" aria-labelledby="workAmbienceHeading">
          <div class="lr-panel-heading"><h2 id="workAmbienceHeading">背景氛围</h2><button class="lr-panel-link" data-action="scene-gallery" ${scenes?'':'hidden'}>动态场景 ${icon('arrow')}</button></div>
          <div class="lr-ambience-options"><button data-background="geometry"><span></span>几何微光</button><button data-background="mist"><span></span>流动光雾</button><button data-background="plain"><span></span>纯净底色</button></div>
        </section>
      </aside>
    </main>
    <div class="lr-player-wrap">
      <section class="lr-player" aria-label="音乐播放控制">
        <button type="button" class="lr-track-info" data-action="now-playing" aria-label="打开正在播放" aria-describedby="lrDockTrackName">
          <span class="lr-track-thumb" data-thumb-placeholder aria-hidden="true"></span>
          <img class="lr-track-thumb" data-thumb alt="" decoding="async" hidden>
          <span class="lr-track-copy"><span class="lr-track-name" id="lrDockTrackName" data-title>正在准备音乐</span><span class="lr-track-artist" data-artist></span></span>
        </button>
        <div class="lr-progress"><span data-position>00:00</span><input class="lr-range" data-seek type="range" min="0" max="96" step="0.1" value="0" aria-label="歌曲进度"><span data-duration>01:36</span></div>
        <div class="lr-transport-buttons">
          <button type="button" class="lr-icon" data-action="previous" aria-label="上一首">${icon('previous')}</button>
          <button type="button" class="lr-play" data-action="play" aria-label="播放音乐"><span class="lr-play-icon" data-play-icon>${icon('play')}</span></button>
          <button type="button" class="lr-icon" data-action="next" aria-label="下一首">${icon('next')}</button>
        </div>
        <div class="lr-player-right"><button type="button" class="lr-icon" data-action="favorite" aria-label="收藏歌曲" aria-pressed="false">${icon('heart')}</button><label class="lr-volume">${icon('volume')}<input class="lr-range" data-volume type="range" min="0" max="100" value="65" aria-label="音量"></label><button type="button" class="lr-icon" data-action="queue" aria-label="打开当前播放队列" aria-haspopup="dialog" title="播放队列">${icon('queue')}</button></div>
        <p class="lr-transport-status" data-transport-status role="status" hidden></p>
        <div class="lr-playback-recovery" data-playback-recovery hidden>
          <p id="lrPlaybackRecoveryStatus" data-playback-recovery-status role="status"></p>
          <div class="lr-recovery-actions">
            <button type="button" class="lr-choice" data-recovery-retry data-action="playback-retry" aria-describedby="lrPlaybackRecoveryStatus">重试当前歌曲</button>
            <button type="button" class="lr-choice" data-recovery-skip data-action="playback-skip" aria-describedby="lrPlaybackRecoveryStatus" hidden>跳过这首</button>
          </div>
        </div>
      </section>
    </div>
    <footer class="lr-footer"><div class="lr-footer-group"><button data-action="settings" data-background-label>几何微光</button><span data-eco-label>省电优先</span><button data-action="external" data-listen-link hidden>外部声音联动</button></div><div class="lr-footer-group"><button data-action="playback-settings">播放设置</button><button data-action="equalizer">均衡器</button><button data-action="desktop-lyrics-window" data-desktop-only aria-pressed="false" hidden>桌面歌词</button><button data-action="mini" data-desktop-only hidden>迷你播放器</button><button data-action="desktop" data-desktop-only hidden>桌面设置</button><button data-action="legacy">星空与创作 ↗</button></div></footer>
    <dialog class="lr-dialog" data-playback-dialog aria-labelledby="playbackSettingsTitle">
      <div class="lr-dialog-heading"><h2 id="playbackSettingsTitle">播放设置</h2><button class="lr-icon" data-close aria-label="关闭播放设置">${icon('close')}</button></div>
      <label class="lr-field"><span class="lr-field-title">输出设备</span><select class="lr-search-input" data-output-device><option value="">系统默认</option></select></label>
      <label class="lr-field"><span class="lr-field-title">播放速度</span><select class="lr-search-input" data-playback-rate><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
      <label class="lr-field"><span class="lr-field-title">定时停止</span><select class="lr-search-input" data-sleep-timer><option value="0">关闭</option><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="45">45 分钟</option><option value="60">60 分钟</option><option value="90">90 分钟</option><option value="120">120 分钟</option></select></label>
      <p class="lr-status" role="status" data-playback-status></p>
    </dialog>
    <dialog class="lr-dialog lr-effect-dialog" data-effect-dialog aria-labelledby="lyricEffectsHeading">
      <div class="lr-dialog-heading"><h2 id="lyricEffectsHeading">歌词动效</h2><button class="lr-icon" data-close aria-label="关闭歌词动效">${icon('close')}</button></div>
      ${effects.groups.map(({name,entries})=>`<section><h3>${name}</h3><div class="lr-effect-grid">${entries.map(preset=>`
        <button type="button" class="lr-effect-card" data-effect-choice="${preset.id}" aria-pressed="false" aria-label="${preset.label}" title="${preset.description}">
          <span class="lr-effect-sample" data-fx="${preset.id}" aria-hidden="true">${effectShapes}<strong>听见光</strong></span><span>${preset.label}</span>
        </button>`).join('')}</div></section>`).join('')}
    </dialog>
    <dialog class="lr-dialog lr-scene-dialog" data-scene-dialog aria-labelledby="sceneGalleryHeading">
      <div class="lr-dialog-heading"><div><h2 id="sceneGalleryHeading">动态场景</h2><p data-scene-selection></p></div><button class="lr-icon" data-close aria-label="关闭动态场景">${icon('close')}</button></div>
      <div class="lr-scene-controls">
        <div class="lr-scene-filters" aria-label="场景分类" role="group"><button class="lr-choice" data-scene-filter="all">全部</button><button class="lr-choice" data-scene-filter="山水">山水</button><button class="lr-choice" data-scene-filter="氛围">氛围</button><button class="lr-choice" data-scene-filter="赛博">赛博</button><button class="lr-choice" data-scene-filter="图形">图形</button></div>
        <button class="lr-choice lr-scene-auto" data-scene-select="auto">${icon('sound')}自动随曲</button>
      </div>
      <div class="lr-scene-grid" data-scene-grid></div>
      <div class="lr-scene-preferences"><label class="lr-check"><input type="checkbox" data-scene-backdrop>用于陪伴和歌词背景</label><button class="lr-choice" data-action="scene-pin" aria-pressed="false">记住这首歌的场景</button><label>节拍校正 <select class="lr-choice" data-beat-ratio><option value="1">自动</option><option value="0.5">半速</option><option value="2">倍速</option></select></label></div>
    </dialog>
    <dialog class="lr-dialog" data-settings aria-labelledby="roomSettingsHeading"><div class="lr-dialog-heading"><div><h2 id="roomSettingsHeading">让氛围，刚刚好。</h2><p>选一份舒服的背景，之后交给音乐。</p></div><button class="lr-icon" data-close aria-label="关闭氛围设置">${icon('close')}</button></div><div class="lr-field"><div class="lr-field-title">背景</div><div class="lr-choice-row"><button class="lr-choice" data-background="geometry">几何微光</button><button class="lr-choice" data-background="mist">流动光雾</button><button class="lr-choice" data-background="plain">纯净底色</button></div></div><div class="lr-field"><div class="lr-field-title">配色</div><div class="lr-choice-row"><button class="lr-choice" data-color="amber"><i class="lr-swatch" style="--swatch:#e5c483"></i>暖金</button><button class="lr-choice" data-color="ocean"><i class="lr-swatch" style="--swatch:#95bcd1"></i>雾蓝</button><button class="lr-choice" data-color="lilac"><i class="lr-swatch" style="--swatch:#b8a9db"></i>浅紫</button><button class="lr-choice" data-color="cover">跟随封面</button></div></div><label class="lr-field"><span class="lr-field-title">背景亮度 <output data-brightness-value></output></span><input class="lr-range" data-brightness type="range" min="10" max="100" step="5" aria-label="背景亮度"></label><label class="lr-field"><span class="lr-field-title">声音响应 <output data-response-value></output></span><input class="lr-range" data-response type="range" min="0" max="100" step="5" aria-label="声音响应强度"></label><label class="lr-check"><input type="checkbox" data-desktop-lyrics>工作时显示小歌词</label><label class="lr-check"><input type="checkbox" data-energy>省电优先</label><p class="lr-dialog-note" data-save-note role="status">设置自动保存在这台设备。</p></dialog>
    <dialog class="lr-dialog" data-queue-dialog aria-labelledby="roomQueueHeading" aria-describedby="roomQueueSource">
      <div class="lr-dialog-heading">
        <div class="lr-queue-heading-copy">
          <h2 id="roomQueueHeading">播放队列</h2>
          <p class="lr-queue-source" id="roomQueueSource"><span>来源</span><strong data-queue-source-label></strong></p>
          <p data-queue-count></p>
        </div>
        <button class="lr-icon" data-close aria-label="关闭播放队列">${icon('close')}</button>
      </div>
      <dl class="lr-queue-summary" data-queue-summary aria-label="播放顺序" hidden>
        <div><dt data-queue-current-label>当前曲目</dt><dd data-queue-current-title></dd><dd class="lr-queue-track-artist" data-queue-current-artist hidden></dd></div>
        <div><dt id="roomQueueNextLabel">下一首</dt><dd data-queue-next-title></dd><dd class="lr-queue-track-artist" data-queue-next-artist hidden></dd></div>
      </dl>
      <div class="lr-queue-recovery" data-queue-recovery hidden>
        <p id="lrQueueRecoveryStatus" data-queue-recovery-status role="status"></p>
        <div class="lr-recovery-actions">
          <button type="button" class="lr-choice" data-recovery-retry data-action="queue-retry" aria-describedby="lrQueueRecoveryStatus">重试当前歌曲</button>
          <button type="button" class="lr-choice" data-recovery-skip data-action="queue-skip" aria-describedby="lrQueueRecoveryStatus" hidden>跳过这首</button>
        </div>
      </div>
      <input class="lr-search-input" data-queue-search type="search" placeholder="搜索队列" aria-label="搜索当前队列">
      <ol class="lr-queue" data-queue-list></ol>
      <div class="lr-queue-pages" data-queue-pages hidden><button class="lr-choice" data-queue-page="-1">上一页</button><span data-queue-page-label></span><button class="lr-choice" data-queue-page="1">下一页</button></div>
      <div class="lr-choice-row"><button class="lr-choice" data-action="import">导入音乐</button><button class="lr-choice" data-action="folder">导入文件夹</button><button class="lr-choice" data-action="library">从曲库选歌</button><button class="lr-choice" data-action="repeat" data-repeat-label>列表循环</button></div>
    </dialog>
    <dialog class="lr-dialog" data-external-dialog aria-labelledby="roomExternalHeading">
      <div class="lr-dialog-heading"><div><h2 id="roomExternalHeading">外部声音联动</h2><p>在汽水音乐等播放器里选歌，画面跟随正在播放的声音。</p></div><button class="lr-icon" data-close aria-label="关闭声音联动">${icon('close')}</button></div>
      <p class="lr-dialog-note">桌面版联动电脑的系统声音，浏览器版使用所选的共享音频。音频仅在本机分析。</p>
      <p class="lr-status" data-external-status role="status">还未连接外部声音。</p>
      <div class="lr-source-actions"><button class="lr-primary" data-connect>连接声音</button><button class="lr-choice" data-disconnect hidden>停止联动</button></div>
      <label class="lr-field" data-external-session hidden><span class="lr-field-title">Windows 曲目信息来源</span><select class="lr-search-input" data-external-source><option value="">跟随 Windows 当前播放器</option></select><span class="lr-dialog-note" data-external-metadata-status></span></label>
      <div data-external-lyrics hidden>
        <div class="lr-source-actions"><button class="lr-choice" type="button" data-external-find-lyrics>从 LRCLIB 匹配歌词</button><label class="lr-choice lr-detail-file">导入外部歌词<input type="file" data-external-lyrics-file accept=".lrc,.yrc,.krc,.qrc,.ttml,.vtt,text/plain" aria-label="导入外部歌词文件"></label></div>
        <p class="lr-dialog-note">点击在线匹配会向 LRCLIB 查询当前曲目的歌名、歌手和时长。</p>
        <p class="lr-status" data-external-lyrics-status role="status"></p>
      </div>
      <p class="lr-dialog-note">切歌、进度和音量由原播放器控制。</p>
    </dialog>
    <dialog class="lr-dialog" data-desktop-dialog aria-labelledby="roomDesktopHeading"><div class="lr-dialog-heading"><div><h2 id="roomDesktopHeading">把音乐，留在桌面。</h2><p>工作时安静陪伴，需要时再展开。</p></div><button class="lr-icon" data-close aria-label="关闭桌面设置">${icon('close')}</button></div><div class="lr-source-actions"><button class="lr-choice" data-action="mini">${icon('mini')}迷你播放器</button></div><label class="lr-check"><input type="checkbox" data-startup>开机时启动声波宇宙</label><p class="lr-dialog-note">动态桌面已暂停。</p></dialog>
    <div class="lr-toasts" data-toast role="status" hidden></div>
  `;
  document.body.prepend(root);
  const back = document.createElement('button'); back.id = 'roomReturn'; back.textContent = '回到听歌空间 ↗'; back.hidden = true; document.body.append(back);
  const $ = selector => root.querySelector(selector), $$ = selector => root.querySelectorAll(selector);
  const playerDock=$('.lr-player-wrap');
  const listenView=$('[data-listen]'), listenCover=$('.lr-now-cover'), exitImmersion=$('[data-action="exit-immersion"]');
  function reserveDockSpace() {
    const bounds=playerDock.getBoundingClientRect();
    if(!bounds.height)return;
    const clearance=Math.ceil(bounds.height+Math.max(0,window.innerHeight-bounds.bottom)+10)+'px';
    if(root.style.getPropertyValue('--lr-player-clearance')!==clearance)root.style.setProperty('--lr-player-clearance',clearance);
  }
  const dockResize=new ResizeObserver(reserveDockSpace);
  dockResize.observe(playerDock);
  const musicLibrary=window.SonicMusicLibrary.mount($('[data-music-library]'),{api,icon,formatTime:core.formatTime});
  const isLibraryMode=mode=>mode==='library'||mode==='search';
  const canvas = $('.lr-background'), context = canvas.getContext('2d', { alpha: false });
  const spectrum=$('[data-spectrum]'), spectrumContext=spectrum.getContext('2d'), spectrumBands=new Float32Array(48);
  const beatClock=$('[data-action="beat-clock"]'), beatStatus=$('[data-beat-status]'), beatSteps=beatClock.querySelectorAll('i');
  let beatClockIndex=-1, beatClockPulse=0;
  const desktop = window.sonicDesktop;
  if(desktop)preferences.mode='work';
  const fullscreenButton=$('[data-action="fullscreen"]');
  function updateFullscreen(enabled){
    const label=enabled?'退出全屏':'全屏欣赏';
    root.dataset.fullscreen=String(enabled);
    fullscreenButton.setAttribute('aria-pressed',String(enabled));
    fullscreenButton.setAttribute('aria-label',label);
    fullscreenButton.title=label;
  }
  updateFullscreen(false);
  desktop?.onFullscreen?.(updateFullscreen);
  document.addEventListener('fullscreenchange',()=>{
    if(!desktop?.fullscreen)updateFullscreen(document.fullscreenElement===root);
  });
  async function toggleFullscreen(){
    try{
      if(desktop?.fullscreen){
        if(!await desktop.fullscreen(root.dataset.fullscreen!=='true'))throw Error('Fullscreen was rejected');
      }else if(document.fullscreenElement)await document.exitFullscreen();
      else await root.requestFullscreen();
    }catch{notify('当前窗口无法进入全屏，可以使用窗口最大化。');}
  }
  const karaoke = window.SonicLyricKaraoke;
  let lyricExpanded=false,readingFullLyrics=false,searchScroll=0;
  let listenImmersive=false, immersionEntry=null, immersionScroll=0, immersionTimer=0, immersionKeyboard=false;
  const decorateLyrics=desktop?window.SonicLyricStyleMods.createDecoration($('[data-mod-decoration]')):null;
  const lyricMods=desktop?window.SonicLyricStyleMods.mount(root,mod=>{
    if(mod){readingFullLyrics=false;preferences.lyricStyle=mod.layout;}
    applyPreferences(true);
  }):null;
  const nowPlaying=window.SonicNowPlaying.mount(root,seekLyrics);
  let snapshot = api.snapshot(), legacy = false, occluded = false;
  let timer = 0, lyricFrameId=0, lastFrame = 0, lastPaint=0, lastUI = 0, renderedFrames = 0;
  let coverMotion, lyricViewMotion;
  let backgroundDirty=true, lastPublishedState=[];
  const colors = { amber:[229,196,131], ocean:[149,188,209], lilac:[196,176,249] };
  const artworkTransitionMs=260;
  const nowStars=Array.from({length:72},(_,index)=>({
    x:(.13+index*.61803399)%1,
    y:(.29+index*.75487767)%1,
    radius:index%11===0?1.6:index%4===0?1.1:.65,
  }));
  const demoCover = new URL('./assets/interstellar-drift-cover.webp',document.baseURI).href;
  let palette = [...(colors[preferences.color]||colors.lilac)], coverPalette = colors.lilac, coverRequest = 0, canvasWidth = 0, canvasHeight = 0, scale = 1;
  let coverTransition=null, coverReveal=1;
  let phase = 0, energy = 0, bass = 0, flow = 0, seekPreview = null, seekPointer = null, volumeChanging = false, toastTimer = 0;
  let artworkSource = '', lastTitle = '', displayedPlaying = null, lastRgb = '', artworkRgb = '', coverScale=1;
  let recentTracks=[],recentShelfDirty=true;
  let lastQueueRefresh=0,workQueueKey=[],lastSpectrumKey='';
  const emptyLyrics=[], lyricRows=new Map(), lyricTimeline=$('[data-lyric-timeline]');
  const effectStage=$('[data-effect-stage]'),effectDialog=$('[data-effect-dialog]'),effectButton=$('[data-action="lyric-effects"]');
  let preparedLyric=null,lyricGeometry='',nextLyricPrepareAttempt=0,lyricSurfaceDirty=false;
  const effectSurface=$('[data-effect-surface]'),effectRenderer=window.SonicLyricRenderer?.create(effectSurface,()=>{
    invalidateLyricSurface();wake();
  });
  const effectStageStyle={};
  const effectStageMotion={
    neon:['phase'],film:['enter'],orbit:['direction'],
    ink:['enter'],mist:['phase'],sunrise:['phase'],petal:['phase'],prism:['direction'],paper:['enter','direction'],
    clock:['phase','direction'],wide:['enter'],
  };
  let effectBeat=0, nextEffectFrame=0, nextSceneryFrame=0, sceneryAnimated=false;
  let tideTrack=null,tideDepth=0;
  const lyricNotice=$('[data-lyric-notice]'),lyricNoticeText=$('[data-lyric-meta]'),lyricEditor=$('[data-listen] [data-action="lyrics"]');
  const seekSlider=$('[data-seek]'), volumeSlider=$('[data-volume]');
  function canSeek(state) {
    return Boolean(state.ready&&!state.external&&!state.busy&&!state.playbackRecovery&&!state.resumePending&&state.track&&state.duration>0);
  }
  function seekTarget(state) {
    return canSeek(state)?{track:state.track.id,entry:state.queueEntryId,duration:state.duration}:null;
  }
  function samePlayback(a,b) {
    return a.track?.id===b.track?.id&&a.queueEntryId===b.queueEntryId&&a.external===b.external;
  }
  function matchesSeek(target,state) {
    return Boolean(target&&canSeek(state)&&target.track===state.track.id&&target.entry===state.queueEntryId&&target.duration===state.duration);
  }
  function seekLyrics(time) {
    const state=api.snapshot();
    if(!matchesSeek(seekTarget(snapshot),state))return;
    api.seek(time+state.position-state.lyricPosition);
    updateUI(false,true);
  }
  function cancelSeek() {
    if(seekPointer)seekPointer.target=null;
    if(!seekPreview)return;
    seekPreview=null;
    updateUI(false,true);
  }
  function previewSeek(target,state) {
    const position=Number(seekSlider.value), time=core.formatTime(position);
    seekPreview={...target,position};
    $('[data-position]').textContent=time;
    seekSlider.setAttribute('aria-valuetext',time);
    fill(seekSlider);
    nowPlaying.showSeek(state,position);
    if(root.dataset.mode==='work')renderLyrics(position+state.lyricPosition-state.position,true);
    revealListeningControls();
  }
  function commitSeek(target) {
    if(matchesSeek(target,api.snapshot())){
      nowPlaying.followAfterSeek();
      api.seek(target.position);
    }
    updateUI(false,true);
    revealListeningControls();
    wake();
  }
  function stepSeek(seconds) {
    if(seekPointer)return;
    const state=api.snapshot(),target=seekTarget(state);
    if(target)commitSeek({...target,position:Math.max(0,Math.min(state.duration,state.position+seconds))});
  }
  const queueDialog = $('[data-queue-dialog]'), queueList = $('[data-queue-list]'), queueSearch = $('[data-queue-search]');
  const queuePageSize = 60;
  let queueItems = [], queuePage = 0, queueDialogKey = [], draggedEntry = null, dropTarget = null, queueOpener = null;
  let renderedLyrics=emptyLyrics, lyricTrack, lyricIndex=-2, lastLyricPosition=0;
  let renderedLyricStyle, flyFrom=-Infinity, flyLineTransition=null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const backgroundNames = { geometry:'几何微光', mist:'流动光雾', plain:'纯净底色', universe:'星空' };
  const sceneDialog=$('[data-scene-dialog]'), sceneGrid=$('[data-scene-grid]');
  let jiangnanFrame=null;
  const sceneDirector=scenes?.createDirector(), directJiangnan=scenes?.createJiangnanDirector(), sceneBands=new Float32Array(48), previewBands=new Float32Array(48);
  let sceneFilter='all', sceneId, visualTrack, visualTime=0, visualEnergy=0, fadeTime=0, fadeCanvas, sceneCardsReady=false;
  let stageChromeTimer=0, stageBreathe='';
  const scenePins=new Map();
  if(scenes) {
    preferences.visualScene=scenes.normalizeSelection(preferences.visualScene);
    try {
      const saved=JSON.parse(localStorage.getItem(storageKey+'-scenes'));
      if(Array.isArray(saved))for(const [track,id] of saved.filter(entry=>Array.isArray(entry)&&typeof entry[0]==='string'&&entry[0].length<=256&&scenes.get(entry[1])).slice(-100))scenePins.set(track,id);
    }catch{}
  } else if(preferences.mode==='visual') preferences.mode='work';
  const playbackNames = { sequence:'顺序播放', list:'列表循环', single:'单曲循环', shuffle:'随机播放' };
  const idleFields=['ready','busy','playing','demoOnly','importing','buffering','playbackInterrupted','external','externalPending','externalSignal','volume','duration','position','lyricPosition','lyricDuration','playbackMode'];
  const trackFields=['id','name','artist','kind','cover','favorite'];
  const toast = $('[data-toast]');
  function notify(message, error = false) {
    clearTimeout(toastTimer);
    (document.querySelector('dialog[open]') || root).append(toast);
    toast.setAttribute('role',error?'alert':'status');
    toast.textContent=message;
    toast.hidden=false;
    toastTimer=setTimeout(()=>{toast.hidden=true;},4400);
  }
  function persist() { try { localStorage.setItem(storageKey,JSON.stringify(preferences)); $('[data-save-note]').textContent='已保存到这台设备。'; } catch { $('[data-save-note]').textContent='这次设置已应用，但设备存储不可用，关闭后可能丢失。'; } }
  function fill(input) { input.style.setProperty('--lr-fill',((Number(input.value)-Number(input.min||0))/(Number(input.max)-Number(input.min||0))*100)+'%'); }
  function show(dialog) { if(!dialog.open)dialog.showModal(); }
  function closeDialogs() { root.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close()); }
  function invalidateLyricSurface() {
    clearPreparedLyric();
    effectRenderer?.invalidate();
    lyricSurfaceDirty=true;
  }
  function resize() {
    const lyricWindow=$('[data-stage-lyrics]');
    const geometry=[lyricWindow.clientWidth,lyricWindow.clientHeight,innerWidth,innerHeight,devicePixelRatio,
      root.dataset.lyricStyle,root.dataset.lyricEffect,root.dataset.lyricMod].join('/');
    if(lyricGeometry!==geometry){
      lyricGeometry=geometry;
      invalidateLyricSurface();
    }
    const bounds=root.getBoundingClientRect();canvasWidth=Math.max(1,bounds.width);canvasHeight=Math.max(1,bounds.height);
    // The soft-focus lyric scene can be drawn below screen resolution.
    const pixelLimit=root.dataset.mode==='listen'?(preferences.energySaver?.62:.85):(preferences.energySaver?1.25:1.75);
    scale=Math.min(devicePixelRatio||1,pixelLimit);
    const width=Math.round(canvasWidth*scale),height=Math.round(canvasHeight*scale);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;fadeTime=0;}
    context?.setTransform(scale,0,0,scale,0,0);
  }
  function animateLyricView(view, previousCover) {
    // Measure again after the caller restores focus and document scroll.
    queueMicrotask(()=>{
      if(root.dataset.nowView!==view||reducedMotion.matches)return;
      const cover=listenCover.getBoundingClientRect();
      if(cover.width){
        const x=previousCover.x+(previousCover.width-cover.width)/2-cover.x;
        const y=previousCover.y+(previousCover.height-cover.height)/2-cover.y;
        coverMotion=listenCover.animate([
          {translate:`${x}px ${y}px`,scale:String(previousCover.width/cover.width)},
          {translate:'0px 0px',scale:'1'},
        ],{duration:280,easing:'cubic-bezier(.22,.74,.25,1)'});
      }
      const lyrics=$(view==='full'?'[data-expanded-lyrics]':'[data-lyric-preview]');
      if(lyrics.getClientRects().length)lyricViewMotion=lyrics.animate([
        {opacity:.55,translate:'0 8px'}, {opacity:1,translate:'0 0'},
      ],{duration:220,easing:'ease-out'});
    });
  }
  function applyPreferences(save=false) {
    const mode=preferences.mode;
    if(mode!=='listen'&&listenImmersive)resetListeningImmersion();
    const expanded=mode==='listen'&&lyricExpanded&&!listenImmersive;
    const style=readingFullLyrics?'list':preferences.lyricStyle,full=expanded&&style==='list',effectActive=expanded&&style==='effects';
    const view=mode!=='listen'?'hidden':listenImmersive?'immersive':full?'full':expanded?'stage':'preview';
    const previousView=root.dataset.nowView;
    const movingBetweenLyrics=view!==previousView&&!['hidden','stage',undefined].includes(previousView)&&
      view!=='hidden'&&view!=='stage'&&!reducedMotion.matches&&onScreen();
    const previousCover=movingBetweenLyrics?listenCover.getBoundingClientRect():null;
    if(view!==previousView){coverMotion?.cancel();lyricViewMotion?.cancel();}
    root.dataset.nowView=view;
    nowPlaying.setView(view);
    root.dataset.mode=mode;root.dataset.background=preferences.background;root.dataset.lyricStyle=expanded?style:'compact';
    root.dataset.listenImmersive=String(listenImmersive);
    listenView.setAttribute('aria-label',listenImmersive?'沉浸播放':'正在播放');
    listenCover.inert=listenImmersive;
    exitImmersion.hidden=!listenImmersive;
    root.dataset.immersive=String(mode==='visual'||expanded&&(style==='fly'||effectActive));
    const preset=effects.get(preferences.lyricEffect);
    effectStage.hidden=!effectActive;
    effectStage.dataset.fx=preset.id;
    const theme=effectActive&&preset.palette;
    root.toggleAttribute('data-lyric-theme',Boolean(theme));
    if(theme){
      root.style.setProperty('--fx-lyric-waiting',theme.waiting);
      root.style.setProperty('--fx-lyric-sung',theme.sung);
    } else {
      root.style.removeProperty('--fx-lyric-waiting');
      root.style.removeProperty('--fx-lyric-sung');
    }
    if(effectActive)root.dataset.lyricEffect=preset.id;
    else {
      delete root.dataset.lyricEffect;
      delete root.dataset.lyricRenderer;
      clearPreparedLyric();
      effectRenderer?.hide();
    }
    effectButton.textContent=effectActive?`动效 · ${preset.label}`:'动效';
    effectButton.setAttribute('aria-pressed',String(effectActive));
    $$('[data-effect-choice]').forEach(button=>button.setAttribute('aria-pressed',String(effectActive&&button.dataset.effectChoice===preset.id)));
    revealStageChrome();
    root.dataset.lyricLayout=expanded?(full?'list':'stage'):'compact';
    root.dataset.lyricExpanded=String(expanded);
    root.dataset.dockLayout=isLibraryMode(mode)||mode==='listen'&&(!expanded||full)?'full-progress':'default';
    $('[data-action="collapse-lyrics"]').textContent=full?'收起全文':'返回正在播放';
    const selectedMod=expanded&&!readingFullLyrics?lyricMods?.current():null;
    decorateLyrics?.(selectedMod,!preferences.energySaver);
    if(selectedMod) {
      root.dataset.lyricMod=selectedMod.id;root.dataset.modAlign=selectedMod.alignment;root.dataset.modMotion=selectedMod.motion;
      root.style.setProperty('--lr-mod-accent',selectedMod.accent);root.style.setProperty('--lr-mod-scale',selectedMod.fontScale);
    } else {delete root.dataset.lyricMod;delete root.dataset.modAlign;delete root.dataset.modMotion;}
    $('[data-expanded-lyrics]').hidden=!expanded;
    $('[data-stage-lyrics]').hidden=!expanded||full;
    $('[data-stage-full-lyrics]').hidden=!expanded||full;
    $$('[data-action="expand-lyrics"], [data-now-lyrics]').forEach(button=>button.setAttribute('aria-expanded',String(expanded)));
    $$('[data-work-only]').forEach(element=>element.hidden=mode!=='work');
    listenView.hidden=mode!=='listen';$('[data-listen-link]').hidden=mode!=='listen';
    $('[data-visual-view]').hidden=mode!=='visual';
    beatClock.hidden=mode!=='visual';
    beatClock.setAttribute('aria-pressed',String(preferences.beatClock));
    $('[data-beat-ratio]').value=preferences.beatRatio;
    musicLibrary.setVisible(isLibraryMode(mode),mode==='search');
    $('[data-work-caption]').hidden=mode!=='work'||!preferences.desktopLyrics;
    root.dataset.caption=String(preferences.desktopLyrics);
    $$('[data-room-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.roomMode===preferences.mode)));
    $('[data-action="search"]').setAttribute('aria-pressed',String(mode==='search'));
    $$('button[data-lyric-style]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.lyricStyle===style)));
    $$('[data-background]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.background===preferences.background)));
    $$('[data-color]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.color===preferences.color)));
    for(const key of ['brightness','response']){ $('[data-'+key+']').value=preferences[key];$('[data-'+key+'-value]').textContent=preferences[key]+'%';fill($('[data-'+key+']')); }
    $('[data-desktop-lyrics]').checked=preferences.desktopLyrics;$('[data-energy]').checked=preferences.energySaver;
    $('[data-scene-backdrop]').checked=preferences.reactiveBackdrop;
    $('[data-background-label]').textContent=backgroundNames[preferences.background];$('[data-eco-label]').textContent=preferences.energySaver?'省电优先':'细腻呈现';
    if(scenes)syncSceneLabels();
    if(save)persist();resize();schedule();updateUI(true);
    if(previousCover?.width)animateLyricView(view,previousCover);
  }
  function setMode(mode) {
    if(!['work','listen','library','search','visual'].includes(mode)||(mode==='visual'&&!scenes))return;
    const previous=preferences.mode;
    if(previous==='search'&&mode!==previous)searchScroll=window.scrollY;
    preferences.mode=mode;applyPreferences(true);
    if(mode!==previous)window.scrollTo({top:mode==='search'?searchScroll:0,behavior:'instant'});
  }
  function setLyricExpanded(expanded, full=false) {
    const previousFullEntry=readingFullLyrics;
    readingFullLyrics=expanded&&full;
    lyricExpanded=expanded;
    setMode('listen');
    window.scrollTo({top:0,behavior:'instant'});
    const focus=expanded?(root.dataset.lyricLayout==='list'?'[data-full-lyrics]':'[data-action="collapse-lyrics"]'):
      previousFullEntry?'[data-now-lyrics]':'.lr-now-cover';
    $(focus).focus({preventScroll:true});
  }
  function resetListeningImmersion() {
    listenImmersive=false;
    immersionEntry=null;
    immersionKeyboard=false;
    clearTimeout(immersionTimer);
    delete root.dataset.listenControls;
  }
  function setListeningImmersion(enabled, entry) {
    if(enabled===listenImmersive||preferences.mode!=='listen')return;
    if(enabled){
      if(root.dataset.lyricLayout==='stage')return;
      listenImmersive=true;
      immersionEntry=entry;
      immersionScroll=window.scrollY;
      immersionKeyboard=entry?.matches(':focus-visible')??false;
      root.dataset.listenControls='visible';
      applyPreferences();
      window.scrollTo({top:0,behavior:'instant'});
      listenView.focus({preventScroll:true});
      revealListeningControls();
      return;
    }
    const returnFocus=immersionEntry;
    const returnScroll=immersionScroll;
    cancelSeek();
    resetListeningImmersion();
    applyPreferences();
    window.scrollTo({top:returnScroll,behavior:'instant'});
    returnFocus?.focus({preventScroll:true});
  }
  function keepListeningControlsVisible() {
    const focused=document.activeElement;
    return !lyricsPlaying()||snapshot.queueTarget||snapshot.buffering||snapshot.playbackRecovery||seekPointer||seekPreview||volumeChanging||
      playerDock.matches(':hover')||exitImmersion.matches(':hover')||
      (immersionKeyboard&&focused!==listenView&&root.contains(focused))||document.querySelector('dialog[open]');
  }
  function revealListeningControls() {
    if(!listenImmersive)return;
    clearTimeout(immersionTimer);
    if(root.dataset.listenControls!=='visible')root.dataset.listenControls='visible';
    if(!keepListeningControlsVisible()){
      immersionTimer=setTimeout(()=>{
        if(listenImmersive&&!keepListeningControlsVisible())root.dataset.listenControls='hidden';
      },3000);
    }
  }
  function revealStageChrome() {
    clearTimeout(stageChromeTimer);
    if(root.dataset.immersive!=='true')return;
    root.dataset.stageChrome='true';
    if(snapshot.playing&&!reducedMotion.matches)stageChromeTimer=setTimeout(()=>{root.dataset.stageChrome='false';},3800);
  }
  function usesReactiveScene() {
    const mode=root.dataset.mode;
    return scenes&&!listenImmersive&&!isLibraryMode(mode)&&
      (mode==='visual'||sceneDialog.open||preferences.reactiveBackdrop&&!root.hasAttribute('data-lyric-theme'));
  }
  function usesImmersivePrism() {
    return scenes&&listenImmersive&&preferences.background!=='plain';
  }
  function showsLyricEffects() {
    return root.dataset.mode==='listen'&&root.dataset.lyricStyle==='effects';
  }
  function selectedScene() { return scenePins.get(snapshot.track?.id)||preferences.visualScene; }
  function syncSceneLabels() {
    const track=snapshot.track?.id, pinned=scenePins.has(track), selection=selectedScene();
    const scene=scenes.get(sceneId), title=scene?.name||'动态场景';
    const mode=pinned?'此曲专属场景':selection==='auto'?'自动随曲':'固定场景';
    if($('[data-visual-title]').textContent!==title)$('[data-visual-title]').textContent=title;
    if($('[data-visual-mode]').textContent!==mode)$('[data-visual-mode]').textContent=mode;
    if(preferences.reactiveBackdrop||root.dataset.mode==='visual')$('[data-background-label]').textContent=title;
    if(!sceneDialog.open)return;
    const selectionLabel=mode+' · '+title;
    if($('[data-scene-selection]').textContent!==selectionLabel)$('[data-scene-selection]').textContent=selectionLabel;
    for(const button of sceneDialog.querySelectorAll('[data-scene-select]'))button.setAttribute('aria-pressed',String(button.dataset.sceneSelect===selection));
    const pin=$('[data-action="scene-pin"]');
    pin.disabled=!track||snapshot.external||!scene;
    pin.setAttribute('aria-pressed',String(pinned));
    pin.textContent=pinned?'取消此曲的场景记忆':'记住这首歌的场景';
  }
  function saveScenePins() {
    while(scenePins.size>100)scenePins.delete(scenePins.keys().next().value);
    try { localStorage.setItem(storageKey+'-scenes',JSON.stringify(Array.from(scenePins))); }
    catch { notify('场景已应用，本机暂时无法保存场景记忆。',true); }
  }
  function toggleScenePin() {
    const track=snapshot.track?.id;
    if(!track||snapshot.external||!scenes.get(sceneId))return;
    if(scenePins.has(track))scenePins.delete(track);
    else {
      scenePins.set(track,sceneId);
      preferences.visualScene='auto';persist();
    }
    saveScenePins();syncSceneLabels();backgroundDirty=true;wake();
  }
  function selectScene(id) {
    if(id!=='auto'&&!scenes.get(id))return;
    const track=snapshot.track?.id;
    if(scenePins.has(track)) {
      if(id==='auto'){scenePins.delete(track);preferences.visualScene='auto';}
      else scenePins.set(track,id);
      saveScenePins();
    }else preferences.visualScene=id;
    persist();syncSceneLabels();backgroundDirty=true;wake();
  }
  function mountSceneCards() {
    if(sceneCardsReady)return;
    sceneCardsReady=true;
    for(let i=0;i<previewBands.length;i++)previewBands[i]=.13+.16*Math.sin(i*.3)**2;
    for(const scene of scenes.catalogue) {
      const button=document.createElement('button'),preview=document.createElement('canvas'),caption=document.createElement('span');
      button.type='button';button.className='lr-scene-card';button.dataset.sceneSelect=scene.id;button.dataset.sceneGroup=scene.group;
      button.title=scene.description;preview.width=264;preview.height=126;preview.setAttribute('aria-hidden','true');
      caption.textContent=scene.name;button.append(preview,caption);sceneGrid.append(button);
      const previewContext=preview.getContext('2d');
      if(previewContext)scenes.draw(previewContext,scene.id,{width:preview.width,height:preview.height,time:3,bass:.22,mid:.3,high:.21,pulse:.14,energy:.26,spectrum:previewBands,quality:.59,seed:scenes.seedFor(scene.id)});
    }
  }
  function filterScenes(category) {
    sceneFilter=category;
    for(const button of sceneDialog.querySelectorAll('[data-scene-filter]'))button.setAttribute('aria-pressed',String(button.dataset.sceneFilter===category));
    for(const button of sceneGrid.children)button.hidden=category!=='all'&&button.dataset.sceneGroup!==category;
  }
  function openSceneGallery() {
    mountSceneCards();filterScenes(sceneFilter);show(sceneDialog);syncSceneLabels();backgroundDirty=true;wake();
  }
  function paintReactive(seconds,sound,animated,response,brightness,focused=false) {
    const track=snapshot.track?.id||'';
    if(track!==visualTrack){visualTrack=track;visualTime=visualEnergy=0;jiangnanFrame=null;}
    if(animated)visualTime+=seconds;
    const next=focused?'prism-bloom':sceneDirector.update({track,selected:selectedScene(),active:animated&&response>0,elapsed:seconds,sound,position:snapshot.position});
    if(!focused&&next!==sceneId) {
      if(sceneId&&animated) {
        fadeCanvas ||= document.createElement('canvas');
        if(fadeCanvas.width!==canvas.width||fadeCanvas.height!==canvas.height){fadeCanvas.width=canvas.width;fadeCanvas.height=canvas.height;}
        fadeCanvas.getContext('2d').drawImage(canvas,0,0);
        fadeTime=.64;
      }
      sceneId=next;syncSceneLabels();
    }
    if(root.dataset.activeScene!==next)root.dataset.activeScene=next;
    if(animated&&response>0)api.readSpectrum(sceneBands);
    else sceneBands.fill(0);
    const strength=animated?Math.min(1,response*1.7):0, level=value=>core.clamp((value||0)*strength,0,1);
    const seed=scenes.seedFor(track);
    if(animated)visualEnergy=core.approach(visualEnergy,level(sound?.presence)*.62+level(sound?.bass)*.38,seconds,1.4);
    if(strength!==1)for(let i=0;i<sceneBands.length;i++)sceneBands[i]*=strength;
    const accent=sound?.beat?.locked&&preferences.beatRatio!==1 ? .12 : 1;
    const pulse=(focused||root.dataset.mode==='visual')&&preferences.beatClock
      ?Math.max((sound?.pulse||0)*accent,(sound?.beat?.pulse||0)*.72):sound?.pulse;
    if(next==='jiangnan-rain'&&animated&&response>0)jiangnanFrame=directJiangnan({track,position:snapshot.position,duration:snapshot.duration,elapsed:seconds,sound});
    const jiangnan=next==='jiangnan-rain'?jiangnanFrame:null;
    if(jiangnan&&root.dataset.jiangnanPhase!==String(jiangnan.phase))root.dataset.jiangnanPhase=String(jiangnan.phase);
    else if(!jiangnan&&Object.hasOwn(root.dataset,'jiangnanPhase'))delete root.dataset.jiangnanPhase;
    const painted=scenes.draw(context,next,{
      width:canvasWidth,height:canvasHeight,time:visualTime,bass:level(sound?.bass),mid:level(sound?.mid),high:level(sound?.high),
      pulse:level(pulse),energy:level(sound?.presence),spectrum:sceneBands,
      quality:focused?(preferences.energySaver?.32:.5):showsLyricEffects()?.52:preferences.energySaver?.64:1,seed,
      morph:(visualTime*(focused?.055:.089)+visualEnergy*.83+(seed%29)/80)%3,palette,jiangnan,
      focus:focused?visualEnergy:null,
    });
    if(!painted)return false;
    const dim=focused?(.38-brightness*.30):root.dataset.mode==='visual'?(.17-brightness*.13):(.65-brightness*.32);
    context.fillStyle=`rgba(7,8,18,${dim})`;
    context.fillRect(0,0,canvasWidth,canvasHeight);
    if(!focused&&fadeTime>0&&animated) {
      context.save();context.globalAlpha=fadeTime/.64;context.drawImage(fadeCanvas,0,0,canvasWidth,canvasHeight);context.restore();
      fadeTime=Math.max(0,fadeTime-seconds);
    }else fadeTime=0;
    return true;
  }
  function playbackCoverVisible() {
    return root.dataset.mode==='listen'&&root.dataset.lyricLayout!=='stage';
  }
  function coverFrame(now) {
    if(coverTransition&&playbackCoverVisible()&&!reducedMotion.matches) {
      const fraction=core.clamp((now-coverTransition.started)/artworkTransitionMs,0,1);
      if(fraction<1) {
        const mix=fraction*fraction*(3-2*fraction);
        return {
          tone:coverTransition.from.map((channel,index)=>channel+(coverPalette[index]-channel)*mix),
          reveal:coverTransition.reveal ? .16+.84*mix : 1,
        };
      }
    }
    coverTransition=null;
    return {tone:coverPalette,reveal:1};
  }
  function showArtworkAt(reveal) {
    const opacity=Math.round(reveal*1000)/1000;
    if(opacity!==coverReveal){
      coverReveal=opacity;
      root.style.setProperty('--lr-cover-reveal',String(opacity));
    }
  }
  function transitionArtwork(tone,reveal=false) {
    const now=performance.now(), from=coverFrame(now).tone;
    coverPalette=tone;
    const animate=onScreen()&&playbackCoverVisible()&&!reducedMotion.matches&&
      (reveal||from.some((channel,index)=>channel!==tone[index]));
    coverTransition=animate?{from,reveal,started:now}:null;
    showArtworkAt(animate&&reveal ? .16 : 1);
    backgroundDirty=true;
    wake();
  }
  function paint(now, seconds, sound, animated) {
    const {tone,reveal}=coverFrame(now);
    showArtworkAt(reveal);
    const target=root.dataset.mode==='listen'||preferences.color==='cover'?tone:colors[preferences.color]||colors.lilac;
    for(let i=0;i<3;i++)palette[i]=animated?core.approach(palette[i],target[i],seconds,.9):target[i];
    const rgb=palette.map(Math.round).join(',');if(rgb!==lastRgb){lastRgb=rgb;root.style.setProperty('--room-accent','rgb('+rgb+')');root.style.setProperty('--room-accent-rgb',rgb);document.documentElement.style.setProperty('--accent','rgb('+rgb+')');document.documentElement.style.setProperty('--accent-rgb',rgb);}
    const coverRgb=tone.map(Math.round).join(',');
    if(coverRgb!==artworkRgb){artworkRgb=coverRgb;root.style.setProperty('--lr-cover-rgb',coverRgb);}
    const response=preferences.response/100,brightness=preferences.brightness/100;
    if(root.dataset.mode==='listen'&&lyricExpanded&&preferences.lyricStyle==='fly') {
      const breathe=(animated?(.64+core.clamp(sound?.presence,0,1)*response*.28):.64).toFixed(2);
      if(breathe!==stageBreathe){stageBreathe=breathe;root.style.setProperty('--lr-atmosphere-light',breathe);}
    }
    const prism=usesImmersivePrism();
    if((prism||usesReactiveScene())&&paintReactive(seconds,sound,animated,response,brightness,prism))return;
    if(root.hasAttribute('data-active-scene')){root.removeAttribute('data-active-scene');fadeTime=0;}
    if(animated) {
      energy=core.approach(energy,Math.min(1,sound.presence),seconds,.75);
      bass=core.approach(bass,sound.bass,seconds,.8);
      flow=core.approach(flow,sound.mid,seconds,1.1);
      phase+=seconds*(.07+flow*response*.035);
    } else energy=bass=flow=0;
    const spotlight=root.dataset.mode==='listen'&&root.dataset.lyricLayout==='stage'&&preferences.background!=='plain';
    context.fillStyle=spotlight?'#0e1224':'#101019';context.fillRect(0,0,canvasWidth,canvasHeight);
    if(preferences.background==='plain'||isLibraryMode(root.dataset.mode))return;
    const radius=Math.max(canvasWidth,canvasHeight);
    function glow(x,y,size,color,opacity) {
      const light=context.createRadialGradient(x,y,0,x,y,size);
      light.addColorStop(0,'rgba('+color+','+opacity+')');
      light.addColorStop(1,'rgba('+color+',0)');
      context.fillStyle=light;
      context.fillRect(0,0,canvasWidth,canvasHeight);
    }
    const artworkVisible=preferences.mode==='work';
    const shimmer=energy*response*.035;
    if(playbackCoverVisible()) {
      const narrow=canvasWidth<=700, centerX=canvasWidth*(narrow ? .5 : listenImmersive ? .22 : .29);
      const pulse=bass*response;
      glow(centerX,canvasHeight*(narrow ? .32 : .48),radius*(.5+pulse*.04),coverRgb,brightness*(listenImmersive ? .53 : .38)+shimmer);
      glow(canvasWidth*.11,canvasHeight*.95,radius*.62,'57,68,128',brightness*.22+pulse*.025);
      glow(canvasWidth*.91,canvasHeight*.08,radius*.48,'64,69,118',brightness*.18);
      if(listenImmersive)glow(canvasWidth*.78,canvasHeight*.87,radius*.49,coverRgb,brightness*.21+pulse*.04);
      context.lineWidth=1;
      context.strokeStyle='rgba('+coverRgb+','+(brightness*.13+pulse*.025)+')';
      const orbit=radius*(listenImmersive ? .52 : .42);
      context.beginPath();
      context.ellipse(centerX,canvasHeight*(narrow?.37:.55),orbit,orbit*.37,-.31,Math.PI*.03,Math.PI*1.4);
      context.stroke();
      for(const [index,star] of nowStars.entries()){
        const opacity=(star.x>.54&&!narrow?.42:1)*(.09+brightness*.14+pulse*.06);
        const drift=Math.sin(phase+index)*2.4;
        context.fillStyle='rgba('+coverRgb+','+opacity+')';
        context.beginPath();
        context.arc(star.x*canvasWidth+drift,star.y*canvasHeight,star.radius,0,Math.PI*2);
        context.fill();
      }
      return;
    }
    if(!artworkVisible) {
      const tint=coverRgb;
      if(spotlight&&preferences.lyricStyle==='fly') {
        const drift=Math.sin(phase*.72)*.075;
        const lightX=canvasWidth*(.79+drift), lightY=canvasHeight*.84;
        glow(canvasWidth*.18,canvasHeight*.16,radius*.46,'37,95,117',brightness*.72);
        glow(lightX,lightY,radius*.49,rgb,brightness*.43+shimmer*1.6);
        glow(canvasWidth*.48,canvasHeight*.63,radius*.39,tint,brightness*.19);
        if(preferences.background!=='mist') {
          const reflection=context.createLinearGradient(0,0,canvasWidth,canvasHeight);
          reflection.addColorStop(0,'transparent');
          reflection.addColorStop(.59,'rgba('+rgb+','+brightness*.29+')');
          reflection.addColorStop(.89,'transparent');
          context.strokeStyle=reflection;
          context.lineWidth=1;
          for(const offset of [0,.045]) {
            context.beginPath();
            context.moveTo(canvasWidth*.29,canvasHeight*(1.035+offset));
            context.bezierCurveTo(canvasWidth*.57,canvasHeight*(.87+offset),lightX,canvasHeight*(.68+offset),canvasWidth*1.05,canvasHeight*(.71+offset));
            context.stroke();
          }
        }
        return;
      }
      if(spotlight) {
        const drift=Math.sin(phase*.67)*.09;
        glow(canvasWidth*(.19+drift),canvasHeight*.27,radius*.47,'51,89,140',brightness*.64);
        glow(canvasWidth*(.8-drift*.8),canvasHeight*.65,radius*.52,'83,59,142',brightness*.68+shimmer);
        glow(canvasWidth*.52,canvasHeight*(.82+drift),radius*.34,tint,brightness*.22+shimmer);
        context.lineWidth=Math.max(1,canvasWidth*.00125);
        context.strokeStyle='rgba(176,201,242,'+brightness*.17+')';
        context.beginPath();
        context.ellipse(canvasWidth*.51,canvasHeight*.8,canvasWidth*.57,canvasHeight*.49,-.19,Math.PI*1.17,Math.PI*1.89);
        context.stroke();
        return;
      }
      glow(canvasWidth*(.34+Math.cos(phase*.38)*.05),canvasHeight*.57,radius*.51,tint,brightness*.24+shimmer);
      glow(canvasWidth*(.8+Math.sin(phase*.41)*.07),canvasHeight*.19,radius*.62,'103,93,167',brightness*.42);
      glow(canvasWidth*.91,canvasHeight*.94,radius*.42,'60,82,139',brightness*.24+shimmer);
      if(preferences.background==='mist')glow(canvasWidth*.52,canvasHeight*.65,radius*.34,rgb,brightness*.12+shimmer);
      return;
    }
    glow(canvasWidth*.28,canvasHeight*.48,radius*.55,'98,77,154',brightness*.37+shimmer);
    glow(canvasWidth*.89,canvasHeight*.12,radius*.5,'82,104,158',brightness*.2);
    if(preferences.background==='mist') {
      const clouds=[[.24,.37,.53,rgb],[.76,.45,.56,'98,136,191'],[.5,.88,.47,'150,105,182']];
      clouds.forEach(([x,y,size,color],index)=>{
        glow(canvasWidth*(x+Math.sin(phase*.4+index)*.06),canvasHeight*(y+Math.cos(phase*.35+index)*.06),
          radius*size*(.8+bass*response*.08),color,brightness*.19+shimmer);
      });
    } else {
      const orbit=radius*(.47+bass*response*.016);
      const x=canvasWidth*.19+Math.sin(phase)*8;
      const y=canvasHeight*1.07+Math.cos(phase)*5;
      context.lineWidth=1;
      context.strokeStyle='rgba('+rgb+','+(brightness*.05)+')';
      for(const inset of [0,.046,.092]) {
        context.beginPath();
        context.ellipse(x,y,orbit*(1+inset),orbit*(.52+inset),-.34,0,Math.PI*2);
        context.stroke();
      }
    }
  }
  function drawSpectrum() {
    if(!spectrumContext||root.dataset.mode!=='work')return;
    api.readSpectrum(spectrumBands);
    const {width,height}=spectrum,step=width/spectrumBands.length;
    const levels=spectrumBands.map(value=>Math.round(Math.sqrt(value)*(height-7)));
    const rgb=lastRgb||palette.map(Math.round).join(',');
    const key=rgb+'|'+levels.join(',');
    if(key===lastSpectrumKey)return;
    lastSpectrumKey=key;
    spectrumContext.clearRect(0,0,width,height);
    const gradient=spectrumContext.createLinearGradient(0,height,0,0);
    gradient.addColorStop(0,'rgba('+rgb+',.18)');
    gradient.addColorStop(.62,'rgba('+rgb+',.68)');
    gradient.addColorStop(1,'rgb('+rgb+')');
    spectrumContext.fillStyle='rgba('+rgb+',.22)';
    for(let index=0;index<levels.length;index++) {
      spectrumContext.fillRect(index*step+2,height-2,step-4,2);
    }
    spectrumContext.fillStyle=gradient;
    levels.forEach((level,index)=>spectrumContext.fillRect(index*step+2,height-level-2,step-4,level));
  }
  function artworkUrl(track){return track?.cover||(track?.kind==='demo'?demoCover:'');}
  function setArtwork(image,placeholder,source){
    if(image.getAttribute('src')===(source||null))return;
    image.hidden=true;placeholder.hidden=false;
    image.onload=()=>{if(image.getAttribute('src')===source){image.hidden=false;placeholder.hidden=true;}};
    image.onerror=()=>{image.hidden=true;placeholder.hidden=false;};
    if(source){image.referrerPolicy='no-referrer';image.src=source;}else image.removeAttribute('src');
  }
  function refreshArtwork(track, homeTrack) {
    setArtwork($('[data-art-cover]'),$('[data-art-placeholder]'),artworkUrl(homeTrack));
    const source=artworkUrl(track);
    if(source===artworkSource)return;artworkSource=source;
    const request=++coverRequest;
    coverPalette=playbackCoverVisible()?coverFrame(performance.now()).tone:colors.lilac;
    coverTransition=null;
    showArtworkAt(1);
    backgroundDirty=true;
    const artwork=[
      [$('[data-now-cover]'),$('[data-now-cover-placeholder]')],
      [$('[data-thumb]'),$('[data-thumb-placeholder]')],
    ];
    for(const [image,placeholder] of artwork){
      image.hidden=true;placeholder.hidden=false;
      image.referrerPolicy='no-referrer';
      if(source)image.src=source;
      else image.removeAttribute('src');
    }
    if(!source){transitionArtwork(colors.lilac);return;}
    Promise.allSettled(artwork.map(([image])=>image.decode())).then(async results=>{
      if(request!==coverRequest)return;
      const decodedIndex=results.findIndex(result=>result.status==='fulfilled');
      const decoded=artwork[decodedIndex]?.[0];
      const color=decoded?(artworkColor(decoded)||await sampleRemoteArtwork(source)):colors.lilac;
      if(request!==coverRequest)return;
      transitionArtwork(color,Boolean(decoded));
      for(const [index,[image,placeholder]] of artwork.entries()){
        const ready=results[index].status==='fulfilled';
        image.hidden=!ready;placeholder.hidden=ready;
      }
    });
  }
  async function sampleRemoteArtwork(source) {
    const image=new Image();
    image.crossOrigin='anonymous';
    image.referrerPolicy='no-referrer';
    image.src=source;
    let timeout;
    const limit=new Promise(resolve=>{timeout=setTimeout(resolve,180,colors.lilac);});
    const sampling=image.decode().then(()=>artworkColor(image)||colors.lilac,()=>colors.lilac);
    try{return await Promise.race([sampling,limit]);}
    finally{clearTimeout(timeout);}
  }
  function artworkColor(image) {
    try {
      const scratch=document.createElement('canvas');
      scratch.width=scratch.height=16;
      const ctx=scratch.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(image,0,0,16,16);
      const pixels=ctx.getImageData(0,0,16,16).data, channels=[0,0,0];
      for(let index=0;index<pixels.length;index+=4){
        const max=Math.max(pixels[index],pixels[index+1],pixels[index+2]);
        if(max<40||max>245||!pixels[index+3])continue;
        const min=Math.min(pixels[index],pixels[index+1],pixels[index+2]);
        const weight=(1+(max-min)/128)*pixels[index+3]/255;
        for(let channel=0;channel<3;channel++)channels[channel]+=pixels[index+channel]*weight;
      }
      const peak=Math.max(...channels);
      if(peak)return channels.map(value=>Math.round(core.clamp(value/peak*205+25,80,235)));
    }catch{return null;}
    return colors.lilac;
  }
  function makeLyricRow(line,index,end) {
    const element=document.createElement('button');
    element.type='button';
    element.className='lr-lyric-row';
    element.dataset.lyricIndex=index;
    const fly=preferences.lyricStyle==='fly',effect=preferences.lyricStyle==='effects';
    const tide=effect&&preferences.lyricEffect==='tide';
    const translatedText=fly||effect&&!tide?'':line.translation;
    element.setAttribute('aria-label',translatedText?`${line.text}\n${translatedText}`:line.text);
    const size=karaoke.split(line.text).reduce((total,char)=>total+(/[\u0000-\u00ff]/.test(char)?.55:1),0);
    element.dataset.density=size>40?'dense':size>21?'long':'normal';
    if(effect&&size<=8)element.setAttribute('data-short','');
    if(tide||(fly||effect)&&size>40)element.style.setProperty('--lr-line-length',Math.max(1,size));
    const timed=karaoke.timedSpans(line,end);
    let spans=effect?effects.units(line,end,timed):timed;
    const row={element,words:[],start:line.time,index,density:size>40?.56:size>21?.78:1,timed:timed.length>0};
    element.dataset.lyricTiming=row.timed?'word':'line';
    if(!spans.length){
      const text=document.createElement('span');
      text.className='lr-lyric-word';
      text.textContent=line.text;
      text.dataset.sing='sung';
      element.append(text);
    } else {
      if(spans[0].index){
        const prefix=karaoke.split(line.text).slice(0,spans[0].index).join('');
        if(effect)spans=[{text:prefix,start:line.time,end:line.time,leading:true},...spans];
        else element.append(document.createTextNode(prefix));
      }
      for (const span of spans) {
        if (!span.text.trim()) {
          element.append(document.createTextNode(span.text));
          continue;
        }
        const order=row.words.length;
        const node=document.createElement('span');
        node.className='lr-lyric-word';
        node.textContent=span.text;
        let token;
        if (fly||effect) {
          token=document.createElement('span');
          token.className=fly?'lr-flight-token':'lr-effect-word';
          if(effect&&!row.timed)node.dataset.sing='sung';
          token.append(node);
          element.append(token);
        } else {
          if(size<=21&&line.points?.length>1&&karaoke.split(span.text.trim()).length<=5)node.dataset.motion=order%2?'1':'-1';
          element.append(node);
        }
        const word={...span,node,token,order,fill:-1,state:'',lift:0,flight:-1};
        if(effect)word.motion=effects.wordMotion(word,line.time);
        row.words.push(word);
      }
    }
    if(translatedText){
      const translation=document.createElement('span');
      translation.className='lr-lyric-translation';
      translation.textContent=translatedText;
      element.append(translation);
    }
    return row;
  }
  function drawGlyphFlight(word, row, position, animate) {
    const progress = animate && word.start > flyFrom ? karaoke.glyphFlightProgress(word,position,row.start)
      : word.start > position && !reducedMotion.matches && root.dataset.modMotion!=='still' ? 0 : 1;
    const frame = Math.round(progress * 1000);
    if (word.flight === frame) return;
    const token = word.token;
    if (frame === 0 || frame === 1000) {
      token.dataset.flightState = frame === 0 ? 'waiting' : 'landed';
      token.style.removeProperty('transform');
      token.style.removeProperty('opacity');
    } else {
      if (word.flight <= 0 || word.flight === 1000) token.dataset.flightState = 'flying';
      const direction = row.index % 2 === 0 ? -1 : 1;
      const variation = ((word.order * 7 + row.index * 3) % 11) / 10;
      const rise = word.order % 3 !== 1;
      const tone=root.dataset.modMotion==='soft'?.56:1;
      const distance = (1 - progress) ** 1.45*tone;
      const rebound = Math.sin(Math.PI * core.clamp((progress - .25) / .75,0,1)) ** 2*tone;
      const x = direction * (1.04 + .56 * variation) * distance * row.density;
      const y = (rise ? .86 : -.61) * distance * row.density - .13 * rebound;
      const angle = direction * ((rise ? -1 : 1) * (24 + 14 * variation) * distance - 6 * rebound);
      const scale = 1 - (.62 - .12 * variation) * distance + (.24 + .08 * variation) * rebound;
      token.style.transform = `translate3d(${x}em,${y}em,0) rotate(${angle}deg) scale(${scale})`;
      const clarity = core.clamp((progress + .035) / .42,0,1);
      token.style.opacity = .035 + .965 * clarity * clarity * (3 - 2 * clarity);
    }
    word.flight = frame;
  }
  function clearFlightLine() {
    if (!flyLineTransition) return;
    const {element}=flyLineTransition.row;
    delete element.dataset.flightLine;
    for (const property of ['x','y','scale','opacity']) element.style.removeProperty('--lr-flight-'+property);
    flyLineTransition=null;
  }
  function startFlightLine(row,end) {
    clearFlightLine();
    if (!row) return;
    row.element.dataset.flightLine='enter';
    flyLineTransition={row,duration:core.clamp(end-row.start,.13,.39),frame:-1};
  }
  function drawFlightLine(position) {
    if (!flyLineTransition) return;
    const {row,duration}=flyLineTransition;
    const progress=core.clamp((position-row.start)/duration,0,1);
    if (progress>=1) { clearFlightLine(); return; }
    const frame=Math.round(progress*600);
    if (frame===flyLineTransition.frame) return;
    flyLineTransition.frame=frame;
    const rest=(1-progress)**2.2;
    const direction=row.index%2===0?-1:1;
    const style=row.element.style;
    style.setProperty('--lr-flight-x',(-direction*.77*rest)+'em');
    style.setProperty('--lr-flight-y',(.23*rest)+'em');
    style.setProperty('--lr-flight-scale',1-.065*rest);
    style.setProperty('--lr-flight-opacity',1-.27*rest);
  }
  function drawEffectFrame(position,line,end,row,animated) {
    const id=preferences.lyricEffect, moving=animated&&Boolean(line);
    const pose=effects.lineFrame(position,line?.time??position,end,moving);
    const stageMotion=effectStageMotion[id], now=performance.now();
    if(stageMotion&&(now>=nextSceneryFrame||moving!==sceneryAnimated)){
      nextSceneryFrame=now+1000/30-1;
      for(const name of stageMotion)setEffectValue(effectStage,effectStageStyle,name,pose[name]);
    }
    sceneryAnimated=moving;
    let renderer='text';
    if (row&&!reducedMotion.matches&&effectRenderer) {
      renderer=effectRenderer.paint(row,id,position,pose.enter,moving);
    } else if(!effectSurface.hidden||reducedMotion.matches) {
      effectRenderer?.hide();
    }
    if(root.dataset.lyricRenderer!==renderer)root.dataset.lyricRenderer=renderer;
    if(renderer==='text'&&row?.timed)for(const word of row.words)if(!word.leading)drawSungWord(word,position);
  }
  function setEffectValue(node,cache,name,value) {
    const rounded=Math.round(value*256)/256;
    if(cache[name]===rounded)return;
    cache[name]=rounded;
    node.style.setProperty('--fx-'+name,rounded);
  }
  function updateTide(track,sound,seconds) {
    if(track!==tideTrack){
      tideTrack=track;
      tideDepth=0;
    }
    if(sound&&track!==null){
      const target=core.clamp((Math.sqrt(sound.rms)-.1)*2.7+sound.presence*.16,0,1);
      tideDepth=core.approach(tideDepth,target,seconds,target>tideDepth?1.35:2.8);
    }
    const depth=Math.round(tideDepth*Math.sqrt(preferences.response/100)*48)/48;
    setEffectValue(effectStage,effectStageStyle,'water',depth);
  }
  function drawSungWord(word,position) {
    const fill=Math.round(karaoke.progress(word,position)*1000)/10;
    if(fill===word.fill)return fill;
    word.fill=fill;
    const state=fill>=100?'sung':fill>0?'voicing':'waiting';
    if(word.state!==state)word.node.dataset.sing=word.state=state;
    if(state==='voicing')word.node.style.setProperty('--lr-sung',fill+'%');
    return fill;
  }
  function clearPreparedLyric(){
    if(!preparedLyric)return;
    preparedLyric.cancel?.();
    preparedLyric.row?.element.remove();
    preparedLyric=null;
    effectRenderer?.clearPrewarm();
  }
  function prepareNextLyric(lines,index,position){
    const next=index+1,line=lines[next];
    if(!line||line.time-position<.15||preparedLyric?.index===next||performance.now()<nextLyricPrepareAttempt)return;
    clearPreparedLyric();
    const preset=preferences.lyricEffect;
    const job={index:next,row:null,cancel:null};
    preparedLyric=job;
    const run=deadline=>{
      if(preparedLyric!==job)return;
      job.cancel=null;
      if(!showsLyricEffects()||!onScreen()||reducedMotion.matches||seekPreview||!lyricsPlaying()||
        snapshot.lyrics!==lines||lyricIndex!==index||line.time-lyricPosition()<.12||preset!==preferences.lyricEffect){
        clearPreparedLyric();return;
      }
      // High-refresh displays often leave only a few milliseconds of idle time.
      if(deadline&&deadline.timeRemaining()<2){
        nextLyricPrepareAttempt=performance.now()+75;
        clearPreparedLyric();return;
      }
      const end=lines[next+1]?.time??Math.max(snapshot.lyricDuration,line.time+.5);
      const row=makeLyricRow(line,next,end);
      job.row=row;
      row.element.tabIndex=-1;
      row.element.setAttribute('aria-hidden','true');
      row.element.style.visibility='hidden';
      lyricTimeline.append(row.element);
      if(!effectRenderer.prewarm(row,preset))clearPreparedLyric();
    };
    if(typeof requestIdleCallback==='function'){
      const id=requestIdleCallback(run);
      job.cancel=()=>cancelIdleCallback(id);
    }else{
      const id=setTimeout(run,35);
      job.cancel=()=>clearTimeout(id);
    }
  }
  function takePreparedLyric(index){
    const row=preparedLyric?.index===index?preparedLyric.row:null;
    if(!row){clearPreparedLyric();return null;}
    preparedLyric=null;
    row.element.removeAttribute('tabindex');
    row.element.removeAttribute('aria-hidden');
    row.element.style.removeProperty('visibility');
    return row;
  }
  function showLyricRows(lines,index,animate,prepared=null) {
    lyricTimeline.dataset.flow=String(animate);
    const neighbors=preferences.lyricStyle==='stage'?2:0;
    const first=Math.max(0,index-neighbors),last=Math.min(lines.length-1,index+neighbors);
    for(const [number,row] of lyricRows) {
      if(number<first||number>last) {
        row.element.remove();
        lyricRows.delete(number);
      }
    }
    for(let number=first;number<=last;number++) {
      let row=lyricRows.get(number);
      if(!row) {
        const line=lines[number],end=lines[number+1]?.time??Math.max(snapshot.lyricDuration,line.time+.5);
        row=number===index&&prepared?prepared:makeLyricRow(line,number,end);
        lyricRows.set(number,row);
        if(!row.element.isConnected){
          const next=[...lyricTimeline.children].find(element=>Number(element.dataset.lyricIndex)>number);
          lyricTimeline.insertBefore(row.element,next||null);
        }
      }
      const offset=number-index;
      row.element.dataset.slot=offset;
      row.element.toggleAttribute('data-current-line',offset===0);
      row.element.toggleAttribute('data-prev-line',offset===-1);
      row.element.toggleAttribute('data-next-line',offset===1);
      if(offset===0)row.element.setAttribute('aria-current','true');
      else row.element.removeAttribute('aria-current');
    }
  }
  function renderLyrics(position=snapshot.lyricPosition,snap=false) {
    if(isLibraryMode(root.dataset.mode))return;
    const lines=snapshot.lyrics?.length?snapshot.lyrics:emptyLyrics;
    const {index,line,end}=core.lyricAt(lines,position,snapshot.lyricDuration);
    if(root.dataset.mode!=='listen') {
      const preview=$('[data-small-line]');
      const text=line?.text||(snapshot.external?'正在跟随外部播放的声音':
        lines.length?'歌词即将开始':snapshot.track?.kind==='demo'?'这首音景是纯音乐':'暂无同步歌词');
      if(preview.textContent!==text)preview.textContent=text;
      const next=$('[data-small-next]'),upcoming=lines[index+1]?.text||'';
      if(next.textContent!==upcoming)next.textContent=upcoming;
      next.hidden=!upcoming;
      $('[data-work-caption]').dataset.hasLine=String(Boolean(line));
      const link=$('[data-caption-action]');
      const action=lines.length?'listen':'lyrics';
      if(link.dataset.action!==action){link.dataset.action=action;link.firstElementChild.textContent=lines.length?'打开歌词':'导入歌词';}
      link.hidden=snapshot.external||!snapshot.track;
      return;
    }
    const track=snapshot.track?.id,style=preferences.lyricStyle,fly=style==='fly',effect=style==='effects';
    const layout=effect?preferences.lyricEffect:style;
    const sourceChanged=lines!==renderedLyrics||lyricTrack!==track||renderedLyricStyle!==layout;
    const advance = position - lastLyricPosition;
    const flowing = !sourceChanged && !snap && !seekPreview && !reducedMotion.matches && root.dataset.modMotion!=='still' && lyricsPlaying() && onScreen() &&
      advance >= -.018 && advance < .4 && index >= lyricIndex && index <= lyricIndex + 1;
    if (!flowing) {
      clearFlightLine();
      if (fly) flyFrom=position;
    }
    if(sourceChanged) {
      clearPreparedLyric();
      lyricTimeline.replaceChildren();
      lyricRows.clear();
      lyricIndex=-2;
      lyricTrack=track;
      renderedLyrics=lines;
      renderedLyricStyle=layout;
    }
    if(effect&&(snap||seekPreview||!Number.isFinite(advance)||Math.abs(advance)>.4))clearPreparedLyric();
    if(index!==lyricIndex) {
      const prepared=effect&&flowing?takePreparedLyric(index):null;
      if(!prepared)clearPreparedLyric();
      showLyricRows(lines,index,style==='stage'&&flowing,prepared);
      lyricIndex=index;
      if (fly&&flowing) startFlightLine(lyricRows.get(index),end);
    }
    if (fly) drawFlightLine(position);
    lastLyricPosition=position;
    const songsHaveLyrics=Boolean(lines.length);
    const interlude=Number.isFinite(line?.end)&&lines[index+1]?.time-line.end>2.5&&
      position>line.end+.45&&position<lines[index+1].time-.35;
    if(lyricTimeline.dataset.quiet!==String(interlude)){
      lyricTimeline.dataset.quiet=String(interlude);
      effectSurface.toggleAttribute('data-quiet',interlude);
    }
    const notice=snapshot.external&&!songsHaveLyrics?'正在跟随外部声音':!snapshot.ready?'正在载入音乐':
      interlude?'间奏':songsHaveLyrics?(index===-1?'前奏':''):
      snapshot.track?.kind==='demo'?'原创音景 · 纯音乐':snapshot.track?'这首歌还没有歌词':'选择一首歌';
    if(lyricNoticeText.textContent!==notice){lyricNoticeText.textContent=notice;lyricNotice.hidden=!notice;}
    if(lyricEditor.hidden!==snapshot.external)lyricEditor.hidden=snapshot.external;
    const row=lyricRows.get(index);
    const timing=row?.timed?(fly?'按字词时间飞入':'按字词时间同步'):line?'逐行同步':'导入或调整歌词';
    if(lyricEditor.title!==timing)lyricEditor.title=timing;
    if(effect) {
      const animated=preferences.lyricEffect!=='still'&&!seekPreview&&!reducedMotion.matches&&
        root.dataset.modMotion!=='still'&&lyricsPlaying()&&onScreen();
      drawEffectFrame(position,line,end,row,animated);
      if(animated&&effectRenderer&&(!row||root.dataset.lyricRenderer!=='text'))prepareNextLyric(lines,index,position);
      else clearPreparedLyric();
      return;
    }
    for(const word of row?.words||[]) {
      if (fly) drawGlyphFlight(word,row,position,flowing);
      if (!row.timed) continue;
      const fill=drawSungWord(word,position);
      if (!word.node.dataset.motion || root.dataset.lyricLayout !== 'stage') continue;
      const pulse = Math.sin(fill * Math.PI / 100);
      const lift = Math.round(pulse * 100) / 100;
      if (lift === word.lift) continue;
      word.lift = lift;
      word.node.style.setProperty('--lr-lift',(-.095 * lift).toFixed(4)+'em');
      word.node.style.setProperty('--lr-tilt',(lift * 2 * Number(word.node.dataset.motion)).toFixed(2)+'deg');
    }
  }
  let externalSourceKey='',externalLyricsKey='',externalLyricsJob=0;
  function updateExternalMetadataUI() {
    const field=$('[data-external-session]'), select=$('[data-external-source]');
    const info=snapshot.externalMetadata, sessions=info?.sessions||[], preferred=info?.preferred||'';
    field.hidden=!desktop?.externalNowPlaying||!snapshot.external;
    const timed=info?.status==='ready'&&info.title&&Number.isFinite(info.position)&&Number.isFinite(info.duration)&&info.duration>=1;
    const lyricKey=timed?JSON.stringify([info.sourceId,info.title,info.artist,info.album,info.duration]):'';
    if(lyricKey!==externalLyricsKey){
      externalLyricsKey=lyricKey;externalLyricsJob++;
      $('[data-external-lyrics-status]').textContent='';
      $('[data-external-find-lyrics]').removeAttribute('aria-busy');
    }
    $('[data-external-lyrics]').hidden=!timed;
    const find=$('[data-external-find-lyrics]');
    find.disabled=!timed||!info.artist||info.duration>3600||find.hasAttribute('aria-busy');
    if(field.hidden)return;
    if($('[data-external-dialog]').open){
      const key=JSON.stringify([preferred,sessions.map(({sourceId,sourceApp,title})=>[sourceId,sourceApp,title])]);
      if(key!==externalSourceKey){
        externalSourceKey=key;
        const options=[new Option('跟随 Windows 当前播放器','')];
        sessions.forEach(({sourceId,sourceApp,title})=>options.push(new Option([sourceApp,title].filter(Boolean).join(' · '),sourceId)));
        if(preferred&&!sessions.some(session=>session.sourceId===preferred))options.push(new Option('已选来源暂未提供信息',preferred));
        select.replaceChildren(...options);select.value=preferred;
      }
    }
    const status={waiting:'正在读取 Windows 播放器信息。',empty:'等待播放器向 Windows 提供曲目信息。',missing:'已选来源暂不可用，可以改为跟随 Windows。',unavailable:'暂时无法读取 Windows 播放器信息。'};
    const text=info?.status==='ready'?[info.sourceApp,info.playing?'正在播放':'当前未播放',Number.isFinite(info.position)?'进度已同步':'播放器未提供进度'].filter(Boolean).join(' · '):status[info?.status]||status.waiting;
    const message=$('[data-external-metadata-status]');
    if(message.textContent!==text)message.textContent=text;
  }
  const musicSourceNames={file:'本地音乐',online:'汽水音乐',demo:'内置示例',chart:'在线榜单'};
  const recoveryDetails={auth:'汽水登录已失效',connection:'音乐连接已中断',timeout:'播放连接超时',file:'本地音频读取失败',unplayable:'这首歌暂时无法播放','resume-source':'当前音源不包含上次的播放进度'};
  function updateHomeResume(){
    const saved=snapshot.ready&&!snapshot.playing&&!snapshot.external?api.resumeInfo():null;
    const resume=saved?.kind==='demo'&&snapshot.demoOnly?null:saved;
    const shown=Boolean(resume);
    const home=$('.lr-home-card'),copy=$('.lr-home-copy'),button=$('[data-home-resume]'),status=$('[data-resume-status]'),skip=$('[data-resume-skip]');
    const wasShown=!button.hidden;
    if(shown!==wasShown){
      const restoreFocus=!shown&&(document.activeElement===button||document.activeElement===skip);
      copy.dataset.resuming=String(shown);
      home.setAttribute('aria-labelledby',shown?'lrHomeResumeTitle':'lrHomeTrackName');
      $$('.lr-home-copy > .lr-track-labels, .lr-home-copy > [data-home-title], .lr-home-copy > .lr-home-artist').forEach(field=>field.hidden=shown);
      button.hidden=!shown;
      if(restoreFocus&&preferences.mode==='work')$('[data-action="play"]').focus({preventScroll:true});
    }
    if(!resume){status.hidden=skip.hidden=true;return null;}

    const phase=resume.phase||snapshot.playbackRecovery?.phase;
    const pending=Boolean(phase||snapshot.busy||snapshot.externalPending);
    const signedOut=resume.recovery==='auth'&&!snapshot.onlineLoggedIn;
    const label=pending?'正在续听…':signedOut?'重新登录':resume.retry?'重试续听':'继续听';
    const detail=resume.recovery==='auth'&&!signedOut?'汽水登录已恢复':recoveryDetails[resume.recovery]||'暂时无法续听';
    const message=phase==='login'?'正在等待汽水扫码确认。':pending||!resume.retry?'':
      (resume.exhausted?'队列里没有可接播的歌曲':detail)+'，已保留上次进度。';
    const fields={
      '[data-resume-title]':resume.name,
      '[data-resume-source]':musicSourceNames[resume.kind]||'音乐',
      '[data-resume-position]':'上次听到 '+core.formatTime(resume.position),
      '[data-resume-label]':label,
      '[data-resume-status]':message
    };
    for(const [selector,value] of Object.entries(fields)){
      const field=$(selector);
      if(field.textContent!==value)field.textContent=value;
    }
    if(button.title!==resume.name)button.title=resume.name;
    if(button.getAttribute('aria-disabled')!==String(pending))button.setAttribute('aria-disabled',String(pending));
    status.hidden=!message;
    const hideSkip=pending||!resume.canSkip;
    if(hideSkip&&document.activeElement===skip)button.focus({preventScroll:true});
    skip.hidden=hideSkip;
    return resume;
  }
  function updateRecentShelf(){
    const shelf=$('[data-work-recent]');
    if(preferences.mode!=='work'||!snapshot.ready){shelf.hidden=true;return;}
    shelf.hidden=!recentTracks.length;
    if(!recentShelfDirty)return;
    recentShelfDirty=false;
    const items=api.recentTracks(4);
    shelf.hidden=!items.length;
    if(items.length===recentTracks.length&&items.every((item,index)=>{
      const prev=recentTracks[index];
      return item.id===prev.id&&item.name===prev.name&&item.artist===prev.artist&&item.kind===prev.kind&&item.cover===prev.cover;
    }))return;
    recentTracks=items;
    const list=$('[data-recent-list]'),focused=document.activeElement?.dataset.recentTrack;
    list.replaceChildren(...items.map(track=>{
      const button=document.createElement('button');
      button.type='button';button.className='lr-recent-track';button.dataset.recentTrack=track.id;
      const cover=document.createElement('span'),copy=document.createElement('span');
      cover.className='lr-recent-cover';cover.setAttribute('aria-hidden','true');cover.innerHTML=icon('music');
      const url=artworkUrl(track);
      if(url){
        const image=document.createElement('img');
        image.className='lr-recent-cover';image.alt='';image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';
        image.addEventListener('error',()=>image.replaceWith(cover),{once:true});
        image.src=url;button.append(image);
      }else button.append(cover);
      copy.className='lr-recent-copy';
      const title=document.createElement('span'),source=document.createElement('span');
      title.className='lr-recent-title';title.textContent=track.name;
      source.className='lr-recent-source';source.textContent=musicSourceNames[track.kind]||'音乐';
      button.title=[track.name,track.artist,source.textContent].filter(Boolean).join(' · ');
      copy.append(title,source);button.append(copy);
      return button;
    }));
    if(focused)list.querySelector('[data-recent-track="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
  }
  function updateUI(force=false,snapLyrics=false,current=api.snapshot()) {
    const previous=snapshot;
    snapshot=current;
    const trackChanged=!samePlayback(previous,snapshot);
    const playingChanged=lyricsPlaying(previous)!==lyricsPlaying();
    const activityChanged=snapshot.busy!==previous.busy||snapshot.buffering!==previous.buffering||
      Boolean(snapshot.queueTarget)!==Boolean(previous.queueTarget)||
      Boolean(snapshot.playbackRecovery)!==Boolean(previous.playbackRecovery);
    const hasLyrics=String(snapshot.lyrics.length>0);
    if(root.dataset.listenLyrics!==hasLyrics){
      root.dataset.listenLyrics=hasLyrics;
      if(listenImmersive){resize();backgroundDirty=true;}
    }
    if(trackChanged||playingChanged||activityChanged)revealListeningControls();
    if(seekPointer&&!matchesSeek(seekPointer.target,snapshot))seekPointer.target=null;
    if(seekPreview&&!matchesSeek(seekPreview,snapshot)){seekPreview=null;snapLyrics=true;}
    if(snapshot.playing!==previous.playing){backgroundDirty=true;revealStageChrome();}
    if(trackChanged||force){backgroundDirty=true;if(scenes)syncSceneLabels();}
    if(trackChanged&&root.dataset.mode!=='listen')nowPlaying.sync(snapshot,snapshot.lyricPosition);
    musicLibrary.updatePlayback(snapshot);
    updatePlaybackRecovery();
    updateTransportStatus();
    if(root.dataset.mode==='work'&&(force||performance.now()-lastQueueRefresh>550))renderWorkQueue();
    refreshOpenQueue(force);
    const resume=updateHomeResume();
    updateRecentShelf();
    $('[data-lyric-timing]').hidden=!snapshot.canNudgeLyrics;
    const offset=snapshot.lyricOffset,offsetLabel=(offset>0?'+':'')+offset.toFixed(1)+' 秒';
    const offsetOutput=$('[data-lyric-offset]');if(offsetOutput.textContent!==offsetLabel)offsetOutput.textContent=offsetLabel;
    $('[data-lyric-adjust="-0.1"]').disabled=offset<=-30;
    $('[data-lyric-adjust="0.1"]').disabled=offset>=30;
    const info=snapshot.lyricsInfo;
    const lyricSourceText=info?.state==='ready'?`${info.source} · ${info.timing==='word'?'逐字同步':'逐行同步'}`:
      {loading:'正在查找当前录音的歌词…',unavailable:'歌词服务暂时不可用',cleared:'此曲歌词已手动清除',disabled:'此曲歌词已关闭'}[info?.state]||'';
    $$('[data-lyric-source-info]').forEach(element=>{
      if(element.textContent!==lyricSourceText)element.textContent=lyricSourceText;
      if(element.hidden!==!lyricSourceText)element.hidden=!lyricSourceText;
    });
    $$('[data-action="retry-lyrics"]').forEach(button=>{button.hidden=info?.state!=='unavailable';});
    if(!force&&!snapLyrics&&!trackChanged&&!lyricSurfaceDirty&&!snapshot.playing&&!snapshot.external&&idleFields.every(key=>snapshot[key]===previous[key])&&
      trackFields.every(key=>snapshot.track?.[key]===previous.track?.[key])&&
      (snapshot.lyrics===previous.lyrics||(!snapshot.lyrics.length&&!previous.lyrics.length)))return;
    root.dataset.playing=String(snapshot.playing||snapshot.external);
    const title=snapshot.track?.name||'选择一首歌';
    if(title!==lastTitle){
      lastTitle=title;
      const dockTitle=$('[data-title]');
      dockTitle.textContent=title;dockTitle.title=title;
      $('[data-home-title]').textContent=title;
      $('[data-now-title]').textContent=title;
    }
    const isBundledSample=snapshot.track?.kind==='demo'&&snapshot.track.id==='demo-auld-lang-syne';
    const artist=snapshot.track?.artist||(snapshot.track?.kind==='demo'?'Interstellar Drift':'');
    if($('[data-artist]').textContent!==artist){
      $('[data-artist]').textContent=artist;$('[data-home-artist]').textContent=artist;$('[data-now-artist]').textContent=artist;
    }
    const statusLabel=snapshot.external?'声音联动':snapshot.buffering?'正在缓冲':snapshot.playing?'正在播放':
      snapshot.playbackInterrupted||snapshot.queueRecovery?'等待重试':snapshot.track?'已暂停':'待播';
    const trackState=$('[data-track-state]');
    if(trackState.textContent!==statusLabel)trackState.textContent=statusLabel;
    const source=$('[data-track-source]');
    const label=snapshot.external?(snapshot.externalMetadata?.sourceApp||'外部声音'):{online:'汽水音乐',demo:isBundledSample?'内置示例':'原创音景',file:'本地音乐'}[snapshot.track?.kind]||'';
    if(source.textContent!==label){source.textContent=label;source.hidden=!label;}
    $('[data-source-status]').hidden=!snapshot.external;
    $('[data-external-header]').hidden=!snapshot.external;
    const status=$('[data-live]');
    const message=!snapshot.ready?'正在载入歌库':snapshot.external?'已连接外部声音':snapshot.busy?'正在准备音乐':'';
    if(status.textContent!==message){status.hidden=!message;status.textContent=message;}
    const playing=snapshot.external?snapshot.externalMetadata?.playing===true:snapshot.playing;
    if(displayedPlaying!==playing){
      displayedPlaying=playing;
      const glyph=icon(playing?'pause':'play');
      $('[data-play-icon]').innerHTML=glyph;
      $('[data-demo-icon]').innerHTML=glyph;
    }
    const demoControls=preferences.mode==='work'&&!resume&&snapshot.demoOnly&&snapshot.track?.kind==='demo'&&!snapshot.external;
    root.dataset.demoControls=String(demoControls);
    const sampleLabel=$('[data-sample-label]'),sampleText=playing?'暂停试听':'试听示例';
    if(sampleLabel.textContent!==sampleText)sampleLabel.textContent=sampleText;
    $('[data-demo-actions]').hidden=!demoControls;
    $('[data-demo-lyrics]').hidden=!isBundledSample;
    $('[data-home-now-playing]').hidden=Boolean(resume)||demoControls&&isBundledSample;
    $('[data-sample-license]').hidden=!isBundledSample||snapshot.external;
    $('[data-start-import]').disabled=snapshot.importing;
    const playButton=$('[data-action="play"]'),playLabel=playing?'暂停音乐':'播放音乐';
    if(playButton.getAttribute('aria-label')!==playLabel)playButton.setAttribute('aria-label',playLabel);
    for(const action of ['play','demo-play','previous','next','favorite','repeat'])root.querySelectorAll('[data-action="'+action+'"]').forEach(button=>button.disabled=!snapshot.ready||snapshot.busy||snapshot.external||!snapshot.track);
    $('[data-action="favorite"]').setAttribute('aria-pressed',String(snapshot.track?.favorite||false));
    const externalTimed=snapshot.external&&Number.isFinite(snapshot.externalMetadata?.position);
    if(!seekPreview){
      const time=snapshot.external&&!externalTimed?'LIVE':core.formatTime(snapshot.position);
      $('[data-position]').textContent=time;
      seekSlider.setAttribute('aria-valuetext',time);
    }
    $('[data-duration]').textContent=snapshot.external&&!externalTimed?'外部播放':core.formatTime(snapshot.duration);
    seekSlider.disabled=!canSeek(snapshot);
    seekSlider.max=String(snapshot.duration||1);
    if(!seekPreview)seekSlider.value=snapshot.position;
    fill(seekSlider);
    if(!volumeChanging)volumeSlider.value=Math.round(snapshot.volume*100);
    volumeSlider.disabled=snapshot.external;
    fill(volumeSlider);
    const repeatLabel=playbackNames[snapshot.playbackMode]||'列表循环';
    $$('[data-repeat-label]').forEach(element=>{if(element.textContent!==repeatLabel)element.textContent=repeatLabel;});
    $('[data-connect]').hidden=snapshot.external;$('[data-connect]').disabled=!snapshot.ready||snapshot.busy||snapshot.externalPending;$('[data-connect]').textContent=snapshot.externalPending?'正在连接…':'连接声音';$('[data-disconnect]').hidden=!snapshot.external;
    $('[data-external-status]').textContent=snapshot.external
      ? snapshot.externalSignal==='sound'?'已检测到声音，画面正在跟随。':snapshot.externalSignal==='silent'?'已连接，暂未检测到声音。请在原播放器开始播放。':'已连接，正在等待声音。'
      : snapshot.externalPending?'正在等待声音来源…':'还未连接外部声音。';
    updateExternalMetadataUI();
    refreshArtwork(snapshot.track,resume||snapshot.track);
    if(lyricSurfaceDirty||!lyricFrameId||force||!lyricsPlaying()||snapLyrics||trackChanged)
      renderListeningPosition(lyricPosition(trackChanged?snapshot.position:api.position()),snapLyrics||trackChanged);
  }
  function updatePlaybackRecovery(){
    renderRecoveryPanel($('[data-playback-recovery]'),snapshot,$('[data-action="play"]'));
  }
  function updateTransportStatus() {
    const status=$('[data-transport-status]');
    let message='';
    if(!snapshot.playbackRecovery?.phase){
      const name=snapshot.queueTarget?.name;
      if(name)message=`正在加载「${name}」…`;
      else if(snapshot.buffering)message='正在缓冲当前歌曲…';
    }
    if(status.textContent!==message)status.textContent=message;
    status.hidden=!message;
  }
  function renderRecoveryPanel(panel,state,focusFallback){
    const recovery=state.playbackRecovery;
    const retry=panel.querySelector('[data-recovery-retry]'),skip=panel.querySelector('[data-recovery-skip]');
    if(!recovery){
      const restoreFocus=!panel.hidden&&panel.contains(document.activeElement);
      panel.hidden=true;
      if(restoreFocus)requestAnimationFrame(()=>{
        if(document.activeElement===document.body||panel.contains(document.activeElement))focusFallback.focus({preventScroll:true});
      });
      return;
    }
    const position=core.formatTime(recovery.position);
    const signedOut=recovery.reason==='auth'&&!state.onlineLoggedIn;
    const trackIssue=['file','unplayable','resume-source'].includes(recovery.reason);
    const detail=recovery.reason==='auth'&&!signedOut?'汽水登录已恢复':recoveryDetails[recovery.reason]||recoveryDetails.connection;
    const progress={connecting:'正在重新连接…',login:'正在等待扫码确认…',resuming:'正在恢复播放…'}[recovery.phase];
    const statusText=(trackIssue&&!progress?`「${recovery.name}」未能播放。${detail}，${recovery.canSkip?'可重试或跳过。':'可重试这首。'}`:
      `${progress||detail+'。'}「${recovery.name}」已保留，${progress?'将从':'可从'} ${position} 继续。`)+
      (recovery.exhausted&&!progress?'队列里没有可接播的歌曲。':'');
    const label=progress||(signedOut?'重新登录汽水音乐':recovery.reason==='connection'&&!state.onlineReady?'重新连接并重试':'重试当前歌曲');
    const status=panel.querySelector('[role="status"]');
    if(status.textContent!==statusText)status.textContent=statusText;
    if(retry.textContent!==label)retry.textContent=label;
    const pending=String(Boolean(recovery.phase||state.busy));
    for(const button of [retry,skip])if(button.getAttribute('aria-disabled')!==pending)button.setAttribute('aria-disabled',pending);
    if(!recovery.canSkip&&document.activeElement===skip)retry.focus({preventScroll:true});
    skip.hidden=!recovery.canSkip;
    panel.hidden=false;
  }
  function publishPlayerState(){
    const state=api.snapshot(), {index,line}=core.lyricAt(state.lyrics,state.lyricPosition,state.lyricDuration);
    const track={name:state.track?.name,artist:state.track?.artist};
    const desktopLyric=line?.text||'',nextLyric=state.lyrics[index+1]?.text||'';
    const previousLyric=state.lyrics[index-1]?.text||'', translation=line?.translation||'';
    const text=preferences.desktopLyrics?desktopLyric:'';
    const time=Math.floor(state.position);
    const playing=state.external?state.externalMetadata?.playing===true:state.playing;
    const values=[track.name,track.artist,playing,state.external,time,Math.floor(state.duration),text,desktopLyric,nextLyric,previousLyric,translation];
    if(values.every((value,index)=>value===lastPublishedState[index]))return;
    lastPublishedState=values;
    desktop.publish({track,playing,external:state.external,position:state.position,duration:state.duration,lyric:text,desktopLyric,nextLyric,previousLyric,translation});
  }
  function queueTick(delay) {
    clearTimeout(timer);
    timer=setTimeout(tick,delay);
  }
  function onScreen() { return !legacy&&!document.hidden&&!occluded; }
  function lyricPosition(position=api.position()) {
    return position + snapshot.lyricPosition - snapshot.position;
  }
  function lyricsPlaying(state=snapshot) { return state.external ? state.externalMetadata?.playing===true : state.playing; }
  function needsLyricFrame() {
    const cap=showsLyricEffects()&&preferences.lyricEffect==='still';
    return !seekPreview&&!cap&&onScreen()&&root.dataset.mode==='listen'&&lyricsPlaying()&&snapshot.lyrics.length>0&&!reducedMotion.matches;
  }
  function renderListeningPosition(position,snap=false) {
    const layoutChanged=lyricSurfaceDirty;
    lyricSurfaceDirty=false;
    nowPlaying.showSeek(snapshot,seekPreview?.position);
    const expanded=lyricExpanded&&!listenImmersive;
    if(root.dataset.mode==='listen'&&(!expanded||root.dataset.lyricLayout==='list')) {
      nowPlaying.sync(snapshot,position,{full:expanded,force:snap||layoutChanged});
    }else if(!seekPreview||root.dataset.mode!=='listen'){
      renderLyrics(seekPreview?lyricPosition(seekPreview.position):position,snap);
    }
  }
  function drawLyricFrame(now) {
    lyricFrameId=0;
    if(!needsLyricFrame()){nextEffectFrame=0;return;}
    if(showsLyricEffects()){
      const interval=1000/(preferences.energySaver?60:120);
      if(now+.6>=nextEffectFrame){
        nextEffectFrame=Math.max(nextEffectFrame+interval,now+interval*.5);
        renderListeningPosition(lyricPosition());
      }
    } else renderListeningPosition(lyricPosition());
    lyricFrameId=requestAnimationFrame(drawLyricFrame);
  }
  function wake() {
    lastUI=-Infinity;
    if(onScreen())queueTick(0);
  }
  function renderBeatClock(beat,active,reduced) {
    const ready=preferences.beatClock&&beat?.locked;
    const label=!preferences.beatClock?'节拍 · 关':ready?Math.round(beat.bpm)+' BPM':active?'分析节拍':'等待音乐';
    if(beatStatus.textContent!==label)beatStatus.textContent=label;
    const index=ready?beat.beatInBar:-1;
    if(index!==beatClockIndex){
      beatClockIndex=index;
      beatSteps.forEach((step,slot)=>step.classList.toggle('active',slot===index));
    }
    const pulse=ready&&!reduced?Math.round(beat.pulse*20)/20:0;
    if(pulse!==beatClockPulse){beatClockPulse=pulse;beatClock.style.setProperty('--lr-beat-pulse',String(pulse));}
  }
  function tick() {
    timer=0;
    if(!onScreen())return;
    const now=performance.now(),refresh=now-lastUI>=100;
    if(refresh){lastUI=now;updateUI();}
    const mode=root.dataset.mode,reduced=reducedMotion.matches;
    const active=snapshot.playing||snapshot.external;
    const prism=usesImmersivePrism(),reactive=prism||usesReactiveScene();
    const lyricEffects=showsLyricEffects();
    const animate=active&&!reduced&&!isLibraryMode(mode)&&(reactive||!lyricEffects&&preferences.background!=='plain');
    const showSpectrum=mode==='work';
    const coverBeat=active&&!reduced&&!listenImmersive&&(mode==='listen'&&!lyricExpanded||mode==='work');
    const lyricBeat=lyricEffects&&!reduced&&preferences.response>0&&lyricsPlaying()&&effects.get(preferences.lyricEffect).beat;
    const tideActive=root.dataset.lyricEffect==='tide'&&!reduced&&preferences.response>0;
    const tideMoving=tideActive&&lyricsPlaying()&&!seekPreview;
    const stageBeat=active&&mode==='visual'&&preferences.beatClock;
    const followLyrics=mode==='listen'&&lyricsPlaying()&&snapshot.lyrics.length>0;
    const artworkMoving=Boolean(coverTransition);
    const fps=core.frameRate({active:artworkMoving||active&&(animate||showSpectrum||snapshot.external||followLyrics||coverBeat||stageBeat||tideMoving),reduced,mode,energySaver:preferences.energySaver});
    const wasActive=lastFrame>0;
    const seconds=wasActive?Math.min(.1,(now-lastFrame)/1000):1/(fps||20);
    lastFrame=fps?now:0;
    const sound=active&&(animate||showSpectrum||snapshot.external||coverBeat||stageBeat||lyricBeat||tideMoving)?api.sample(seconds):null;
    if(tideActive||tideTrack!==null)updateTide(tideActive?snapshot.track?.id??null:null,tideMoving?sound:null,seconds);
    if(sound)sound.beat=SonicMusicMotion.correctBeat(sound.beat,preferences.beatRatio);
    const beat=sound?.beat, age=beat?.age??Infinity;
    const effectPulse=beat?.locked?beat.pulse:preferences.lyricEffect==='orbit'?0:(sound?.pulse||0)*.65;
    const lyricPulse=lyricBeat?Math.round(effectPulse*preferences.response*.5)/50:0;
    if(lyricPulse!==effectBeat){effectBeat=lyricPulse;effectStage.style.setProperty('--fx-beat',String(lyricPulse));}
    if(mode==='visual')renderBeatClock(beat,active,reduced);
    const pulse=coverBeat&&age<.37?beat.strength*(1-Math.exp(-age*70))*Math.exp(-age*11):0;
    const pulseScale=1+Math.round(pulse*preferences.response*.91)/1000;
    if(pulseScale!==coverScale){coverScale=pulseScale;root.style.setProperty('--lr-cover-scale',String(coverScale));}
    const sceneInterval=prism?(preferences.energySaver?64:42):lyricEffects?(preferences.energySaver?83:56):mode==='listen'?(preferences.energySaver?56:40):0;
    const redraw=Boolean(context)&&(backgroundDirty||artworkMoving||reactive&&!active&&wasActive||animate&&now-lastPaint>=sceneInterval);
    if(redraw){paint(now,lastPaint?Math.min(.12,(now-lastPaint)/1000):seconds,sound,animate);lastPaint=now;renderedFrames++;}
    if(showSpectrum&&(active||backgroundDirty||wasActive))drawSpectrum();
    backgroundDirty=false;
    if(!lyricFrameId&&needsLyricFrame())lyricFrameId=requestAnimationFrame(drawLyricFrame);
    if(!lyricFrameId&&!refresh&&followLyrics)renderListeningPosition(lyricPosition());
    const cost=performance.now()-now,limit=String(fps);
    if(root.dataset.fpsLimit!==limit)root.dataset.fpsLimit=limit;
    if(fps||redraw)root.dataset.frameCost=cost.toFixed(2);
    if(!timer)queueTick(Math.max(0,(fps?1000/fps:240)-cost));
  }
  function schedule() {
    clearTimeout(timer);timer=0;
    cancelAnimationFrame(lyricFrameId);lyricFrameId=0;
    nextEffectFrame=0;
    nextSceneryFrame=0;
    if(!onScreen()||reducedMotion.matches)clearPreparedLyric();
    lastLyricPosition=NaN;
    lastFrame=lastPaint=0;backgroundDirty=true;
    root.dataset.fpsLimit='0';
    wake();
  }
  function setLegacy(value) { legacy=value;closeDialogs();root.hidden=value;back.hidden=!value;document.documentElement.classList.toggle('listening-enabled',!value);api.presentation(!value);if(!value){resize();updateUI(true);}schedule(); }
  function renderWorkQueue() {
    lastQueueRefresh=performance.now();
    const {queue,queueCount,queueScope,queueEntryId,customQueue}=api.snapshot({queue:true,queueLimit:4});
    const current=customQueue?queueEntryId:snapshot.track?.id;
    const key=[current,queueCount,queueScope,snapshot.ready,snapshot.external,snapshot.busy,
      ...queue.flatMap(track=>[queueId(track),track.name,track.artist,track.cover,track.kind])];
    if(key.length===workQueueKey.length&&key.every((value,index)=>value===workQueueKey[index]))return;
    workQueueKey=key;
    const list=$('[data-work-queue]'),focus=list.contains(document.activeElement)?document.activeElement.dataset.queueTrack:null;
    const rows=document.createDocumentFragment();
    for(const track of queue) {
      const item=document.createElement('li'),button=document.createElement('button');
      button.type='button';
      button.dataset.queueTrack=queueId(track);
      button.disabled=!snapshot.ready||snapshot.external||snapshot.busy;
      button.innerHTML='<span class="lr-preview-cover">'+icon('music')+'</span><span class="lr-preview-meta"><strong></strong><small></small></span><span class="lr-preview-state" aria-hidden="true">'+icon('sound')+'</span>';
      button.querySelector('strong').textContent=track.name;
      button.querySelector('small').textContent=track.artist||(track.kind==='demo'?'原创音景':track.kind==='online'?'汽水音乐':'本地音乐');
      if(queueId(track)===current)button.setAttribute('aria-current','true');
      const cover=track.cover||(track.kind==='demo'?demoCover:'');
      if(cover) {
        const image=new Image();
        image.alt='';image.decoding='async';image.referrerPolicy='no-referrer';image.hidden=true;
        image.onload=()=>image.hidden=false;
        image.src=cover;
        button.querySelector('.lr-preview-cover').append(image);
      }
      item.append(button);rows.append(item);
    }
    list.replaceChildren(rows);
    if(focus)list.querySelector('[data-queue-track="'+CSS.escape(focus)+'"]')?.focus({preventScroll:true});
    $('[data-queue-scope]').textContent=snapshot.ready?(queueScope||'当前播放范围')+' · '+queueCount+' 首':'正在读取队列';
    const note=$('[data-work-queue-note]');
    note.textContent=snapshot.external?'请在原播放器中切换歌曲':queueCount===1?'当前队列只有一首歌':!queueCount&&snapshot.ready?'当前播放范围没有歌曲':'';
    note.hidden=!note.textContent;
    $('[data-work-queue-add]').hidden=!snapshot.ready||snapshot.external||queueCount>1;
  }
  function queueId(track) { return track.entryId || track.id; }
  function makeQueueRow(track, index, role, roleLabel, editable, canDrag) {
    const row = document.createElement('li');
    row.className = 'lr-queue-row';
    row.dataset.queueEntry = queueId(track);
    row.dataset.queueSource = track.id;
    if (role) row.dataset.queueRole = role;
    row.innerHTML = `
      <span class="lr-queue-handle" data-queue-drag aria-hidden="true" title="拖动调整顺序">${icon('grip')}</span>
      <button type="button" class="lr-queue-song" data-queue-command="play"><span class="lr-queue-number"></span><span class="lr-queue-info"><strong></strong><small></small><span class="lr-queue-role" hidden></span></span></button>
      <div class="lr-queue-actions">
        <button type="button" class="lr-icon" data-queue-command="up">${icon('up')}</button>
        <button type="button" class="lr-icon" data-queue-command="down">${icon('down')}</button>
        <button type="button" class="lr-icon" data-queue-command="remove">${icon('close')}</button>
      </div>`;
    row.querySelector('.lr-queue-number').textContent = String(index + 1).padStart(2, '0');
    row.querySelector('strong').textContent = track.name;
    row.querySelector('small').textContent = track.artist || ({demo:'原创音景',online:'汽水音乐'}[track.kind] || '本地音乐');
    const roleBadge=row.querySelector('.lr-queue-role');
    roleBadge.textContent=roleLabel;
    roleBadge.hidden=!roleLabel;
    const handle = row.querySelector('[data-queue-drag]');
    if (canDrag) handle.draggable = true;
    else handle.hidden = true;
    const labels = {play:'播放',up:'上移',down:'下移',remove:'从队列移除'};
    const current = role==='current'||role==='retry';
    const unavailable = {play:false,up:index === 0,down:index === queueItems.length - 1,remove:current};
    for (const button of row.querySelectorAll('[data-queue-command]')) {
      const command = button.dataset.queueCommand;
      button.setAttribute('aria-label', `${labels[command]} ${track.name}`);
      button.title = current && command === 'remove' ? '切换到其他歌曲后可移除' : labels[command];
      button.disabled = !editable || unavailable[command];
      if (current && command === 'play') button.setAttribute('aria-current','true');
      if (role==='next' && command==='play') button.setAttribute('aria-describedby','roomQueueNextLabel');
    }
    return row;
  }
  function queueRowIndex(items,row) {
    if (!row) return -1;
    const {queueEntry,queueSource} = row.dataset;
    return items.findIndex(({track})=>queueId(track)===queueEntry || (queueEntry===queueSource&&track.id===queueSource));
  }
  function revealQueueRow(element) {
    if (!element) return;
    const row = element.closest('[data-queue-entry]') || element;
    const bounds = row.getBoundingClientRect();
    const top = queueList.getBoundingClientRect().top + queueList.clientTop;
    const inset = 4;
    if (bounds.top < top + inset) queueList.scrollTop += bounds.top - top - inset;
    else if (bounds.bottom > top + queueList.clientHeight - inset) {
      queueList.scrollTop += bounds.bottom - top - queueList.clientHeight + inset;
    }
  }
  function renderQueueSummary(state, currentIndex, nextIndex, mode) {
    const current = queueItems[currentIndex], next = queueItems[nextIndex];
    $('[data-queue-summary]').hidden=!state.ready;
    const currentLabel=state.external?'外部播放':state.playbackRecovery?'待重试':state.queueTarget?'正在加载':state.playing?'正在播放':'当前曲目';
    $('[data-queue-current-label]').textContent=currentLabel;
    const currentTrack=state.external?state.track:state.queueTarget||current||state.track;
    const currentTitle = state.playbackRecovery?.name||currentTrack?.name||'尚未选曲';
    const repeatsCurrent = mode==='single'||mode==='list'&&queueItems.length===1;
    const nextTitle = state.external?'由原播放器控制':!current?'尚未排定':mode==='shuffle'?'随机选择':
      repeatsCurrent?'重复当前曲目':next?.name||'已到队列末尾';
    for(const [selector,title] of [
      ['[data-queue-current-title]',currentTitle],['[data-queue-next-title]',nextTitle],
      ['[data-queue-current-artist]',currentTrack?.artist||''],['[data-queue-next-artist]',next?.artist||''],
    ]) {
      const element=$(selector);
      if(element.textContent!==title){element.textContent=title;element.title=title;}
      if(element.matches('.lr-queue-track-artist'))element.hidden=!title;
    }
    return currentLabel;
  }
  function renderQueue({ locateCurrent = false, resetScroll = false } = {}) {
    const state = api.snapshot({queue:true});
    queueItems = state.queue || [];
    const query = queueSearch.value.trim().toLocaleLowerCase();
    const current = state.external ? null : state.customQueue ? state.queueEntryId : state.queueTarget?.id||state.playbackRecovery?.trackId||state.track?.id;
    const currentIndex = queueItems.findIndex(track=>queueId(track)===current);
    const mode = state.playbackMode || 'list';
    let nextIndex = -1;
    if (currentIndex>=0 && (mode==='sequence'||mode==='list')) {
      if (currentIndex+1<queueItems.length) nextIndex=currentIndex+1;
      else if (mode==='list' && queueItems.length>1) nextIndex=0;
    }
    const currentLabel=renderQueueSummary(state,currentIndex,nextIndex,mode);
    const editable = state.ready && !state.busy && !state.external;
    renderRecoveryPanel($('[data-queue-recovery]'),state,queueSearch);
    const filtered = queueItems.map((track,index)=>({track,index})).filter(({track})=>
      !query || [track.name,track.artist,track.album].join(' ').toLocaleLowerCase().includes(query));
    const focusedButton = queueList.contains(document.activeElement) ? document.activeElement : null;
    const focusRow = focusedButton?.closest('[data-queue-entry]');
    const focusIndex = queueRowIndex(filtered,focusRow);
    const nearbyIndex = focusIndex < 0 ? queueRowIndex(filtered,focusRow?.nextElementSibling || focusRow?.previousElementSibling) : focusIndex;
    if (locateCurrent) queuePage = Math.floor(Math.max(0,filtered.findIndex(({track})=>queueId(track)===current))/queuePageSize);
    else if (focusIndex >= 0) queuePage = Math.floor(focusIndex/queuePageSize);
    const totalPages = Math.max(1,Math.ceil(filtered.length/queuePageSize));
    queuePage = Math.min(queuePage,totalPages - 1);
    const first = queuePage * queuePageSize;
    const rows = document.createDocumentFragment();
    for (const {track,index} of filtered.slice(first,first + queuePageSize)) {
      const role=index===currentIndex?(state.playbackRecovery?'retry':'current'):index===nextIndex?'next':'';
      const roleLabel=index===currentIndex?currentLabel:role==='next'?'下一首':'';
      rows.append(makeQueueRow(track,index,role,roleLabel,editable,editable && !query && queueItems.length>1));
    }
    if (!filtered.length) {
      const empty = document.createElement('li');
      empty.className = 'lr-queue-empty';
      empty.textContent = query ? '没有找到匹配的歌曲。' : '队列为空，可从曲库加入歌曲。';
      rows.append(empty);
    }
    const scroll = queueList.scrollTop;
    queueList.replaceChildren(rows);
    queueList.scrollTop = resetScroll ? 0 : scroll;
    if (focusedButton) {
      const track = filtered[nearbyIndex]?.track;
      const row = track ? queueList.querySelector(`[data-queue-entry="${CSS.escape(queueId(track))}"]`) : null;
      const command = focusedButton.dataset.queueCommand || 'play';
      const replacement = row?.querySelector(`[data-queue-command="${CSS.escape(command)}"]:enabled`) || row?.querySelector('button:enabled') || queueSearch;
      replacement.focus({preventScroll:true});
      if (replacement !== queueSearch) revealQueueRow(replacement);
    }
    const count = state.queueCount ?? queueItems.length;
    const scope = state.external?'外部播放器':state.queueScope || '当前播放范围';
    const source=$('[data-queue-source-label]');
    if(source.textContent!==scope){source.textContent=scope;source.title=scope;}
    $('[data-queue-count]').textContent = `${query ? `${filtered.length} / ` : ''}${count} 首${state.customQueue && !scope.includes('临时队列') ? ' · 临时队列' : ''}`;
    $('[data-queue-pages]').hidden = totalPages === 1;
    $('[data-queue-page-label]').textContent = `${queuePage + 1} / ${totalPages}`;
    $('[data-queue-page="-1"]').disabled = queuePage === 0;
    $('[data-queue-page="1"]').disabled = queuePage >= totalPages - 1;
  }
  function refreshOpenQueue(force=false) {
    if (!queueDialog.open || draggedEntry) return;
    const {queueRevision,queueEntryId,ready,busy,external,track,onlineLoggedIn,onlineReady,playbackMode,playing,queueTarget,playbackRecovery}=snapshot;
    const key = [queueRevision,queueEntryId,ready,busy,external,track?.id,onlineLoggedIn,onlineReady,playbackMode,playing,
      queueTarget?.id,queueTarget?.name,queueTarget?.artist,playbackRecovery?.trackId,playbackRecovery?.reason,playbackRecovery?.phase,playbackRecovery?.canSkip,playbackRecovery?.exhausted];
    if (!force && key.every((value,index)=>value===queueDialogKey[index])) return;
    queueDialogKey = key;
    renderQueue();
  }
  async function runQueueAction(action) {
    try {
      await action();
      updateUI(true);
    } catch (error) {
      notify(error.message || '操作没有完成，请重试。',true);
    }
  }
  function queueCommand(button) {
    const id = button.closest('[data-queue-entry]').dataset.queueEntry;
    const command = button.dataset.queueCommand;
    if (command==='play') return runQueueAction(()=>api.selectQueueEntry(id));
    if (command==='remove') return runQueueAction(()=>api.removeQueueEntry(id));
    const index = queueItems.findIndex(track=>queueId(track)===id);
    if (index < 0) return;
    const neighbor = queueItems[index + (command==='up' ? -1 : 2)];
    return runQueueAction(()=>api.moveQueueEntry(id,neighbor ? queueId(neighbor) : null));
  }
  function indicateQueueDrop(row, location) {
    if (dropTarget?.row === row && dropTarget.location === location) return;
    if (dropTarget) delete dropTarget.row.dataset.drop;
    dropTarget = row ? {row,location} : null;
    if (dropTarget) dropTarget.row.dataset.drop = location;
  }
  function endQueueDrag() {
    const row = queueList.querySelector('[data-dragging]');
    if (row) delete row.dataset.dragging;
    draggedEntry = null;
    indicateQueueDrop(null);
  }
  queueList.addEventListener('dragstart',event=>{
    const handle = event.target.closest('[data-queue-drag]');
    if (!handle?.draggable || !event.dataTransfer) return;
    const row = handle.closest('[data-queue-entry]');
    draggedEntry = row.dataset.queueEntry;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain',draggedEntry);
    row.dataset.dragging = 'true';
  });
  queueList.addEventListener('dragover',event=>{
    if (!draggedEntry) return;
    const row = event.target.closest('[data-queue-entry]');
    if (!row || row.dataset.queueEntry === draggedEntry) {
      indicateQueueDrop(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const bounds = row.getBoundingClientRect();
    indicateQueueDrop(row,event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after');
  });
  queueList.addEventListener('dragleave',event=>{
    if (!queueList.contains(event.relatedTarget)) indicateQueueDrop(null);
  });
  queueList.addEventListener('drop',event=>{
    if (!draggedEntry || !dropTarget) return;
    event.preventDefault();
    const draggedId = draggedEntry;
    const {row,location} = dropTarget;
    const index = queueItems.findIndex(track=>queueId(track)===row.dataset.queueEntry);
    endQueueDrag();
    if (index < 0) return;
    const neighbor = queueItems[index + (location==='after' ? 1 : 0)];
    const before = neighbor ? queueId(neighbor) : null;
    if (before === draggedId) return;
    runQueueAction(()=>api.moveQueueEntry(draggedId,before));
  });
  queueList.addEventListener('dragend',()=>{endQueueDrag();refreshOpenQueue();});
  queueDialog.addEventListener('close',()=>{
    endQueueDrag();
    if(queueDialog.open)return;
    const otherDialog=document.querySelector('dialog[open]');
    if(toast.parentElement===queueDialog&&!toast.hidden)(otherDialog||root).append(toast);
    const focused=document.activeElement;
    if(!otherDialog&&(focused===document.body||queueDialog.contains(focused)))queueOpener?.focus({preventScroll:true});
    queueOpener=null;
  });
  const actions={
    continue:()=>api.continueListening(),play:()=>api.toggle(),'demo-play':()=>api.toggle(),previous:()=>api.previous(),next:()=>api.next(),favorite:()=>api.favorite(),repeat:()=>api.cyclePlayback(),
    'playback-retry':()=>api.retryPlayback(),
    'playback-skip':()=>api.skipPlayback(),
    import:()=>api.importMusic(),folder:()=>api.importFolder(),
    home:()=>{closeDialogs();if(preferences.mode==='work')window.scrollTo(0,0);else setMode('work');},
    library:()=>{closeDialogs();setMode('library');},
    search:()=>{closeDialogs();setMode('search');musicLibrary.focusSearch();},
    online:()=>{
      closeDialogs();
      const mode=root.dataset.mode;
      api.openOnline(isLibraryMode(mode)?musicLibrary.searchQuery():undefined,{searchOnly:mode==='search'});
    },
    discovery:()=>{closeDialogs();api.openDiscovery(root);},equalizer:()=>{closeDialogs();window.SonicEqualizer.open();},
    'desktop-lyrics-window':async()=>{
      if(!desktop?.desktopLyrics)return;
      publishPlayerState();const result=await desktop.desktopLyrics();
      if(!result?.ok&&result?.message)notify(result.message,true);
    },
    settings:()=>show($('[data-settings]')),lyrics:()=>{closeDialogs();api.editLyrics();},listen:()=>setLyricExpanded(true),
    'now-playing':()=>setMode('listen'),
    'full-lyrics':()=>setLyricExpanded(true,true),
    'enter-immersion':entry=>setListeningImmersion(true,entry),
    'exit-immersion':()=>setListeningImmersion(false),
    'visual-stage':()=>{if(scenes){setMode('visual');$('[data-action="scene-gallery"]').focus({preventScroll:true});}},
    'expand-lyrics':()=>setLyricExpanded(true),'collapse-lyrics':()=>setLyricExpanded(false),'lyric-mods':()=>lyricMods?.open(),
    'lyric-effects':()=>show(effectDialog),
    'retry-lyrics':()=>api.retryOnlineLyrics(),
    'scene-gallery':openSceneGallery,'scene-pin':toggleScenePin,
    'beat-clock':()=>{preferences.beatClock=!preferences.beatClock;applyPreferences(true);},
    'playback-settings':async()=>{
      const select=$('[data-output-device]'), current=api.playbackSettings();
      $('[data-playback-rate]').value=String(current.rate);
      if(!current.sleepDeadline)$('[data-sleep-timer]').value='0';
      $('[data-playback-status]').textContent=current.sleepDeadline?'将在 '+new Date(current.sleepDeadline).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' 暂停。':'定时停止只控制声波宇宙里的播放。';
      $('[data-playback-rate]').disabled=snapshot.external;
      select.disabled=true;show($('[data-playback-dialog]'));
      try{
        const devices=await api.audioOutputs();
        select.replaceChildren(new Option('系统默认',''),...(devices||[]).map((device,index)=>new Option(device.label||'输出设备 '+(index+1),device.deviceId)));
        select.value=devices?.some(device=>device.deviceId===current.output)?current.output:'';
        select.disabled=snapshot.external||!devices;
      }catch(error){$('[data-playback-status]').textContent=error.message||'暂时无法读取输出设备。';}
    },
    queue:button=>{
      if(queueDialog.open)return;
      queueOpener=button;
      queueSearch.value='';
      renderQueue({locateCurrent:true,resetScroll:true});
      show(queueDialog);
      if(!toast.hidden)queueDialog.append(toast);
      queueDialog.scrollTop=0;
      revealQueueRow(queueList.querySelector('[aria-current=true]'));
    },
    'queue-retry':()=>runQueueAction(()=>{
      const state=api.snapshot();
      if(state.playbackRecovery?.reason==='auth'&&!state.onlineLoggedIn)queueDialog.close();
      return api.retryPlayback();
    }),
    'queue-skip':()=>runQueueAction(()=>api.skipPlayback()),
    external:()=>{updateUI();show($('[data-external-dialog]'));},legacy:()=>setLegacy(true),
    fullscreen:toggleFullscreen,
    mini:()=>desktop?.mini(),desktop:async()=>{if(!desktop)return;const settings=await desktop.settings();$('[data-startup]').checked=settings.startup;show($('[data-desktop-dialog]'));},
  };
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled||button.matches('.lr-recovery-actions [aria-disabled=true]'))return;
    if(button.hasAttribute('data-home-resume')&&button.getAttribute('aria-disabled')==='true')return;
    if(button.dataset.recentTrack){
      const id=button.dataset.recentTrack;
      if(!snapshot.busy&&!(snapshot.playing&&snapshot.track?.id===id)){
        Promise.resolve(api.playFromLibrary(id,'recent',true,recentTracks.map(track=>track.id)))
          .catch(error=>notify(error.message||'暂时无法播放，请重试。',true));
      }
      return;
    }
    if(button.hasAttribute('data-close')){button.closest('dialog').close();return;}
    if(button.dataset.lyricAdjust){
      if(api.nudgeLyrics(Number(button.dataset.lyricAdjust))!==null){updateUI(true,true);if(desktop)publishPlayerState();}
      return;
    }
    if(button.dataset.queueCommand){queueCommand(button);return;}
    if(button.dataset.queuePage){queuePage+=Number(button.dataset.queuePage);renderQueue({resetScroll:true});return;}
    if(button.dataset.queueTrack){
      runQueueAction(()=>api.selectQueueEntry(button.dataset.queueTrack));
      return;
    }
    if(button.hasAttribute('data-lyric-index')) {
      const line=snapshot.lyrics[Number(button.dataset.lyricIndex)];
      if(line)seekLyrics(line.time);
      return;
    }
    if(button.dataset.roomMode){setMode(button.dataset.roomMode);return;}
    if(button.dataset.sceneFilter){filterScenes(button.dataset.sceneFilter);return;}
    if(button.dataset.sceneSelect){selectScene(button.dataset.sceneSelect);return;}
    if(button.dataset.effectChoice){
      readingFullLyrics=false;
      lyricMods?.clear();
      preferences.lyricStyle='effects';preferences.lyricEffect=effects.get(button.dataset.effectChoice).id;
      effectDialog.close();applyPreferences(true);
      return;
    }
    if(button.dataset.lyricStyle){readingFullLyrics=false;lyricMods?.clear();preferences.lyricStyle=button.dataset.lyricStyle;applyPreferences(true);return;}
    if(button.dataset.background){preferences.background=button.dataset.background;preferences.reactiveBackdrop=false;applyPreferences(true);return;}
    if(button.dataset.color){preferences.color=button.dataset.color;applyPreferences(true);return;}
    const action=actions[button.dataset.action];if(action)Promise.resolve(action(button)).catch(error=>notify(error.message||'操作没有完成，请重试。'));
  });
  root.addEventListener('pointermove',revealStageChrome,{passive:true});
  root.addEventListener('pointerdown',revealStageChrome,{passive:true});
  root.addEventListener('keydown',revealStageChrome);
  root.addEventListener('pointermove',event=>{
    if(event.pointerType!=='touch')revealListeningControls();
  },{passive:true});
  root.addEventListener('pointerdown',()=>{
    immersionKeyboard=false;
    revealListeningControls();
  },{passive:true});
  root.addEventListener('focusin',revealListeningControls);
  root.addEventListener('focusout',()=>queueMicrotask(revealListeningControls));
  root.addEventListener('close',revealListeningControls,true);
  playerDock.addEventListener('pointerleave',revealListeningControls);
  exitImmersion.addEventListener('pointerleave',revealListeningControls);
  for(const key of ['brightness','response'])$('[data-'+key+']').addEventListener('input',event=>{preferences[key]=Number(event.target.value);$('[data-'+key+'-value]').textContent=preferences[key]+'%';fill(event.target);persist();backgroundDirty=true;wake();});
  $('[data-desktop-lyrics]').addEventListener('change',event=>{preferences.desktopLyrics=event.target.checked;applyPreferences(true);});
  $('[data-beat-ratio]').addEventListener('change',event=>{preferences.beatRatio=Number(event.target.value);applyPreferences(true);});
  $('[data-output-device]').addEventListener('change',async event=>{
    const select=event.target;select.disabled=true;
    try{if(await api.setAudioOutput(select.value))$('[data-playback-status]').textContent='已切换输出设备。';}
    catch(error){select.value=api.playbackSettings().output;$('[data-playback-status]').textContent=error.message||'切换设备失败。';}
    finally{select.disabled=snapshot.external;}
  });
  $('[data-playback-rate]').addEventListener('change',event=>{
    if(!api.setPlaybackRate(Number(event.target.value)))event.target.value=String(api.playbackSettings().rate);
  });
  $('[data-sleep-timer]').addEventListener('change',event=>{
    const minutes=Number(event.target.value);api.setSleepTimer(minutes);
    $('[data-playback-status]').textContent=minutes?minutes+' 分钟后暂停声波宇宙的播放。':'已关闭定时停止。';
  });
  $('[data-energy]').addEventListener('change',event=>{preferences.energySaver=event.target.checked;applyPreferences(true);});
  $('[data-scene-backdrop]').addEventListener('change',event=>{preferences.reactiveBackdrop=event.target.checked;applyPreferences(true);});
  sceneDialog.addEventListener('close',()=>{backgroundDirty=true;if(!usesReactiveScene())$('[data-background-label]').textContent=backgroundNames[preferences.background];wake();});
  seekSlider.addEventListener('pointerdown',event=>{
    if(event.isPrimary&&event.button===0){
      const state=api.snapshot(), target=seekTarget(state);
      if(!target)return;
      seekPointer={id:event.pointerId,target,released:false};
      previewSeek(target,state);
    }
  });
  seekSlider.addEventListener('input',()=>{
    const state=api.snapshot();
    const target=seekPointer?seekPointer.target:seekPreview||seekTarget(state);
    if(!matchesSeek(target,state)){
      if(seekPointer)seekPointer.target=null;
      seekPreview=null;
      updateUI(false,true,state);
      return;
    }
    previewSeek(target,state);
  });
  seekSlider.addEventListener('keydown',event=>{
    if(event.altKey||event.ctrlKey||event.metaKey||!['ArrowLeft','ArrowRight','ArrowDown','ArrowUp'].includes(event.key))return;
    event.preventDefault();
    stepSeek(event.key==='ArrowLeft'||event.key==='ArrowDown'?-5:5);
  });
  seekSlider.addEventListener('change',()=>{
    if(seekPointer&&!seekPointer.released)return;
    seekPointer=null;
    const target=seekPreview;
    if(!target)return;
    seekPreview=null;
    commitSeek(target);
  });
  window.addEventListener('pointerup',event=>{
    const pointer=seekPointer;
    if(pointer?.id!==event.pointerId)return;
    pointer.released=true;
    // Touch can lose capture before change, and an unchanged value emits no change.
    setTimeout(()=>{
      if(seekPointer!==pointer)return;
      seekPointer=null;
      cancelSeek();
      revealListeningControls();
    },0);
  },true);
  function abandonSeekPointer(event) {
    if(seekPointer?.id!==event.pointerId)return;
    if(event.type==='lostpointercapture'&&seekPointer.released)return;
    seekPointer=null;
    cancelSeek();
    revealListeningControls();
  }
  seekSlider.addEventListener('pointercancel',abandonSeekPointer);
  seekSlider.addEventListener('lostpointercapture',abandonSeekPointer);
  seekSlider.addEventListener('blur',cancelSeek);
  window.addEventListener('blur',cancelSeek);
  volumeSlider.addEventListener('input',()=>{
    volumeChanging=true;
    api.setVolume(Number(volumeSlider.value)/100);
    fill(volumeSlider);
    revealListeningControls();
  });
  function releaseVolume() {
    volumeChanging=false;
    revealListeningControls();
  }
  volumeSlider.addEventListener('change',releaseVolume);
  volumeSlider.addEventListener('pointercancel',releaseVolume);
  volumeSlider.addEventListener('lostpointercapture',releaseVolume);
  queueSearch.addEventListener('input',()=>{queuePage=0;renderQueue({resetScroll:true});});
  $('[data-connect]').addEventListener('click',async()=>{try{if(desktop)await desktop.authorizeCapture();await api.connectExternal();updateUI();if(!api.snapshot().external)notify(document.getElementById('externalStatus')?.textContent||'没有接入声音，请重新选择带声音的来源。');}catch(error){notify(error.message||'未能连接声音。');}});
  $('[data-disconnect]').addEventListener('click',()=>{api.stopExternal();updateUI();});
  $('[data-external-source]').addEventListener('change',event=>{api.selectExternalMetadata(event.target.value);updateExternalMetadataUI();});
  async function applyExternalLyrics(action,loading){
    const request=++externalLyricsJob,status=$('[data-external-lyrics-status]');
    status.textContent=loading;
    try{
      const result=await action();
      if(request===externalLyricsJob)status.textContent=result.message;
      updateUI();
    }catch(error){if(request===externalLyricsJob)status.textContent=error.message||'暂时无法载入歌词。';}
    finally{
      if(request===externalLyricsJob){$('[data-external-find-lyrics]').removeAttribute('aria-busy');updateExternalMetadataUI();}
    }
  }
  $('[data-external-find-lyrics]').addEventListener('click',event=>{
    event.currentTarget.setAttribute('aria-busy','true');updateExternalMetadataUI();
    applyExternalLyrics(()=>api.findExternalLyrics(),'正在按歌名、歌手和时长匹配…');
  });
  $('[data-external-lyrics-file]').addEventListener('change',event=>{
    const file=event.currentTarget.files[0];event.currentTarget.value='';
    if(file)applyExternalLyrics(()=>api.importExternalLyrics(file),'正在读取歌词文件…');
  });
  back.addEventListener('click',()=>setLegacy(false));
  window.addEventListener('sonic:toast',event=>notify(event.detail.message,event.detail.error));
  window.addEventListener('sonic:library-search',event=>{
    closeDialogs();setMode(event.detail.searchOnly?'search':'library');musicLibrary.searchLocal(event.detail.query);
  });
  window.addEventListener('sonic:transport-state',()=>{
    if(onScreen()){
      const current=api.snapshot();
      if(!samePlayback(snapshot,current)||listenImmersive&&lyricsPlaying(snapshot)!==lyricsPlaying(current))updateUI(false,true,current);
    }
    wake();
  });
  window.addEventListener('sonic:queue-change',()=>{lastQueueRefresh=-Infinity;wake();});
  window.addEventListener('sonic:library-change',()=>{recentShelfDirty=true;lastQueueRefresh=-Infinity;refreshOpenQueue(true);wake();});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      cancelSeek();
      clearTimeout(immersionTimer);
    }else revealListeningControls();
    schedule();
  });
  window.addEventListener('resize',()=>{reserveDockSpace();resize();schedule();});
  reducedMotion.addEventListener('change',()=>{
    if(reducedMotion.matches){coverMotion?.cancel();lyricViewMotion?.cancel();}
    if(showsLyricEffects()&&onScreen())renderListeningPosition(lyricPosition(),true);
    schedule();
  });
  document.fonts?.addEventListener('loadingdone',()=>{invalidateLyricSurface();wake();});
  document.addEventListener('keydown',event=>{
    const dialogOpen=document.querySelector('dialog[open]');
    if(seekPreview&&event.key==='Escape'&&!event.defaultPrevented&&!dialogOpen){
      event.preventDefault();
      if(!event.repeat)cancelSeek();
      return;
    }
    if(listenImmersive&&!legacy&&!event.defaultPrevented&&!dialogOpen){
      if(event.key==='Escape'&&!event.repeat){
        event.preventDefault();
        setListeningImmersion(false);
        return;
      }
      immersionKeyboard=true;
      revealListeningControls();
    }
    if(event.key==='Escape'&&desktop?.fullscreen&&root.dataset.fullscreen==='true'&&!event.defaultPrevented&&!dialogOpen){
      event.preventDefault();
      if(!event.repeat)void toggleFullscreen();
      return;
    }
    if(legacy||event.defaultPrevented||event.repeat||/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)||dialogOpen||event.ctrlKey||event.altKey||event.metaKey)return;
    if(event.key==='Tab')return;
    const key=event.key.toLowerCase();
    if(key==='l'){event.preventDefault();setMode(preferences.mode==='work'?'listen':'work');}
    else if(event.code==='Space'&&!event.target.closest('button')){event.preventDefault();if(!snapshot.external)api.toggle();}
    else if(key==='arrowleft'||key==='arrowright'){event.preventDefault();stepSeek(key==='arrowright'?5:-5);}
    else if(key==='f'){event.preventDefault();actions.fullscreen();}
  });
  new MutationObserver(()=>api.refreshLegacy()).observe(document.getElementById('app'),{subtree:true,attributes:true,attributeFilter:['open']});
  let nativeTimer=0;
  if(desktop) {
    const releaseSettings=$('[data-desktop-dialog]');
    releaseSettings.insertAdjacentHTML('beforeend','<div class="lr-choice-row"><button class="lr-choice" data-check-release>检查更新</button><button class="lr-choice" data-open-release>打开发布页</button><button class="lr-primary" data-download-release hidden>下载新版</button></div><p class="lr-status" data-release-status role="status"></p>');
    const showRelease=result=>{
      if(!result)return;
      $('[data-download-release]').hidden=!result.available?.installer;
      $('[data-release-status]').textContent=(result.error?'暂时无法检查更新。可打开发布页查看新版。':'')||(result.available?'发现新版 '+result.available.version+'。':'当前版本 '+result.current+'，未发现更新的公开版。');
      $('[data-action="desktop"]').textContent=result.available?'桌面设置 · 有更新':'桌面设置';
    };
    $('[data-check-release]').addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;$('[data-release-status]').textContent='正在检查…';
      try{showRelease(await desktop.checkRelease());}
      catch{$('[data-release-status]').textContent='暂时无法检查更新。可打开发布页查看新版。';}
      finally{button.disabled=false;}
    });
    $('[data-open-release]').addEventListener('click',()=>desktop.openUpdate().catch(()=>notify('暂时无法打开发布页。',true)));
    $('[data-download-release]').addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;$('[data-release-status]').textContent='正在准备下载…';
      try{$('[data-release-status]').textContent=(await desktop.downloadUpdate()).message;}
      catch{$('[data-release-status]').textContent='暂时无法下载新版本。';}
      finally{button.disabled=false;}
    });
    setTimeout(()=>desktop.checkRelease?.().then(result=>{if(result?.available)showRelease(result);}).catch(()=>{}),8000);
    $$('[data-desktop-only]').forEach(element=>element.hidden=false);
    if(lyricMods?.current())preferences.lyricStyle=lyricMods.current().layout;
    desktop.onDesktopLyricsState?.(visible=>$('[data-action="desktop-lyrics-window"]').setAttribute('aria-pressed',String(visible)));
    desktop.onCommand(command=>{
      if(command==='work'||command==='listen'){if(legacy)setLegacy(false);setMode(command);}
      else if(command==='show'){if(legacy)setLegacy(false);}
      else if(actions[command])Promise.resolve(actions[command]()).then(publishPlayerState).catch(error=>notify(error.message));
    });
    desktop.onVisibility(value=>{if(occluded===value){occluded=!value;schedule();}});
    $('[data-startup]').addEventListener('change',async event=>{const result=await desktop.setStartup(event.target.checked);if(!result.ok){event.target.checked=!event.target.checked;notify(result.message);}});
    nativeTimer=setInterval(publishPlayerState,400);
  }
  window.SonicListeningRoom=Object.freeze({setMode,show:()=>setLegacy(false),settings:()=>({...preferences}),stats:()=>({frameCost:Number(root.dataset.frameCost||0),frames:renderedFrames,fpsLimit:Number(root.dataset.fpsLimit||0),legacyRendering:document.getElementById('app').dataset.rafRunning==='true',wallpaper:false,lyricRenderer:effectRenderer?.stats()})});
  api.presentation(true);document.documentElement.classList.add('listening-enabled');applyPreferences();
  if(new URLSearchParams(location.search).get('interface')==='legacy')setLegacy(true);
  window.addEventListener('pagehide',()=>{clearTimeout(timer);cancelAnimationFrame(lyricFrameId);clearTimeout(toastTimer);clearTimeout(stageChromeTimer);clearTimeout(immersionTimer);clearInterval(nativeTimer);});
})();
