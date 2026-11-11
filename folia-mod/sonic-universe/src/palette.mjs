const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : 0));

function component(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(clamp(number, 0, 255));
}

export function parseColor(value, fallback = [128, 128, 128]) {
  if (Array.isArray(value) && value.length >= 3) {
    return [component(value[0]), component(value[1]), component(value[2])];
  }
  const text = String(value ?? '').trim().toLowerCase();
  const hex = text.match(/^#([\da-f]{3,8})$/i);
  if (hex) {
    const raw = hex[1].length <= 4
      ? Array.from(hex[1].slice(0, 3), (part) => part + part)
      : [hex[1].slice(0, 2), hex[1].slice(2, 4), hex[1].slice(4, 6)];
    return raw.map((part) => Number.parseInt(part, 16));
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return [component(rgb[1]), component(rgb[2]), component(rgb[3])];
  return fallback.slice(0, 3).map(component);
}

export function mixColor(a, b, amount = 0.5) {
  const from = Array.isArray(a) ? a : parseColor(a);
  const to = Array.isArray(b) ? b : parseColor(b);
  const t = clamp(amount);
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

export function rgba(color, alpha = 1) {
  const [red, green, blue] = Array.isArray(color) ? color : parseColor(color);
  return `rgba(${component(red)}, ${component(green)}, ${component(blue)}, ${clamp(alpha)})`;
}

export function createPalette(theme = {}) {
  const primary = parseColor(theme.primaryColor, [118, 91, 218]);
  const accent = parseColor(theme.accentColor, [195, 153, 255]);
  const secondary = parseColor(theme.secondaryColor, [54, 104, 209]);
  const backgroundColor = parseColor(theme.backgroundColor, [5, 8, 23]);

  return {
    daylight: Boolean(theme.isDaylight),
    core: mixColor([195, 153, 255], accent, 0.34),
    second: mixColor([78, 134, 235], secondary, 0.28),
    hot: mixColor([244, 222, 255], primary, 0.18),
    themePrimary: mixColor([118, 91, 218], primary, 0.45),
    themeSecondary: mixColor([54, 104, 209], secondary, 0.36),
    warm: mixColor([255, 205, 128], accent, 0.24),
    deep: mixColor([3, 5, 18], backgroundColor, 0.12),
    black: [1, 3, 10],
  };
}
