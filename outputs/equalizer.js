(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SonicEqualizer = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';

  const storageKey = 'sonic-universe-equalizer';
  const bands = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const presets = {
    flat: { name: '平直', gains: bands.map(() => 0) },
    bass: { name: '低音增强', gains: [5, 5, 4, 2, 0, -1, -1, 0, 0, 0] },
    vocal: { name: '人声清晰', gains: [-3, -2, -1, 0, 1, 3, 4, 2, 0, -1] },
    rock: { name: '摇滚', gains: [4, 3, 2, -1, -2, 0, 2, 3, 3, 2] },
    acoustic: { name: '原声', gains: [2, 2, 1, 1, 0, 1, 2, 2, 1, 1] },
    night: { name: '夜间柔和', gains: [-4, -3, -1, 0, 1, 1, 0, -1, -2, -3] },
  };
  const graphs = new WeakMap();
  const updateGraphs = new Set();
  let state = { enabled: false, gains: [...presets.flat.gains] };
  let dialog = null;
  let refreshDialog;
  let storageError = false;

  function gainValue(value) {
    return Number.isFinite(value) ? Math.round(Math.max(-12, Math.min(12, value)) * 2) / 2 : 0;
  }

  try {
    const saved = JSON.parse(root.localStorage.getItem(storageKey));
    if (saved?.version === 1 && Array.isArray(saved.gains)) {
      state = { enabled: saved.enabled === true, gains: bands.map((_, index) => gainValue(saved.gains[index])) };
    }
  } catch {
    // The equalizer remains available for this playback session.
  }

  function setState(next) {
    state = next;
    for (const update of updateGraphs) update();
    try {
      root.localStorage.setItem(storageKey, JSON.stringify({ version: 1, ...state }));
      storageError = false;
    } catch {
      storageError = true;
    }
    refreshDialog?.();
  }

  function create(context) {
    const existing = graphs.get(context);
    if (existing) return existing;

    const input = context.createGain();
    const output = context.createGain();
    const filters = bands.map(frequency => {
      const filter = context.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = Math.min(frequency, context.sampleRate * .48);
      filter.Q.value = 1.4;
      return filter;
    });
    const chain = [input, ...filters, output];
    chain.slice(1).forEach((node, index) => chain[index].connect(node));

    function apply(immediate = false) {
      const gains = state.enabled ? state.gains : presets.flat.gains;
      const boosts = gains.map(gain => Math.max(0, gain));
      // Neighbouring bands also affect the signal near a boosted band.
      const headroom = Math.max(...boosts.map((boost, index) =>
        boost + .3 * ((boosts[index - 1] || 0) + (boosts[index + 1] || 0))));
      const now = context.currentTime;
      function set(parameter, value) {
        if (immediate) parameter.value = value;
        else {
          parameter.cancelScheduledValues(now);
          parameter.setTargetAtTime(value, now, .025);
        }
      }
      filters.forEach((filter, index) => set(filter.gain, gains[index]));
      set(output.gain, 10 ** (-headroom / 20));
    }

    const graph = Object.freeze({ input, output });
    apply(true);
    const update = () => apply();
    updateGraphs.add(update);
    context.addEventListener('statechange', () => {
      if (context.state === 'closed') updateGraphs.delete(update);
    });
    graphs.set(context, graph);
    return graph;
  }

  function formatFrequency(hz) {
    return hz < 1000 ? `${hz} Hz` : `${hz / 1000} kHz`;
  }

  function formatGain(gain) {
    return `${gain > 0 ? '+' : ''}${gain} dB`;
  }

  function makeDialog() {
    const document = root.document;
    const element = document.createElement('dialog');
    element.className = 'sonic-eq';
    element.setAttribute('aria-labelledby', 'sonic-eq-heading');
    element.innerHTML = `
      <header class="sonic-eq-header">
        <h2 id="sonic-eq-heading">均衡器</h2>
        <button type="button" class="sonic-eq-close" aria-label="关闭均衡器">×</button>
      </header>
      <div class="sonic-eq-controls">
        <label class="sonic-eq-enable"><input type="checkbox" autofocus>开启均衡器</label>
        <label class="sonic-eq-preset">预设 <select aria-label="均衡器预设"></select></label>
      </div>
      <fieldset class="sonic-eq-bands" aria-label="十段频率增益"></fieldset>
      <footer class="sonic-eq-footer">
        <button type="button" class="sonic-eq-reset">重置为平直</button>
        <p class="sonic-eq-status" role="status" hidden></p>
      </footer>`;

    const enabled = element.querySelector('input');
    const preset = element.querySelector('select');
    const fieldset = element.querySelector('fieldset');
    const status = element.querySelector('.sonic-eq-status');
    const custom = new root.Option('自定义', 'custom');
    custom.disabled = true;
    preset.add(custom);
    for (const [id, entry] of Object.entries(presets)) preset.add(new root.Option(entry.name, id));

    const sliders = bands.map((frequency, index) => {
      const label = document.createElement('label');
      label.className = 'sonic-eq-band';
      const value = document.createElement('output');
      const name = document.createElement('span');
      name.textContent = formatFrequency(frequency);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '-12';
      slider.max = '12';
      slider.step = '0.5';
      slider.setAttribute('aria-label', `${name.textContent} 增益`);
      slider.addEventListener('input', () => {
        const gains = [...state.gains];
        gains[index] = gainValue(slider.valueAsNumber);
        setState({ ...state, gains });
      });
      label.append(value, slider, name);
      fieldset.append(label);
      return { slider, value };
    });

    refreshDialog = () => {
      enabled.checked = state.enabled;
      element.dataset.enabled = String(state.enabled);
      preset.value = Object.keys(presets).find(id => presets[id].gains.every((gain, index) => gain === state.gains[index])) || 'custom';
      sliders.forEach(({ slider, value }, index) => {
        const gain = state.gains[index];
        slider.value = String(gain);
        slider.setAttribute('aria-valuetext', formatGain(gain));
        value.textContent = formatGain(gain);
      });
      status.hidden = !storageError;
      status.textContent = storageError ? '本机存储不可用，设置已应用到当前会话。' : '';
    };

    enabled.addEventListener('change', () => setState({ ...state, enabled: enabled.checked }));
    preset.addEventListener('change', () => {
      const entry = presets[preset.value];
      if (entry) setState({ enabled: true, gains: [...entry.gains] });
    });
    element.querySelector('.sonic-eq-reset').addEventListener('click', () =>
      setState({ ...state, gains: [...presets.flat.gains] }));
    element.querySelector('.sonic-eq-close').addEventListener('click', () => element.close());
    document.body.append(element);
    refreshDialog();
    return element;
  }

  function open() {
    dialog ||= makeDialog();
    if (!dialog.open) dialog.showModal();
  }

  return Object.freeze({ create, open });
});
