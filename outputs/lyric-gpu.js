/* One textured triangle batch for the current lyric line. */
(function (root) {
  'use strict';

  const floatsPerVertex = 13;
  const maxQuads = 16384; // Four vertices per quad, indexed by Uint16.
  const vertexSource = `
    attribute vec2 a_position;
    attribute vec2 a_uv;
    attribute vec2 a_sweep;
    attribute vec4 a_color;
    attribute vec3 a_highlight;
    uniform vec2 u_size;
    varying vec2 v_uv;
    varying vec2 v_sweep;
    varying vec4 v_color;
    varying vec3 v_highlight;

    void main() {
      vec2 point = a_position / u_size;
      gl_Position = vec4(point.x * 2.0 - 1.0, 1.0 - point.y * 2.0, 0.0, 1.0);
      v_uv = a_uv;
      v_sweep = a_sweep;
      v_color = a_color;
      v_highlight = a_highlight;
    }
  `;
  const fragmentSource = `
    uniform sampler2D u_atlas;
    varying vec2 v_uv;
    varying vec2 v_sweep;
    varying vec4 v_color;
    varying vec3 v_highlight;

    void main() {
      float fill = v_sweep.y;
      float highlighted = fill >= 1.0 ? 1.0 : fill <= 0.0 ? 0.0
        : 1.0 - smoothstep(fill - 0.02, fill + 0.02, v_sweep.x);
      vec3 rgb = mix(v_color.rgb, v_highlight, highlighted);
      float alpha = texture2D(u_atlas, v_uv).a * v_color.a;
      gl_FragColor = vec4(rgb * alpha, alpha);
    }
  `;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  }

  function link(gl) {
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision
      ? 'highp' : 'mediump';
    const prefix = 'precision ' + precision + ' float;\n';
    const vertex = compile(gl, gl.VERTEX_SHADER, prefix + vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, prefix + fragmentSource);
    const program = vertex && fragment ? gl.createProgram() : null;
    if (program) {
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
    }
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    if (!program || gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
    gl.deleteProgram(program);
    return null;
  }

  function create(canvas) {
    let gl;
    try {
      gl = canvas.getContext('webgl', {
        antialias: false, depth: false, stencil: false,
        premultipliedAlpha: true, failIfMajorPerformanceCaveat: true,
      });
    } catch {
      return null;
    }
    if (!gl || gl.isContextLost()) return null;

    const program = link(gl);
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const texture = gl.createTexture();
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      gl.deleteTexture(texture);
      gl.deleteBuffer(vertexBuffer);
      gl.deleteBuffer(indexBuffer);
      gl.deleteProgram(program);
    }
    if (!program || !vertexBuffer || !indexBuffer || !texture) {
      close();
      return null;
    }

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    for (const [name, size, offset] of [
      ['a_position', 2, 0], ['a_uv', 2, 2], ['a_sweep', 2, 4],
      ['a_color', 4, 6], ['a_highlight', 3, 10],
    ]) {
      const attribute = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, floatsPerVertex * 4, offset * 4);
    }
    const sizeUniform = gl.getUniformLocation(program, 'u_size');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_atlas'), 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    let atlasWidth = 0, atlasHeight = 0;
    function upload(atlas) {
      if (closed || gl.isContextLost() || !atlas.width || !atlas.height ||
          atlas.width > maxTextureSize || atlas.height > maxTextureSize) return false;
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      } catch {
        return false;
      }
      if (gl.getError() !== gl.NO_ERROR) return false;
      atlasWidth = atlas.width;
      atlasHeight = atlas.height;
      return true;
    }

    let capacity = 0, vertices, offset = 0;
    function reserve(count) {
      if (count <= capacity) return;
      capacity = Math.min(maxQuads, Math.max(count, 32, capacity * 2));
      vertices = new Float32Array(capacity * 4 * floatsPerVertex);
      const indices = new Uint16Array(capacity * 6);
      for (let i = 0; i < capacity; i++) {
        const start = i * 4, index = i * 6;
        indices[index] = start;
        indices[index + 1] = start + 1;
        indices[index + 2] = start + 2;
        indices[index + 3] = start;
        indices[index + 4] = start + 2;
        indices[index + 5] = start + 3;
      }
      gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    }

    function addVertex(x, y, u, v, sweep, quad) {
      vertices[offset++] = x;
      vertices[offset++] = y;
      vertices[offset++] = u;
      vertices[offset++] = v;
      vertices[offset++] = sweep;
      vertices[offset++] = quad.fill;
      vertices[offset++] = quad.color[0];
      vertices[offset++] = quad.color[1];
      vertices[offset++] = quad.color[2];
      vertices[offset++] = quad.opacity;
      vertices[offset++] = quad.highlight[0];
      vertices[offset++] = quad.highlight[1];
      vertices[offset++] = quad.highlight[2];
    }

    let logicalWidth = 0, logicalHeight = 0, pixelWidth = 0, pixelHeight = 0;
    function draw(quads, width, height) {
      if (closed || gl.isContextLost() || !atlasWidth || width <= 0 || height <= 0 ||
          quads.length > maxQuads) return false;
      if (width !== logicalWidth || height !== logicalHeight) {
        logicalWidth = width;
        logicalHeight = height;
        gl.uniform2f(sizeUniform, width, height);
      }
      if (pixelWidth !== gl.drawingBufferWidth || pixelHeight !== gl.drawingBufferHeight) {
        pixelWidth = gl.drawingBufferWidth;
        pixelHeight = gl.drawingBufferHeight;
        gl.viewport(0, 0, pixelWidth, pixelHeight);
      }
      gl.clear(gl.COLOR_BUFFER_BIT);
      reserve(quads.length);
      offset = 0;
      for (const quad of quads) {
        if (quad.opacity <= 0) continue;
        const {sprite, x, y, w, h, a, b, c, d} = quad;
        const left = sprite.x / atlasWidth, right = (sprite.x + sprite.width) / atlasWidth;
        const top = sprite.y / atlasHeight, bottom = (sprite.y + sprite.height) / atlasHeight;
        const sweepStart = sprite.sweepStart ?? 0;
        const sweepWidth = Math.max(.01, (sprite.sweepEnd ?? 1) - sweepStart);
        const sweepLeft = -sweepStart / sweepWidth, sweepRight = (1 - sweepStart) / sweepWidth;
        const horizontalX = a * w, horizontalY = b * w, verticalX = c * h, verticalY = d * h;
        addVertex(x, y, left, top, sweepLeft, quad);
        addVertex(x + horizontalX, y + horizontalY, right, top, sweepRight, quad);
        addVertex(x + horizontalX + verticalX, y + horizontalY + verticalY, right, bottom, sweepRight, quad);
        addVertex(x + verticalX, y + verticalY, left, bottom, sweepLeft, quad);
      }
      if (offset) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, offset));
        gl.drawElements(gl.TRIANGLES, offset / (floatsPerVertex * 4) * 6, gl.UNSIGNED_SHORT, 0);
      }
      return true;
    }

    return {upload, draw, close, maxTextureSize};
  }

  root.SonicLyricGpu = Object.freeze({create});
})(globalThis);
