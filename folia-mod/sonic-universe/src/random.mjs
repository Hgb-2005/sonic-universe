export function hashString(value) {
  let hash = 2166136261;
  const text = String(value ?? 'sonic-universe');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRange(index, seed, salt = 0) {
  const random = mulberry32((seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
  return random();
}
