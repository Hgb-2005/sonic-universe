(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const STRANDS = 36;
  const STEPS = 84;
  const SPAN = STEPS + 1;
  const POINTS = STRANDS * SPAN;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const fract = value => value - Math.floor(value);
  const smooth = value => value * value * (3 - 2 * value);
  const mix = (a, b, part) => a + (b - a) * part;
  const channels = [
    [[110,127,255], [172,125,255], [247,158,220], [201,239,255]],
    [[80,143,253], [92,223,246], [147,148,252], [208,251,255]],
    [[123,118,253], [139,212,253], [250,152,177], [255,223,211]],
  ];
  const forms = Array.from({ length:3 }, () => new Float32Array(POINTS * 3));
  const projectedX = new Float32Array(POINTS);
  const projectedY = new Float32Array(POINTS);
  const projectedDepth = new Float32Array(POINTS);
  const scatter = new Float32Array(POINTS);
  const largeSurfaces = new WeakMap();
  const MAX_RASTER_PIXELS = 1850000;

  function hash(number, seed) {
    let word = Math.imul((number + 1) ^ seed, 0x45d9f3b);
    word = Math.imul(word ^ (word >>> 16), 0x45d9f3b);
    return ((word ^ (word >>> 16)) >>> 0) / 4294967296;
  }

  function setForm(form, point, x, y, z) {
    const offset = point * 3;
    form[offset] = x;
    form[offset + 1] = y;
    form[offset + 2] = z;
  }

  for (let strand = 0; strand < STRANDS; strand++) {
    const petal = strand % 12;
    const flake = Math.floor(strand / 12) - 1;
    const tube = strand * TAU / STRANDS;
    const braid = strand % 3;
    const filament = Math.floor(strand / 3) - 5.5;
    for (let step = 0; step <= STEPS; step++) {
      const point = strand * SPAN + step;
      const u = step / STEPS;
      const theta = TAU * u;
      const bow = Math.sin(Math.PI * u);

      // Petal fibres meet at a shared cup, with a curved outer edge and a different depth on return.
      const flowerRadius = .087 + (.95 + flake * .047) * bow ** .92;
      const curl = (petal * TAU / 12) + .64 * u + .17 * Math.sin(theta)
        + flake * (.025 + .105 * bow);
      setForm(forms[0], point, flowerRadius * Math.cos(curl), flowerRadius * .9 * Math.sin(curl),
        .31 * bow - .24 * Math.cos(Math.PI * u) + .14 * Math.sin(theta + petal * .62) * bow);

      // Rounded corners keep the silhouette crystalline while each cross-section twists through the ring.
      const crossSection = theta * 2 + tube;
      const ringRadius = .71 + .205 * Math.cos(crossSection);
      const rx = Math.cos(theta), ry = Math.sin(theta);
      setForm(forms[1], point, ringRadius * Math.sign(rx) * Math.abs(rx) ** .72,
        ringRadius * Math.sign(ry) * Math.abs(ry) ** .72,
        .27 * Math.sin(crossSection) + .11 * Math.cos(theta * 4));

      // Three filaments make a vertically tapered braid with open spaces between the arms.
      const spiral = TAU * (2.08 * u + braid / 3) + filament * (.065 + .012 * bow);
      const helixRadius = .195 + .464 * bow ** .63 + filament * .014;
      const helixHeight = 2.02 * (u - .5) + .028 * Math.sin(theta * 1.5 + filament * .24);
      setForm(forms[2], point, helixRadius * Math.cos(spiral), helixHeight,
        .83 * helixRadius * Math.sin(spiral));
      scatter[point] = hash(point, 22518);
    }
  }

  function colorAt(from, to, part, accent, weight = .17) {
    return from.map((source, index) => {
      const target = mix(source, to[index], part);
      return Number.isFinite(accent?.[index]) ? Math.round(mix(target, clamp(accent[index], 0, 255), weight)) : Math.round(target);
    }).join(',');
  }

  function sample(spectrum, position) {
    if (!spectrum?.length) return 0;
    const index = position * (spectrum.length - 1);
    const left = Math.floor(index);
    return mix(spectrum[left] || 0, spectrum[Math.min(left + 1, spectrum.length - 1)] || 0, index - left);
  }

  function radial(context, x, y, radius, rgb, intensity) {
    const glow = context.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
    glow.addColorStop(0, `rgba(${rgb},${intensity})`);
    glow.addColorStop(.32, `rgba(${rgb},${intensity * .45})`);
    glow.addColorStop(1, `rgba(${rgb},0)`);
    context.fillStyle = glow;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function stars(context, width, height, seed, high) {
    context.beginPath();
    for (let index = 0; index < 74; index++) {
      const x = hash(index * 4 + 2, seed) * width;
      const y = hash(index * 4 + 3, seed) * height;
      const point = .45 + 1.2 * hash(index * 4 + 4, seed);
      context.rect(x, y, point, point);
    }
    context.fillStyle = `rgba(180,205,252,${.19 + high * .16})`;
    context.fill();
  }

  function paintBloom(context, frame) {
    const { width, height, time, bass, mid, high, pulse, energy, spectrum, quality, seed } = frame;
    const {artwork,brightness} = frame.immersion || {};
    const focused = Boolean(artwork);
    const narrow = width <= 700;
    const requestedMorph = Number.isFinite(frame.morph) ? frame.morph : time / 9;
    const phase = ((requestedMorph % 3) + 3) % 3;
    const from = Math.floor(phase), to = (from + 1) % 3;
    const bend = smooth(clamp((fract(phase) - .53) / .47, 0, 1));
    const a = forms[from], b = forms[to];
    const colors = channels[from].map((color, index) => {
      const accent=focused?(index===1||index===2?artwork.secondary:artwork.primary):frame.palette;
      return colorAt(color,channels[to][index],bend,accent,focused?.84:.17);
    });
    const aspect = Math.min(width, height);
    const centerX = width * (.5 + .018 * Math.sin(time * .22));
    const centerY = height * ((focused ? .5 : .452) + .016 * Math.sin(time * .19 + .5));
    const radius = focused ? Math.min(width * .53, height * .53) : Math.min(width * .43, height * .365);
    const verticalScale = focused && narrow ? 1.58 : 1;
    const inLyricField = (x,y) => focused && Math.abs(x / width - .5) < .40 && Math.abs(y / height - .5) < .18;
    const level = (quality || 1) * (width * height > 4_600_000 ? .76 : 1);
    const strainCount = clamp(Math.round(18 + level * 18), 18, STRANDS);
    const stride = level < .8 ? 2 : 1;
    const orbit = time * .28;
    const rawTilt = mix(from === 2 ? .21 : .34, to === 2 ? .21 : .34, bend);
    const tilt = rawTilt + Math.sin(orbit * .83) * .24 + mid * .061;
    const yaw = Math.sin(orbit) * .64 + Math.sin(orbit * .39) * .33;
    const roll = Math.sin(orbit * .56) * .33 - .11;
    const cosX = Math.cos(tilt), sinX = Math.sin(tilt);
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const cosZ = Math.cos(roll), sinZ = Math.sin(roll);
    const swell = 1 + bass * .11 + (focused ? 0 : pulse * .12);
    const pixel = clamp(radius / 390, .67, 2.35);
    const timeSeed = ((time * 1000) | 0) / 1000;

    context.save();
    const background = context.createLinearGradient(0, 0, width * .5, height);
    if(focused){
      background.addColorStop(0, `rgb(${artwork.base.map(value=>Math.round(value*.66+4))})`);
      background.addColorStop(.54, `rgb(${artwork.base})`);
      background.addColorStop(1, `rgb(${artwork.base.map(value=>Math.round(value*.46+3))})`);
    }else{
      background.addColorStop(0, '#090a1a');
      background.addColorStop(.54, '#111127');
      background.addColorStop(1, '#060910');
    }
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    if(focused){
      const drift = Math.sin(time * .16) * .035;
      const glow = .62 + brightness * .56;
      radial(context,width*(.18+drift),height*.19,aspect*(narrow?.98:.86),artwork.primary,.43*glow+pulse*.11);
      radial(context,width*(.86-drift),height*.80,aspect*(narrow?.94:.77),artwork.secondary,.38*glow);
      radial(context,width*.88,height*.09,aspect*.63,artwork.secondary,.16*glow);
    }else{
      radial(context, centerX - radius * .64, centerY - radius * .46, aspect * .92, colors[0], .17 + energy * .12);
      radial(context, centerX + radius * .69, centerY + radius * .26, aspect * .73, colors[2], .11 + pulse * .09);
    }
    stars(context, width, height, seed, high);

    let left = centerX, right = centerX, upper = centerY, lower = centerY;
    for (let index = 0; index < strainCount; index++) {
      const strand = Math.floor(index * STRANDS / strainCount);
      const channel = sample(spectrum, (.96 * strand + 1) / STRANDS);
      const strandOffset = strand * SPAN;
      const strandPhase = strand * .54 + timeSeed * (1.15 + channel * .18);
      const vibration = .02 + .057 * channel + .033 * high + .016 * mid;
      const spread = swell * (.97 + channel * .09);
      for (let step = 0; step <= STEPS; step += stride) {
        const point = strandOffset + step;
        const offset = point * 3;
        const traveling = Math.sin(step * .153 + strandPhase) * vibration;
        const x = mix(a[offset], b[offset], bend) * spread;
        const y = mix(a[offset + 1], b[offset + 1], bend) * swell;
        const z = mix(a[offset + 2], b[offset + 2], bend) + traveling;
        const horizontal = x * cosY - z * sinY;
        const depth = x * sinY + z * cosY;
        const vertical = y * cosX - depth * sinX;
        const apparentZ = y * sinX + depth * cosX;
        const perspective = 3.65 / (3.65 - apparentZ);
        projectedX[point] = centerX + (horizontal * cosZ - vertical * sinZ) * radius * perspective;
        projectedY[point] = centerY + (vertical * cosZ + horizontal * sinZ) * radius * perspective * verticalScale;
        projectedDepth[point] = clamp(.5 + apparentZ * .55, 0, 1);
        left = Math.min(left, projectedX[point]);
        right = Math.max(right, projectedX[point]);
        upper = Math.min(upper, projectedY[point]);
        lower = Math.max(lower, projectedY[point]);
      }
    }

    const fit = Math.min(1,
      (centerX - width * .041) / Math.max(1, centerX - left),
      (width * .959 - centerX) / Math.max(1, right - centerX),
      (centerY - height * .052) / Math.max(1, centerY - upper),
      (height * .91 - centerY) / Math.max(1, lower - centerY));
    if (fit < 1) {
      for (let index = 0; index < strainCount; index++) {
        const offset = Math.floor(index * STRANDS / strainCount) * SPAN;
        for (let step = 0; step <= STEPS; step += stride) {
          const point = offset + step;
          projectedX[point] = mix(centerX, projectedX[point], fit);
          projectedY[point] = mix(centerY, projectedY[point], fit);
        }
      }
    }

    context.lineJoin = 'round';
    for (let material = 0; material < 3; material++) {
      context.beginPath();
      for (let index = 0; index < strainCount; index++) {
        const strand = Math.floor(index * STRANDS / strainCount);
        if (strand % 3 !== material) continue;
        const offset = strand * SPAN;
        context.moveTo(projectedX[offset], projectedY[offset]);
        for (let step = stride; step <= STEPS; step += stride) {
          context.lineTo(projectedX[offset + step], projectedY[offset + step]);
        }
      }
      context.strokeStyle = `rgba(${colors[material]},${.032 + pulse * .028})`;
      context.lineWidth = pixel * (13 + bass * 8);
      context.stroke();
      context.strokeStyle = `rgba(${colors[material]},${.15 + energy * .1})`;
      context.lineWidth = pixel * (1.17 + pulse * .66);
      context.stroke();
    }

    for (let depth = 0; depth < 3; depth++) {
      for (let material = 0; material < 3; material++) {
        context.beginPath();
        for (let index = 0; index < strainCount; index++) {
          const strand = Math.floor(index * STRANDS / strainCount);
          if (strand % 3 !== material) continue;
          const offset = strand * SPAN;
          for (let step = 1; step <= STEPS; step++) {
            if ((step + strand) % (stride * 2)) continue;
            const point = offset + step - (step % stride);
            const brightness = projectedDepth[point];
            if (Math.min(2, Math.floor(brightness * 3)) !== depth) continue;
            const flicker = scatter[point];
            if (flicker < .16) continue;
            const size = pixel * (.68 + flicker * brightness * 2.02) * (1 + high * .32 + pulse * .22);
            const x = projectedX[point], y = projectedY[point];
            if(inLyricField(x,y))continue;
            context.moveTo(x + size, y);
            context.arc(x, y, size, 0, TAU);
          }
        }
        context.fillStyle = `rgba(${colors[material]},${.32 + depth * .21 + high * .17})`;
        context.fill();
      }
    }

    // Larger light pulses move along selected fibres rather than filling the whole screen.
    for (let glint = 0; glint < (level >= .8 ? 14 : 8); glint++) {
      const index = Math.floor(hash(glint * 2, seed + 27) * strainCount);
      const strand = Math.floor(index * STRANDS / strainCount);
      const travel = fract(.087 * glint + timeSeed * (.16 + glint % 3 * .027));
      const point = strand * SPAN + Math.floor(travel * STEPS / stride) * stride;
      const depth = projectedDepth[point];
      const fade = Math.min(1, travel * 11, (1 - travel) * 11);
      const size = pixel * (1.6 + depth * 2.4 + pulse * 2.8);
      const x = projectedX[point], y = projectedY[point];
      if(inLyricField(x,y))continue;
      radial(context, x, y, size * 4.5, colors[strand % 3], fade * (.43 + pulse * .27));
      context.fillStyle = `rgba(${colors[3]},${fade * (.67 + depth * .24)})`;
      context.beginPath();
      context.arc(x, y, size, 0, TAU);
      context.fill();
    }

    if(focused){
      const shade=artwork.base.map(value=>Math.round(value*.33+3));
      context.save();
      context.translate(width*.5,height*.5);
      context.scale(width*(narrow?.73:.58),height*(narrow?.33:.37));
      const veil=context.createRadialGradient(0,0,0,0,0,1);
      veil.addColorStop(0,`rgba(${shade},.97)`);
      veil.addColorStop(.48,`rgba(${shade},.92)`);
      veil.addColorStop(.72,`rgba(${shade},.58)`);
      veil.addColorStop(1,`rgba(${shade},0)`);
      context.fillStyle=veil;
      context.fillRect(-1,-1,2,2);
      context.restore();
    }
    context.restore();
  }

  function prismBloom(context, frame) {
    const backing = context.canvas;
    const pixelCount = backing ? backing.width * backing.height : 0;
    if (pixelCount <= MAX_RASTER_PIXELS || typeof root.OffscreenCanvas !== 'function') {
      paintBloom(context, frame);
      return;
    }
    // Keep a bright, soft light field at UHD without rerasterizing every glow at native density.
    const scale = Math.sqrt(MAX_RASTER_PIXELS / pixelCount);
    const width = Math.max(1, Math.floor(backing.width * scale));
    const height = Math.max(1, Math.floor(backing.height * scale));
    let surface = largeSurfaces.get(context);
    if (!surface || surface.canvas.width !== width || surface.canvas.height !== height) {
      const canvas = new root.OffscreenCanvas(width, height);
      surface = { canvas, context:canvas.getContext('2d', { alpha:false }) };
      largeSurfaces.set(context, surface);
    }
    if (!surface.context) {
      paintBloom(context, frame);
      return;
    }
    surface.context.setTransform(width / frame.width, 0, 0, height / frame.height, 0, 0);
    paintBloom(surface.context, frame);
    context.drawImage(surface.canvas, 0, 0, frame.width, frame.height);
  }

  root.SonicReactiveBloom = Object.freeze({ 'prism-bloom':prismBloom });
})(typeof globalThis === 'object' ? globalThis : this);
