// Turn game textures (BC7 via the GPU, or raw RGBA) into canvases for the UI.

import { TEXTURE_FORMAT } from '../game/bgscene.js';

let gl = null, bptc = null, program = null;

function setup() {
  if (gl) return gl;
  gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable');
  bptc = gl.getExtension('EXT_texture_compression_bptc');
  const vs = `#version 300 es
    out vec2 uv; void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); uv = p; gl_Position = vec4(p*2.0-1.0,0,1); }`;
  const fs = `#version 300 es
    precision mediump float; in vec2 uv; uniform sampler2D t; out vec4 o; void main(){ o = texture(t, uv); }`;
  program = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    gl.attachShader(program, s);
  }
  gl.linkProgram(program);
  return gl;
}

/** RGBA pixels of a btx texture ({width, height, format, data}). */
export function textureRGBA(tex) {
  if (tex.format === TEXTURE_FORMAT.RGBA8) return tex.data;
  setup();
  if (tex.format !== TEXTURE_FORMAT.BC7 || !bptc) throw new Error('unsupported texture format');
  const src = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, src);
  gl.compressedTexImage2D(gl.TEXTURE_2D, 0, bptc.COMPRESSED_RGBA_BPTC_UNORM_EXT, tex.width, tex.height, 0, tex.data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const dst = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, dst);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, tex.width, tex.height);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
  gl.viewport(0, 0, tex.width, tex.height);
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(tex.width * tex.height * 4);
  gl.readPixels(0, 0, tex.width, tex.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(src);
  gl.deleteTexture(dst);
  return px;
}

/** A canvas showing RGBA pixels, optionally scaled up crisply. */
export function rgbaCanvas(width, height, rgba, scale = 1) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  c.style.width = `${width * scale}px`;
  c.style.height = `${height * scale}px`;
  c.style.imageRendering = 'pixelated';
  return c;
}

export const textureCanvas = (tex, scale = 1) => {
  const image = tex.objectSprite?.frames[tex.objectSprite.first]?.image ?? tex;
  return rgbaCanvas(image.width,image.height,textureRGBA(image),scale);
};
