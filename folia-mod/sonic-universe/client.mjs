import { createRenderer, SCENES } from './src/renderer.mjs';

const label = (zhCN, en) => ({ 'zh-CN': zhCN, en });

const setSizeFromElement = (container) => {
  const rect = container.getBoundingClientRect?.();
  return {
    width: rect?.width || container.clientWidth || 1,
    height: rect?.height || container.clientHeight || 1,
  };
};

export function mountSonicUniverse(_folium, container, context) {
  const renderer = createRenderer({ container, host: context });
  const changeDisposer = context.onChange(() => renderer.syncContext());
  const resizeDisposer = context.onResize((size) => renderer.resize(size));
  const frameDisposer = context.onFrame((timestamp) => renderer.render(timestamp));

  renderer.resize(setSizeFromElement(container));

  return () => {
    frameDisposer?.();
    resizeDisposer?.();
    changeDisposer?.();
    renderer.dispose();
  };
}

export default function activate(folium) {
  folium.registries.backgrounds.register({
    id: 'music-stars',
    label: label('声波宇宙', 'Sonic Universe'),
    order: 420,
    mount: (container, context) => mountSonicUniverse(folium, container, context),
    settings: [
      {
        key: 'scene',
        type: 'select',
        label: label('宇宙场景', 'Universe scene'),
        description: label(
          '自动轮换会约每 36 秒换一次场景；手动选择后保持当前场景。',
          'Auto changes the scene about every 36 seconds. A manual choice remains fixed.',
        ),
        group: label('星空形态', 'Scene'),
        defaultValue: 'auto',
        options: [
          { value: 'auto', label: label('自动轮换', 'Auto cycle') },
          ...SCENES.filter((scene) => scene.value !== 'auto').map((scene) => ({
            value: scene.value,
            label: label(scene.zh, {
              ring: 'Violet orbit',
              galaxy: 'Blue galaxy',
              peaks: 'Lunar sound ridges',
              blackhole: 'Gravity well',
            }[scene.value]),
          })),
        ],
      },
      {
        key: 'density',
        type: 'number',
        label: label('星尘密度', 'Stardust density'),
        group: label('星空形态', 'Scene'),
        min: 18,
        max: 150,
        step: 1,
        defaultValue: 72,
      },
      {
        key: 'depth',
        type: 'number',
        label: label('空间纵深', 'Spatial depth'),
        group: label('星空形态', 'Scene'),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 68,
      },
      {
        key: 'motion',
        type: 'number',
        label: label('运动速度', 'Motion speed'),
        group: label('声音响应', 'Audio response'),
        min: 20,
        max: 180,
        step: 1,
        defaultValue: 100,
      },
      {
        key: 'sensitivity',
        type: 'number',
        label: label('音频灵敏度', 'Audio sensitivity'),
        group: label('声音响应', 'Audio response'),
        min: 0.35,
        max: 2.2,
        step: 0.05,
        defaultValue: 1,
      },
      {
        key: 'glow',
        type: 'number',
        label: label('光晕强度', 'Glow strength'),
        group: label('画面质感', 'Image quality'),
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 62,
      },
      {
        key: 'highDynamic',
        type: 'boolean',
        label: label('高动态星光', 'Dynamic starlight'),
        description: label(
          '关闭后减少闪烁与瞬态扩散，适合低功耗设备。',
          'Reduces flicker and transient bursts for lower-power devices.',
        ),
        group: label('画面质感', 'Image quality'),
        defaultValue: true,
      },
    ],
  });
}
