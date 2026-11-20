/* Original landscape painters for the listening room's shared canvas. */
(() => {
  'use strict';

  const pointCache = new Map();
  const tau = Math.PI * 2;

  function field(seed, salt, count) {
    const key = `${seed >>> 0}:${salt}`;
    let points = pointCache.get(key);
    if (points) return points;
    let state = (seed ^ salt) >>> 0;
    const next = () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    points = Array.from({length:count}, () => [next(), next(), next(), next()]);
    if (pointCache.size >= 20) pointCache.delete(pointCache.keys().next().value);
    pointCache.set(key, points);
    return points;
  }

  function sky(ctx, w, h, stops) {
    const paint = ctx.createLinearGradient(0, 0, 0, h);
    for (const [offset, color] of stops) paint.addColorStop(offset, color);
    ctx.fillStyle = paint;
    ctx.fillRect(0, 0, w, h);
  }

  function bloom(ctx, x, y, radius, rgb, strength) {
    const light = ctx.createRadialGradient(x, y, 0, x, y, radius);
    light.addColorStop(0, `rgba(${rgb},${strength})`);
    light.addColorStop(.34, `rgba(${rgb},${strength * .48})`);
    light.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = light;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function ridge(ctx, w, h, baseline, amplitude, phase, color, bottom) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let step = 0; step <= 96; step++) {
      const x = step / 96;
      const profile = Math.sin(x * 12 + phase) * .44 + Math.sin(x * 23 + phase * 2) * .21
        + Math.sin(x * 47 - phase) * .125 + Math.sin(x * 109 + phase) * .027;
      const y = h * (baseline - amplitude * profile);
      if (step) ctx.lineTo(x * w, y);
      else ctx.moveTo(0, y);
    }
    ctx.lineTo(w, h * bottom);
    ctx.lineTo(0, h * bottom);
    ctx.fill();
  }

  function paintPavilion(ctx, originX, originY, size, pulse, bass) {
    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(size, size);

    // Deep reflection and the thin wet stone causeway beneath the building.
    const reflection = ctx.createLinearGradient(0, 0, 0, 51);
    reflection.addColorStop(0, '#091416b3');
    reflection.addColorStop(1, '#09141600');
    ctx.fillStyle = reflection;
    ctx.beginPath();
    ctx.moveTo(-50, 2); ctx.lineTo(52, 2); ctx.lineTo(26 + bass * 7, 35);
    ctx.lineTo(-19, 38); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#122726';
    ctx.beginPath();
    ctx.ellipse(0, 1, 95, 6, -.018, 0, tau);
    ctx.fill();

    ctx.fillStyle = '#122321';
    ctx.fillRect(-46, -4, 92, 4);
    ctx.fillRect(-39, -10, 77, 6);
    ctx.fillRect(-31, -43, 62, 35);
    ctx.fillStyle = `rgba(234,180,104,${.49 + pulse * .32})`;
    ctx.fillRect(-22, -36, 44, 21);
    ctx.fillStyle = '#23302b';
    for (const x of [-26,-12,1,14,26]) ctx.fillRect(x, -40, 3, 34);
    ctx.fillRect(-26, -23, 52, 2);

    function roof(y, span, rise) {
      ctx.fillStyle = '#0a191b';
      ctx.beginPath();
      ctx.moveTo(-span, y - 7);
      ctx.quadraticCurveTo(-span * .68, y + 1, -16, y - rise * .42);
      ctx.quadraticCurveTo(-7, y - rise * .65, 0, y - rise);
      ctx.quadraticCurveTo(10, y - rise * .63, 16, y - rise * .42);
      ctx.quadraticCurveTo(span * .68, y + 1, span, y - 7);
      ctx.quadraticCurveTo(span * .77, y + 5, 0, y + 4);
      ctx.quadraticCurveTo(-span * .77, y + 5, -span, y - 7);
      ctx.fill();
    }

    roof(-43, 49, 23);
    roof(-63, 31, 18);
    ctx.fillStyle = '#10201d';
    ctx.fillRect(-1.3, -86, 2.6, 8);
    ctx.restore();
    bloom(ctx, originX, originY - size * 26, size * 40, '231,153,74', .07 + pulse * .12);
  }

  function jiangnan(ctx, frame) {
    const {width:w, height:h, time:t, bass, mid, high, pulse, quality, seed} = frame;
    sky(ctx, w, h, [[0,'#111e2d'], [.48,'#486b70'], [.61,'#91a491'], [.68,'#395859'], [1,'#12252f']]);
    bloom(ctx, w * .31, h * .47, Math.max(w,h) * .59, '187,205,167', .25);
    ridge(ctx, w, h, .51, .21, 1.3, '#688b8d', .615);
    ridge(ctx, w, h, .566, .23, 4.2, '#496e73', .621);
    ridge(ctx, w, h, .61, .145, 2.1, '#2c5457', .632);
    const mist = ctx.createLinearGradient(0, h * .49, 0, h * .74);
    mist.addColorStop(0, '#b3cbb000');
    mist.addColorStop(.48, '#c6d0a960');
    mist.addColorStop(1, '#afd9be00');
    ctx.fillStyle = mist;
    ctx.fillRect(0, h * .49, w, h * .25);

    const grains = field(seed, 0xc82478a1, 145);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(199,216,182,${.21 + high * .14})`;
    ctx.beginPath();
    for (let i = 0; i < 34 * quality; i++) {
      const [a,b,c,d] = grains[i];
      const x = ((a + t * (.006 + mid * .005) * (b - .5) + 1000) % 1) * w;
      const y = h * (.646 + b * b * .29);
      const span = (6 + d * d * 52) * (h * .0028 + .32) * (1 + bass * .42);
      ctx.moveTo(x, y); ctx.lineTo(x + span, y + c * .24);
    }
    ctx.stroke();

    const islandX = w * .765, islandY = h * .66;
    const size = Math.min(w / 850, h / 465) * (.87 + quality * .13);
    paintPavilion(ctx, islandX, islandY, size, pulse, bass);

    ctx.strokeStyle = `rgba(175,209,203,${.18 + bass * .16})`;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const [a,b,c] = grains[i + 30];
      const age = (t * (.47 + c * .35) + b) % 1;
      const x = w * (.1 + a * .77), y = h * (.70 + b * .29);
      ctx.moveTo(x + 1 + age * 18, y);
      ctx.ellipse(x, y, 1 + age * 18, .5 + age * 3.3, 0, 0, tau);
    }
    ctx.stroke();

    ctx.strokeStyle = `rgba(185,218,228,${.19 + high * .20})`;
    ctx.beginPath();
    for (let i = 0; i < grains.length * quality; i++) {
      const [a,b,c,d] = grains[i];
      const shift = t * (.31 + c * .47 + mid * .09);
      const x = ((a + shift * .14) % 1) * w;
      const y = ((b + shift) % 1) * h;
      const length = 5 + (9 + h * .014) * d * d;
      ctx.moveTo(x, y); ctx.lineTo(x - length * .22, y + length);
    }
    ctx.stroke();
  }

  function dune(ctx, w, h, base, curve, sway, top, bottom) {
    const paint = ctx.createLinearGradient(0, h * (base - .22), w * .17, h);
    paint.addColorStop(0, top); paint.addColorStop(1, bottom);
    ctx.fillStyle = paint;
    ctx.beginPath();
    ctx.moveTo(-w * .12, h * (base + .1));
    ctx.bezierCurveTo(w * .12, h * (base - curve), w * .28, h * (base - curve + sway), w * .49, h * (base - .024));
    ctx.bezierCurveTo(w * .71, h * (base + .14), w * .95, h * (base + .036), w * 1.12, h * (base - curve * .4));
    ctx.lineTo(w * 1.12, h); ctx.lineTo(-w * .12, h); ctx.closePath(); ctx.fill();
  }

  function amberDunes(ctx, frame) {
    const {width:w, height:h, time:t, bass, mid, high, pulse, quality, seed} = frame;
    const small = Math.min(w,h), sunX = w * .72, sunY = h * .366;
    sky(ctx, w, h, [[0,'#151324'], [.40,'#60363c'], [.69,'#c27c4e'], [1,'#35233a']]);
    bloom(ctx, sunX, sunY, Math.max(w,h) * .54, '252,152,76', .39 + pulse * .19);
    const sunRadius = small * (.095 + .012 * bass);
    const sun = ctx.createLinearGradient(sunX, sunY - sunRadius, sunX, sunY + sunRadius);
    sun.addColorStop(0, '#ffdeb0'); sun.addColorStop(.54, '#ffc37a'); sun.addColorStop(1, '#df754a');
    ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(sunX, sunY, sunRadius, 0, tau); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(sunX, sunY, sunRadius, 0, tau); ctx.clip();
    ctx.strokeStyle = '#a8645a87'; ctx.lineWidth = Math.max(1, h * .002);
    for (let i = 0; i < 8; i++) {
      const y = sunY + sunRadius * (i / 7 - .09);
      ctx.beginPath(); ctx.moveTo(sunX - sunRadius, y); ctx.lineTo(sunX + sunRadius, y); ctx.stroke();
    }
    ctx.restore();

    const rise = Math.sin(t * .37) * .012 + bass * .014;
    dune(ctx, w, h, .623, .14, rise, '#b57651', '#4e3041');
    dune(ctx, w, h, .714, .08, -.14 + rise, '#b7744a', '#56354b');
    dune(ctx, w, h, .84, .24, rise, '#965439', '#38263a');
    dune(ctx, w, h, .96, .13, -.11 + rise, '#754734', '#241c32');

    ctx.lineWidth = Math.max(.8, h * .0012);
    ctx.strokeStyle = `rgba(255,188,112,${.18 + mid * .20})`;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const p = i / 11, phase = t * .22 + p;
      ctx.moveTo(-w * .03, h * (.736 + p * .24));
      ctx.bezierCurveTo(w * .23, h * (.595 + p * .25 + rise), w * .52, h * (.88 + p * .18), w * .82, h * (.914 + p * .16 + Math.sin(phase) * .02));
    }
    ctx.stroke();

    const sand = field(seed, 0x49d4063f, 108);
    ctx.fillStyle = `rgba(255,212,138,${.26 + .35 * high})`;
    ctx.beginPath();
    for (let i = 0; i < sand.length * quality; i++) {
      const [a,b,c,d] = sand[i];
      const x = ((a + t * (.013 + c * .022)) % 1) * w;
      const y = h * (.63 + b * b * .36 + Math.sin(t * .76 + a * tau) * .018);
      const radius = (.55 + d * d * 1.55) * (.8 + pulse * .4);
      ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, tau);
    }
    ctx.fill();
  }

  function jadeCurrent(ctx, frame) {
    const {width:w, height:h, time:t, bass, mid, high, pulse, energy, spectrum, quality, seed} = frame;
    const radius = Math.max(w,h);
    sky(ctx, w, h, [[0,'#071923'], [.58,'#0a3037'], [1,'#051d24']]);
    bloom(ctx, w * .09, h * .19, radius * .59, '49,142,111', .45 + energy * .11);
    bloom(ctx, w * .84, h * .76, radius * .5, '14,116,104', .52 + bass * .18);
    const gleam = ctx.createLinearGradient(0, h * .78, w, h * .2);
    gleam.addColorStop(0, '#468fa01a'); gleam.addColorStop(.30, '#63d8bdaf');
    gleam.addColorStop(.61, '#daf1a9d1'); gleam.addColorStop(1, '#54c4ba32');

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = gleam;
    const lanes = Math.floor(19 * quality);
    for (let lane = 0; lane < lanes; lane++) {
      const level = lane / (lanes - 1);
      const detail = spectrum?.[Math.floor(level * (spectrum.length - 1))] || 0;
      const stagger = level * tau * 1.27;
      const width = (1 + level * 10) * (1 + bass * .34);
      ctx.lineWidth = width;
      ctx.globalAlpha = (.13 + high * .08 + detail * .11) * (1 - Math.abs(level - .48));
      ctx.beginPath();
      for (let step = 0; step <= 68; step++) {
        const x = step / 68;
        const ribbon = .82 - x * .58 + Math.sin(x * 7.6 - t * (.36 + mid * .18) + stagger * .19) * .147;
        const wave = Math.cos(x * 20 + stagger - t * .63) * (.018 + detail * .012);
        const y = h * (ribbon + wave + (level - .5) * (.29 + pulse * .054));
        if (step) ctx.lineTo(w * x, y); else ctx.moveTo(0, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    const bubbles = field(seed, 0x8217c646, 120);
    ctx.strokeStyle = `rgba(199,244,210,${.25 + .27 * high})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < bubbles.length * quality; i++) {
      const [a,b,c,d] = bubbles[i];
      const x = ((a + t * (.017 + c * .039 + mid * .008)) % 1) * w;
      const y = h * (.79 - x / w * .52 + (b - .5) * .41 + Math.sin(a * 9 + t * .62) * .04);
      const size = .5 + d * d * (2.1 + pulse * 2.7);
      ctx.moveTo(x + size, y); ctx.arc(x, y, size, 0, tau);
    }
    ctx.stroke();
  }

  function violetAurora(ctx, frame) {
    const {width:w, height:h, time:t, bass, mid, high, pulse, energy, quality, seed} = frame;
    sky(ctx, w, h, [[0,'#0b0d22'], [.56,'#202044'], [.81,'#373a58'], [1,'#10182f']]);
    bloom(ctx, w * .21, h * .33, Math.max(w,h) * .71, '60,84,155', .28 + energy * .16);
    const stars = field(seed, 0xdf5c47a1, 185);
    ctx.fillStyle = `rgba(218,226,254,${.55 + high * .29})`;
    ctx.beginPath();
    for (let i = 0; i < stars.length * quality; i++) {
      const [a,b,c,d] = stars[i];
      const x = a * w, y = b * h * .76;
      const sparkle = .65 + .3 * Math.sin(t * (.36 + d) + c * tau) + (d < .11 ? high * .51 : 0);
      const size = (.46 + c ** 3 * 1.1) * sparkle;
      ctx.moveTo(x + size, y); ctx.arc(x, y, size, 0, tau);
    }
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let layer = 0; layer < 3; layer++) {
      const lift = h * (.15 + layer * .053 + bass * .059);
      const curve = fraction => h * (.49 - fraction * .22 + layer * .058
        + Math.sin(fraction * 5.5 + t * (.22 + mid * .07) + layer * .89) * .084
        + Math.sin(fraction * 14.0 + t * .29 - layer * .69) * .024);
      const curtain = ctx.createLinearGradient(0, h * .04 + layer * h * .052, w * .13, h * .65 + layer * h * .041);
      curtain.addColorStop(0, '#9d45f10a');
      curtain.addColorStop(.34, layer === 1 ? '#a42ec581' : '#5844d770');
      curtain.addColorStop(.61, '#7d69f4bb'); curtain.addColorStop(.82, '#66d8b06b');
      curtain.addColorStop(1, '#74ffd500');
      ctx.fillStyle = curtain;
      ctx.globalAlpha = .48 + pulse * .17;
      ctx.beginPath();
      for (let step = 0; step <= 64; step++) {
        const x = step / 64;
        if (step) ctx.lineTo(x * w, curve(x) - lift);
        else ctx.moveTo(0, curve(0) - lift);
      }
      for (let step = 64; step >= 0; step--) {
        const x = step / 64;
        ctx.lineTo(x * w, curve(x) + lift * (.125 + Math.sin(x * 7 + layer * 1.7) * .17));
      }
      ctx.closePath(); ctx.fill();

      ctx.strokeStyle = curtain;
      ctx.lineWidth = Math.max(.8, w * .0013);
      ctx.globalAlpha = .29 + high * .20;
      ctx.beginPath();
      const count = Math.floor(61 * quality);
      for (let i = 0; i < count; i++) {
        const x = i / (count - 1);
        const lower = curve(x);
        const streak = 1 + Math.sin(x * 38 + t * .93 + layer) * .34;
        ctx.moveTo(x * w + w * .018, lower - lift * streak);
        ctx.lineTo(x * w, lower);
      }
      ctx.stroke();
    }
    ctx.restore();

    ridge(ctx, w, h, .834, .215, 9.35, '#172037', 1);
    ridge(ctx, w, h, .929, .21, 1.6, '#0a1227', 1);
  }

  function isolated(painter) {
    return (ctx, frame) => {
      if (!(frame.width > 0 && frame.height > 0)) return;
      ctx.save();
      try { painter(ctx, frame); }
      finally { ctx.restore(); }
    };
  }

  window.SonicReactiveLandscapes = Object.freeze({
    'jiangnan-rain': isolated(jiangnan),
    'amber-dunes': isolated(amberDunes),
    'jade-current': isolated(jadeCurrent),
    'violet-aurora': isolated(violetAurora),
  });
})();
