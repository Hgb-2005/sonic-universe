(function (root, factory) {
  const presets = factory();
  if (typeof module === "object" && module.exports) module.exports = presets;
  else root.SonicVisualPresets = presets;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  return Object.freeze([
    { id: "deep-cinema", name: "深空电影", note: "完整银河与柔和光脉，一键开始创作", look: { theme: "nebula", visualMode: "galaxy", motionSpeed: .65, particleCount: 3200, intensity: .72, depth: .85, glow: .58, trail: .6, response: "balanced", beat: false, energySaver: false, storyEnabled: false, journeyAuto: false } },
    { id: "gold-softlight", name: "金色柔光", note: "温暖星云环，适合安静聆听与人声", look: { theme: "solar", visualMode: "ring", motionSpeed: .5, particleCount: 2400, intensity: .62, depth: .55, glow: .5, trail: .45, response: "soft", beat: false, energySaver: false, storyEnabled: false, journeyAuto: false } },
    { id: "eco-stardust", name: "省电星尘", note: "更少星尘、更短拖尾，轻松播放更久", look: { theme: "galaxy", visualMode: "galaxy", motionSpeed: .5, particleCount: 800, intensity: .62, depth: .45, glow: .28, trail: .2, response: "soft", beat: false, energySaver: true, storyEnabled: false, journeyAuto: false } },
    { id: "violet-orbit", name: "紫雾星环", note: "轻柔的呼吸，让旋律缓缓铺开", look: { theme: "nebula", visualMode: "ring", motionSpeed: .75, particleCount: 3200, intensity: .65, depth: .55, glow: .55, trail: .62, response: "soft", beat: false } },
    { id: "blue-drift", name: "深蓝漫游", note: "流动的旋臂，适合氛围与电子音乐", look: { theme: "galaxy", visualMode: "galaxy", motionSpeed: 1, particleCount: 4400, intensity: .8, depth: .9, glow: .65, trail: .72, response: "balanced", beat: true } },
    { id: "gold-horizon", name: "日冕引力", note: "金色吸积盘，低音让引力边界呼吸", look: { theme: "solar", visualMode: "blackhole", motionSpeed: .85, particleCount: 4000, intensity: .85, depth: .8, glow: .85, trail: .82, response: "strong", beat: true } },
    { id: "lunar-peaks", name: "月下声脊", note: "频谱化作山峦，听见旋律的层次", look: { theme: "galaxy", visualMode: "peaks", motionSpeed: .65, particleCount: 3000, intensity: .7, depth: .45, glow: .4, trail: .48, response: "soft", beat: false } },
    { id: "rose-eclipse", name: "玫瑰日蚀", note: "柔紫光环包住深空，适合慢歌与人声", look: { theme: "nebula", visualMode: "blackhole", motionSpeed: .55, particleCount: 2600, intensity: .62, depth: .72, glow: .74, trail: .68, response: "soft", beat: false } },
    { id: "arctic-echo", name: "冰蓝回声", note: "清透山脊与冷色星尘，留住高音细节", look: { theme: "galaxy", visualMode: "peaks", motionSpeed: .8, particleCount: 3600, intensity: .72, depth: .66, glow: .36, trail: .42, response: "balanced", beat: false } },
    { id: "amber-waves", name: "琥珀潮汐", note: "温暖星环随低音起伏，适合节奏律动", look: { theme: "solar", visualMode: "ring", motionSpeed: 1.15, particleCount: 3800, intensity: .78, depth: .48, glow: .7, trail: .74, response: "balanced", beat: true } },
    { id: "violet-spiral", name: "紫晶旋臂", note: "细密旋臂缓缓流转，让电子旋律更有纵深", look: { theme: "nebula", visualMode: "galaxy", motionSpeed: .9, particleCount: 5000, intensity: .68, depth: .96, glow: .52, trail: .78, response: "balanced", beat: false } },
  ]);
});
