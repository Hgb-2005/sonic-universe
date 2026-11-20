(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const fract = value => value - Math.floor(value);

  function sample(spectrum, position) {
    if (!spectrum?.length) return 0;
    const bucket = clamp(position, 0, 1) * (spectrum.length - 1);
    const left = Math.floor(bucket);
    const a = spectrum[left] || 0;
    const b = spectrum[Math.min(left + 1, spectrum.length - 1)] || 0;
    return a + (b - a) * (bucket - left);
  }

  function noise(index, seed) {
    let word = Math.imul((index + 1) ^ seed, 0x45d9f3b);
    word = Math.imul(word ^ (word >>> 16), 0x45d9f3b);
    return ((word ^ (word >>> 16)) >>> 0) / 4294967296;
  }

  function backdrop(context, width, height, stops) {
    const shade = context.createLinearGradient(0, 0, 0, height);
    for (const [offset, color] of stops) shade.addColorStop(offset, color);
    context.fillStyle = shade;
    context.fillRect(0, 0, width, height);
  }

  function glow(context, x, y, radius, rgb, opacity) {
    const shade = context.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
    shade.addColorStop(0, `rgba(${rgb},${opacity})`);
    shade.addColorStop(.38, `rgba(${rgb},${opacity * .36})`);
    shade.addColorStop(1, `rgba(${rgb},0)`);
    context.fillStyle = shade;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function skyGrain(context, width, height, seed, count, shimmer) {
    context.beginPath();
    for (let index = 0; index < count; index++) {
      const x = noise(index * 3, seed) * width;
      const y = noise(index * 3 + 1, seed) * height;
      const size = .45 + noise(index * 3 + 2, seed) * 1.5;
      context.rect(x, y, size, size);
    }
    context.fillStyle = `rgba(195,225,254,${.21 + shimmer * .31})`;
    context.fill();
  }

  function neonGrid(context, frame) {
    const { width, height, time, bass, mid, high, pulse, energy, spectrum, quality, seed } = frame;
    const center = width * (.5 + .023 * Math.sin(time * .31));
    const horizon = height * (.48 - .027 * bass);
    const floor = height - horizon;
    const cityCount = Math.round(10 + quality * 10);
    context.save();
    backdrop(context, width, height, [[0, '#060714'], [.44, '#12102d'], [.65, '#090f21'], [1, '#050811']]);
    skyGrain(context, width, horizon, seed, 38, high);
    glow(context, center, horizon * .96, width * .53, '116,53,205', .28 + pulse * .24);
    glow(context, center, horizon * 1.02, width * .31, '38,183,215', .22 + energy * .24);

    const portal = Math.min(width, height) * (.118 + bass * .075);
    context.strokeStyle = `rgba(119,220,250,${.2 + energy * .27})`;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(center, horizon, portal, Math.PI, TAU);
    context.moveTo(center - portal * 1.12, horizon);
    context.arc(center, horizon, portal * 1.12, Math.PI, TAU);
    context.stroke();

    const floorFade = context.createLinearGradient(0, horizon, 0, height);
    floorFade.addColorStop(0, `rgba(116,154,228,${.3 + mid * .25})`);
    floorFade.addColorStop(.54, `rgba(79,127,201,${.25 + energy * .27})`);
    floorFade.addColorStop(1, 'rgba(66,103,187,.08)');
    context.strokeStyle = floorFade;
    context.beginPath();
    for (let lane = -8; lane <= 8; lane++) {
      context.moveTo(center + lane * 1.3, horizon);
      context.lineTo(center + lane * width * .103, height);
    }
    for (let row = 0; row < 21; row++) {
      const progress = (row + fract(time * 6.2)) / 21;
      const y = horizon + floor * progress ** 2.25;
      context.moveTo(0, y);
      context.lineTo(width, y);
    }
    context.stroke();

    const stripCount = Math.round(38 + quality * 18);
    const stripWidth = width * .42 / stripCount;
    context.fillStyle = `rgba(132,217,249,${.2 + high * .3})`;
    for (let index = 0; index < stripCount; index++) {
      const level = sample(spectrum, index / (stripCount - 1));
      const altitude = height * (.003 + Math.sqrt(level) * .044);
      context.fillRect(center - width * .21 + index * stripWidth, horizon - altitude, stripWidth * .56, altitude);
    }

    const cityTravel = time * 4.1;
    const firstTower = -Math.floor(cityTravel);
    for (let index = 0; index < cityCount; index++) {
      const depth = (index + fract(cityTravel)) / cityCount;
      const projection = depth ** 1.8;
      const streetWidth = width * (.017 + projection * .45);
      const baseline = horizon + floor * projection;
      const fade = Math.min(1, (1 - depth) * 5, depth * 5);
      for (const side of [-1, 1]) {
        const channel = side < 0 ? depth * .72 : .24 + depth * .76;
        const pitch = sample(spectrum, channel);
        const shape = noise((firstTower + index) * 2 + (side === 1 ? 1 : 0), seed);
        const breadth = width * (.011 + projection * (.023 + shape * .045));
        const altitude = height * (.018 + projection * (.085 + .28 * pitch + .1 * shape));
        const x = center + side * (streetWidth + width * .073 * shape * projection);
        const top = baseline - altitude;
        const edge = x + side * breadth;
        const bevel = breadth * .19;
        context.globalAlpha = fade;
        context.fillStyle = side < 0 ? '#17213e' : '#241837';
        context.beginPath();
        context.moveTo(x, baseline);
        context.lineTo(x, top + bevel);
        context.lineTo(x + side * bevel, top);
        context.lineTo(edge, top);
        context.lineTo(edge, baseline + bevel);
        context.closePath();
        context.fill();
        context.strokeStyle = side < 0 ? `rgba(91,211,231,${.38 + pitch * .62})` : `rgba(195,115,242,${.4 + pitch * .6})`;
        context.lineWidth = .75 + projection * 1.1;
        context.stroke();
        if (depth > .28) {
          context.beginPath();
          for (let row = 1; row <= 3; row++) {
            const y = top + altitude * row * .23;
            context.moveTo(x + side * breadth * .24, y);
            context.lineTo(edge - side * breadth * (.18 + shape * .23), y);
          }
          context.globalAlpha = fade * (.25 + pitch * .62);
          context.stroke();
        }
      }
    }
    context.globalAlpha = 1;

    context.strokeStyle = `rgba(140,213,250,${.33 + pulse * .46})`;
    context.lineWidth = 1 + pulse;
    context.beginPath();
    context.moveTo(center - width * .135, height);
    context.lineTo(center - 2, horizon + 1);
    context.moveTo(center + width * .135, height);
    context.lineTo(center + 2, horizon + 1);
    context.stroke();
    context.restore();
  }

  function prismTunnel(context, frame) {
    const { width, height, time, bass, mid, high, pulse, energy, spectrum, quality, seed } = frame;
    const centerX = width * (.5 + Math.sin(time * .32) * .06);
    const centerY = height * (.46 + Math.cos(time * .29) * .035);
    const largest = Math.hypot(width, height) * .84;
    const count = Math.round(10 + quality * 15);
    const palette = ['92,212,241', '149,135,252', '232,145,206'];
    context.save();
    backdrop(context, width, height, [[0, '#08091a'], [.52, '#111127'], [1, '#060817']]);
    skyGrain(context, width, height, seed, 46, high);
    glow(context, centerX, centerY, largest * .48, '70,98,229', .25 + energy * .28);
    glow(context, centerX + width * .14, centerY - height * .12, largest * .49, '161,62,158', .12 + mid * .23);
    let previous = null;
    const travel = time * 5.8;
    const firstRing = (seed % palette.length) - Math.floor(travel);

    for (let ring = 0; ring < count; ring++) {
      const depth = (ring + fract(travel)) / count;
      const pitch = sample(spectrum, depth * .88);
      const radius = largest * (.026 + depth ** 2.26) * (1 + bass * .23 * depth + pitch * .12);
      const turn = -Math.PI / 2 + time * .24 + depth * 1.1 + Math.sin(depth * 5 - time) * .1 + pulse * .16;
      const yStretch = .87 + Math.sin(time * .14) * .08;
      const points = [];
      for (let vertex = 0; vertex < 3; vertex++) {
        const angle = turn + vertex * TAU / 3;
        points.push([centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius * yStretch]);
      }
      const fade = Math.min(1, (1 - depth) * 6) * (.5 + depth * .5);
      const colorIndex = ((firstRing + ring) % palette.length + palette.length) % palette.length;
      const rgb = palette[colorIndex];
      if (previous) {
        for (let side = 0; side < 3; side++) {
          const next = (side + 1) % 3;
          context.beginPath();
          context.moveTo(...previous[side]);
          context.lineTo(...points[side]);
          context.lineTo(...points[next]);
          context.lineTo(...previous[next]);
          context.closePath();
          context.fillStyle = `rgba(${palette[side]},${fade * (.013 + pulse * .051 + pitch * .022)})`;
          context.fill();
        }
      }
      context.beginPath();
      context.moveTo(...points[0]);
      context.lineTo(...points[1]);
      context.lineTo(...points[2]);
      context.closePath();
      context.lineJoin = 'round';
      context.strokeStyle = `rgba(${rgb},${fade * (.076 + pulse * .104 + pitch * .055)})`;
      context.lineWidth = 4 + depth * 6 + pulse * 5;
      context.stroke();
      context.strokeStyle = `rgba(${rgb},${fade * (.34 + pitch * .25 + pulse * .28)})`;
      context.lineWidth = .75 + depth * 2.2;
      context.stroke();

      if (colorIndex === 1) {
        context.fillStyle = `rgba(229,243,255,${fade * (.4 + high * .44)})`;
        for (const [x, y] of points) {
          const size = 1.4 + depth * 3.5 + high * 2;
          context.fillRect(x - size / 2, y - size / 2, size, size);
        }
      }
      previous = points;
    }
    context.restore();
  }

  function orbitParticles(context, frame) {
    const { width, height, time, bass, mid, high, pulse, energy, spectrum, quality, seed } = frame;
    const size = Math.min(width, height);
    const centerX = width * (.51 + Math.sin(time * .24) * .026);
    const centerY = height * (.48 + Math.cos(time * .21) * .023);
    const core = size * (.103 + bass * .035);
    const particleCount = Math.round(23 + quality * 22);
    const rings = [
      { radius:.263, ratio:.39, rotation:-.43, rgb:'108,217,236' },
      { radius:.343, ratio:.53, rotation:-.22, rgb:'132,154,248' },
      { radius:.444, ratio:.49, rotation:.25, rgb:'207,152,224' },
    ];
    context.save();
    backdrop(context, width, height, [[0, '#060815'], [.58, '#101529'], [1, '#060a17']]);
    skyGrain(context, width, height, seed, Math.round(30 + quality * 52), high);
    glow(context, centerX - size * .14, centerY - size * .08, size * .62, '74,93,183', .37 + bass * .21);
    glow(context, centerX + size * .17, centerY + size * .1, size * .48, '52,190,202', .13 + pulse * .18);

    function drawHalf(back) {
      for (const [ringIndex, ring] of rings.entries()) {
        const turn = ring.rotation + Math.sin(time * .16 + ringIndex) * .13;
        const radius = size * ring.radius * (1 + bass * .11 + ringIndex * .012 * pulse);
        const stretch = radius * ring.ratio;
        const cos = Math.cos(turn), sin = Math.sin(turn);
        context.beginPath();
        context.ellipse(centerX, centerY, radius, stretch, turn, back ? Math.PI : 0, back ? TAU : Math.PI);
        context.lineWidth = back ? .8 : 1.15 + pulse;
        context.strokeStyle = `rgba(${ring.rgb},${back ? .14 + energy * .11 : .3 + pulse * .29})`;
        context.stroke();

        context.beginPath();
        for (let index = 0; index < particleCount; index++) {
          const random = noise(index + ringIndex * particleCount, seed);
          const angle = index * TAU / particleCount + random * .23 + time * (.48 - ringIndex * .095);
          const depth = Math.sin(angle);
          if ((depth < 0) !== back) continue;
          const band = sample(spectrum, index / particleCount);
          const a = Math.cos(angle) * radius * (.97 + random * .07 + .06 * band);
          const b = depth * stretch * (.9 + random * .21 + .13 * mid);
          const x = centerX + a * cos - b * sin;
          const y = centerY + a * sin + b * cos;
          const light = (.54 + random * 1.9) * (back ? .67 : 1) * (1 + band * .65 + high * .19);
          context.moveTo(x + light, y);
          context.arc(x, y, light, 0, TAU);
        }
        context.fillStyle = `rgba(${ring.rgb},${back ? .43 : .78 + pulse * .18})`;
        context.fill();
      }
    }

    drawHalf(true);
    glow(context, centerX, centerY, core * 2.24, '108,170,239', .24 + pulse * .32);
    const planet = context.createRadialGradient(centerX - core * .42, centerY - core * .59, core * .03, centerX, centerY, core);
    planet.addColorStop(0, '#7bcfdb');
    planet.addColorStop(.23, '#304c89');
    planet.addColorStop(.7, '#13162e');
    planet.addColorStop(1, '#0b1022');
    context.beginPath();
    context.arc(centerX, centerY, core, 0, TAU);
    context.fillStyle = planet;
    context.fill();

    context.strokeStyle = `rgba(163,226,251,${.42 + bass * .42})`;
    context.lineWidth = 1 + pulse * 1.6;
    context.beginPath();
    context.arc(centerX, centerY, core, Math.PI * .85, Math.PI * 1.93);
    context.stroke();

    if (pulse > .01) {
      context.strokeStyle = `rgba(134,207,250,${pulse * .42})`;
      context.lineWidth = .8 + pulse;
      context.beginPath();
      context.arc(centerX, centerY, core * (1.85 - pulse * .49), 0, TAU);
      context.stroke();
    }
    drawHalf(false);
    context.restore();
  }

  function signalWave(context, frame) {
    const { width, height, time, bass, mid, high, pulse, energy, spectrum, quality, seed } = frame;
    const segments = Math.round(58 + quality * 38);
    const layers = Math.round(5 + quality * 5);
    context.save();
    backdrop(context, width, height, [[0, '#080b20'], [.46, '#11152f'], [1, '#070b1b']]);
    glow(context, width * .26, height * .54, width * .52, '94,65,189', .25 + mid * .27);
    glow(context, width * .68, height * .49, width * .52, '35,149,190', .17 + bass * .24);
    skyGrain(context, width, height, seed, 45, high);

    const signal = context.createLinearGradient(width * .05, 0, width * .95, 0);
    signal.addColorStop(0, '#8874e200');
    signal.addColorStop(.23, '#aa84ee');
    signal.addColorStop(.55, '#829ffe');
    signal.addColorStop(.77, '#72e1e7');
    signal.addColorStop(1, '#9de1f100');

    const pitches = new Float32Array(segments + 1);
    for (let index = 0; index <= segments; index++) {
      const position = index / segments;
      pitches[index] = (sample(spectrum, .08 + position * .87) * .62
        + sample(spectrum, .1 + position * .83) * .38) ** .68;
    }
    function point(index, layer) {
      const x = index / segments;
      const envelope = Math.sin(Math.PI * x) ** .82;
      const crest = Math.sin(x * 13.8 - time * 1.25 + layer * .16) * (.027 + .07 * bass + pulse * .045);
      const flutter = Math.sin(x * 24.6 + time * .84 + layer * .24) * (.015 + .044 * mid);
      const detail = Math.sin(x * 68 - time * 3.3 + layer * .48) * pitches[index] * (.033 + high * .027);
      const section = (layer / (layers - 1) - .5) * (.063 + pitches[index] * .161 + mid * .056);
      return height * (.51 + (.5 - x) * .158 + envelope * (crest + flutter + detail + section));
    }

    context.strokeStyle = 'rgba(143,161,216,.10)';
    context.lineWidth = .75;
    context.beginPath();
    for (let column = 1; column < 13; column++) {
      const x = column * width / 13;
      const lineHeight = height * (column % 3 === 0 ? .44 : .25);
      const center = height * (.51 + (.5 - column / 13) * .158);
      context.moveTo(x, center - lineHeight / 2);
      context.lineTo(x, center + lineHeight / 2);
    }
    context.stroke();

    for (let layer = 0; layer < layers; layer++) {
      context.beginPath();
      context.moveTo(0, point(0, layer));
      for (let index = 1; index <= segments; index++) context.lineTo(width * index / segments, point(index, layer));
      context.lineJoin = 'round';
      context.strokeStyle = signal;
      const focus = layer === Math.floor(layers / 2);
      if (focus) {
        context.globalAlpha = .12 + pulse * .14;
        context.lineWidth = 10 + 11 * bass;
        context.stroke();
      }
      context.globalAlpha = focus ? .77 + pulse * .21 : .2 + energy * .27;
      context.lineWidth = focus ? 2 + pulse : .85;
      context.stroke();
    }

    const echoes = 12;
    context.beginPath();
    for (let index = 0; index < echoes; index++) {
      const progress = fract(index / echoes + time * (.06 + index * .001));
      const sampleIndex = Math.floor(progress * segments);
      if (progress < .08 || progress > .92) continue;
      const x = width * sampleIndex / segments;
      const y = point(sampleIndex, Math.floor(layers / 2));
      const light = 1.4 + pitches[sampleIndex] * 3.2 + pulse * 1.4;
      context.moveTo(x + light, y);
      context.arc(x, y, light, 0, TAU);
    }
    context.globalAlpha = .77;
    context.fillStyle = '#dceaff';
    context.fill();
    context.restore();
  }

  function silkscreen(context,frame){
    const {width,height,time,bass,mid,high,pulse,quality,seed}=frame;
    backdrop(context,width,height,[[0,'#e5b792'],[1,'#b47365']]);
    const unit=Math.min(width,height),size=unit*.45;
    context.translate(width*.5,height*.44);
    context.rotate(-.16+Math.sin(time*.29)*.035);
    context.fillStyle='#242442';context.fillRect(-size*.75,-size*.52,size*1.5,size*1.04);
    const palette=['#161d36','#ea5545','#efad66','#eee0ac'];
    for(let panel=0;panel<3;panel++){
      context.rotate(panel===1?.28:-.14);
      const x=(panel-1)*(size*.49+mid*size*.06),y=(panel%2-.5)*size*.16;
      context.fillStyle=palette[panel+1];context.fillRect(x-size*.37,y-size*.28,size*.74,size*.56);
    }
    const count=quality>.7?22:17;
    for(let row=0;row<count;row++)for(let col=0;col<count;col++){
      const x=(col/(count-1)-.5)*size*1.66,y=(row/(count-1)-.5)*size*1.07;
      const pitch=sample(frame.spectrum,col/(count-1));
      const radius=unit*(.0025+pitch*.006+pulse*.0017)*(.65+noise(row*count+col,seed)*.7);
      context.fillStyle=(col+row)%6===0?'#fce0ba':'rgba(30,29,48,.67)';
      context.beginPath();context.arc(x+Math.sin(row*.44+time)*high*6,y,radius,0,TAU);context.fill();
    }
    context.strokeStyle='#fff1d1';context.lineWidth=1+unit*.002;
    context.strokeRect(-size*.86-bass*8,-size*.61,size*1.72+bass*16,size*1.22);
  }

  function lanternWindows(context,frame){
    const {width,height,time,bass,pulse,spectrum,seed}=frame;
    backdrop(context,width,height,[[0,'#16122c'],[.65,'#381f40'],[1,'#18162d']]);
    glow(context,width*.5,height*.49,height*.72,'229,112,87',.30+bass*.22);
    const count=9,unit=Math.min(width/13,height/7);
    for(let index=0;index<count;index++){
      const x=width/2+(index-4)*unit*1.17;
      const pitch=sample(spectrum,index/(count-1));
      const y=height*.44+Math.sin(index*.82+time*.76)*unit*.35-pitch*unit*.46;
      const light=.48+pitch*.38+pulse*.12;
      context.strokeStyle='rgba(242,190,153,.26)';context.lineWidth=1;
      context.beginPath();context.moveTo(x,height*.04);context.lineTo(x,y);context.stroke();
      context.fillStyle=`rgba(244,${153+Math.round(noise(index,seed)*53)},111,${light})`;
      context.beginPath();context.roundRect(x-unit*.39,y,unit*.78,unit*.97,unit*.19);context.fill();
      context.strokeStyle='#58334b';
      for(const column of [-.18,0,.18]){context.beginPath();context.moveTo(x+column*unit,y);context.lineTo(x+column*unit,y+unit*.97);context.stroke();}
      context.fillStyle='rgba(241,182,138,.13)';context.fillRect(x-unit*.27,height*.69,unit*.54,unit*(.13+pitch*.46));
    }
  }

  function tideDial(context,frame){
    const {width,height,time,bass,pulse,spectrum,quality}=frame;
    backdrop(context,width,height,[[0,'#10292e'],[1,'#07191c']]);
    const radius=Math.min(width,height)*.23, ticks=quality>.7?96:64;
    context.translate(width*.5,height*.45);
    context.strokeStyle='#527976';context.lineWidth=1;
    for(const scale of [.57,.8,1,1.30]){context.beginPath();context.arc(0,0,radius*scale,0,TAU);context.stroke();}
    for(let index=0;index<ticks;index++){
      const theta=index/ticks*TAU, pitch=sample(spectrum,index/ticks);
      const inner=radius*(1+(index%8===0?.07:.14)),outer=radius*(1.26+pitch*.28);
      context.strokeStyle=index%8===0?'#f6c78f':`rgba(123,211,186,${.28+pitch*.62})`;
      context.beginPath();context.moveTo(Math.cos(theta)*inner,Math.sin(theta)*inner);context.lineTo(Math.cos(theta)*outer,Math.sin(theta)*outer);context.stroke();
    }
    context.lineWidth=Math.max(2,radius*.024);context.strokeStyle='#8cdebb';
    context.beginPath();context.arc(0,0,radius*.80,time*.3,time*.3+.65+bass*2.3);context.stroke();
    context.rotate(time*.32+bass*.24);context.strokeStyle='#ffbd85';
    context.beginPath();context.moveTo(-radius*.2,0);context.lineTo(radius*.94,0);context.stroke();
    context.fillStyle='#ffe0a9';context.beginPath();context.arc(0,0,radius*(.042+pulse*.023),0,TAU);context.fill();
  }

  root.SonicReactiveNeon = Object.freeze({
    'neon-grid': neonGrid,
    'prism-tunnel': prismTunnel,
    'orbit-particles': orbitParticles,
    'signal-wave': signalWave,
    silkscreen,
    'lantern-windows':lanternWindows,
    'tide-dial':tideDial,
  });
})(typeof globalThis === 'object' ? globalThis : this);
