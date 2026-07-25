import type { CompiledEffect, EffectUniforms } from './index';

const FULLSCREEN_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export type PreparedWebGlDraw = {
  textures: Array<{ name: string; source: TexImageSource }>;
  passes: Array<{
    shader: string;
    fragmentSource: string;
    uniforms: EffectUniforms;
  }>;
};

export function prepareWebGlDraw(options: {
  plan: CompiledEffect;
  sources: Record<string, TexImageSource | undefined>;
  resolveShader: (shader: string) => string;
}): PreparedWebGlDraw {
  if (options.plan.renderer !== 'webgl2' && options.plan.renderer !== 'remotion') {
    throw new Error(`WebGL runtime cannot execute renderer "${options.plan.renderer}".`);
  }
  const textures = Object.keys(options.plan.inputs).map((name) => {
    const source = options.sources[name];
    if (!source) throw new Error(`Runtime texture "${name}" is missing.`);
    return { name, source };
  });
  if (options.plan.passes.length === 0) {
    throw new Error(`Effect "${options.plan.effectId}@${options.plan.effectVersion}" has no GPU passes.`);
  }
  const passes = options.plan.passes.map((pass) => ({
    shader: pass.shader,
    fragmentSource: options.resolveShader(pass.shader),
    uniforms: pass.uniforms,
  }));
  return { textures, passes };
}

type RenderTarget = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
};

export class WebGlEffectRuntime {
  private readonly gl: WebGL2RenderingContext;
  private readonly resolveShader: (shader: string) => string;
  private readonly programs = new Map<string, WebGLProgram>();
  private readonly inputTextures = new Map<string, WebGLTexture>();
  private readonly vertexBuffer: WebGLBuffer;
  private renderTargets: RenderTarget[] = [];
  private renderTargetSize = { width: 0, height: 0 };

  constructor(options: {
    canvas: HTMLCanvasElement;
    resolveShader: (shader: string) => string;
  }) {
    const gl = options.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 is unavailable; use the effect fallback renderer.');
    const vertexBuffer = gl.createBuffer();
    if (!vertexBuffer) throw new Error('Unable to allocate the WebGL fullscreen vertex buffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    this.gl = gl;
    this.resolveShader = options.resolveShader;
    this.vertexBuffer = vertexBuffer;
  }

  render(options: {
    plan: CompiledEffect;
    sources: Record<string, TexImageSource | undefined>;
  }): void {
    const draw = prepareWebGlDraw({
      plan: options.plan,
      sources: options.sources,
      resolveShader: this.resolveShader,
    });
    const { gl } = this;
    const width = options.plan.width;
    const height = options.plan.height;
    if (gl.canvas.width !== width) gl.canvas.width = width;
    if (gl.canvas.height !== height) gl.canvas.height = height;
    gl.viewport(0, 0, width, height);

    const inputTextures = draw.textures.map(({ name, source }) => ({
      name,
      texture: this.uploadInputTexture(name, source),
    }));
    if (draw.passes.length > 1) this.ensureRenderTargets(width, height);

    draw.passes.forEach((pass, passIndex) => {
      const isLast = passIndex === draw.passes.length - 1;
      const program = this.program(pass.shader, pass.fragmentSource);
      gl.useProgram(program);
      this.bindFullscreenGeometry(program);

      inputTextures.forEach(({ name, texture }, textureIndex) => {
        this.bindTexture(program, `u_${name}`, texture, textureIndex);
      });
      if (passIndex > 0) {
        const previous = this.renderTargets[(passIndex - 1) % 2];
        this.bindTexture(program, 'u_source', previous.texture, inputTextures.length);
      }

      this.setUniform(program, 'u_resolution', [width, height]);
      this.setUniform(program, 'u_progress', options.plan.progress);
      this.setUniform(program, 'u_frame', options.plan.frame);
      for (const [name, value] of Object.entries(pass.uniforms)) {
        this.setUniform(program, name, value);
      }

      if (isLast) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        const target = this.renderTargets[passIndex % 2];
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.flush();
  }

  dispose(): void {
    const { gl } = this;
    for (const program of this.programs.values()) gl.deleteProgram(program);
    for (const texture of this.inputTextures.values()) gl.deleteTexture(texture);
    for (const target of this.renderTargets) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    gl.deleteBuffer(this.vertexBuffer);
    this.programs.clear();
    this.inputTextures.clear();
    this.renderTargets = [];
  }

  private uploadInputTexture(name: string, source: TexImageSource): WebGLTexture {
    const { gl } = this;
    let texture = this.inputTextures.get(name);
    if (!texture) {
      texture = gl.createTexture() ?? undefined;
      if (!texture) throw new Error(`Unable to allocate WebGL texture "${name}".`);
      this.inputTextures.set(name, texture);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return texture;
  }

  private ensureRenderTargets(width: number, height: number): void {
    if (
      this.renderTargets.length === 2 &&
      this.renderTargetSize.width === width &&
      this.renderTargetSize.height === height
    ) return;

    const { gl } = this;
    for (const target of this.renderTargets) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    this.renderTargets = [0, 1].map(() => {
      const texture = gl.createTexture();
      const framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) throw new Error('Unable to allocate WebGL render targets.');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('WebGL effect render target is incomplete.');
      }
      return { texture, framebuffer };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.renderTargetSize = { width, height };
  }

  private program(shader: string, fragmentSource: string): WebGLProgram {
    const cached = this.programs.get(shader);
    if (cached) return cached;
    const { gl } = this;
    const vertex = compileShader(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX_SHADER, `${shader}:vertex`);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${shader}:fragment`);
    const program = gl.createProgram();
    if (!program) throw new Error(`Unable to create WebGL program for "${shader}".`);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || 'unknown link error';
      gl.deleteProgram(program);
      throw new Error(`Unable to link WebGL effect "${shader}": ${log}`);
    }
    this.programs.set(shader, program);
    return program;
  }

  private bindFullscreenGeometry(program: WebGLProgram): void {
    const { gl } = this;
    const location = gl.getAttribLocation(program, 'a_position');
    if (location < 0) throw new Error('Effect vertex shader does not expose a_position.');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  }

  private bindTexture(program: WebGLProgram, uniform: string, texture: WebGLTexture, unit: number): void {
    const { gl } = this;
    const location = gl.getUniformLocation(program, uniform);
    if (location == null) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, unit);
  }

  private setUniform(program: WebGLProgram, name: string, value: number | readonly number[]): void {
    const { gl } = this;
    const location = gl.getUniformLocation(program, name);
    if (location == null) return;
    if (typeof value === 'number') {
      gl.uniform1f(location, value);
      return;
    }
    const vector = new Float32Array(value);
    if (value.length === 2) gl.uniform2fv(location, vector);
    else if (value.length === 3) gl.uniform3fv(location, vector);
    else if (value.length === 4) gl.uniform4fv(location, vector);
    else throw new Error(`Uniform "${name}" must contain between 2 and 4 numbers.`);
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Unable to create WebGL shader "${label}".`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`Unable to compile WebGL shader "${label}": ${log}`);
  }
  return shader;
}
