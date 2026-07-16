'use client';

/**
 * Liquid Ember — a full-screen WebGL background for the app pages (auth +
 * dashboard). A domain-warped fractal-noise field renders as slow-flowing dark
 * magma with faint orange veins that breathe. Dependency-free (raw WebGL1), sits
 * behind all content (fixed, z-index 0, pointer-events none), pauses when the
 * tab is hidden, and renders a single static frame when the user prefers reduced
 * motion. The landing page is intentionally NOT a mount point.
 */
import { useEffect, useRef } from 'react';

const VERT = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`;

// Domain-warped FBM. Kept mostly dark so it never fights foreground content;
// orange only surfaces along the warp ridges. Palette matches the --dh-* tokens.
const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++){ v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * 0.05;
  vec2 p = uv * 1.7;

  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.8));
  vec2 r = vec2(fbm(p + 2.0 * q + vec2(1.7, 9.2) + t * 0.45),
                fbm(p + 2.0 * q + vec2(8.3, 2.8) - t * 0.30));
  float f = fbm(p + 3.0 * r);

  vec3 base   = vec3(0.039, 0.035, 0.031); // #0a0908
  vec3 mid    = vec3(0.110, 0.098, 0.082); // #1c1915
  vec3 orange = vec3(1.000, 0.353, 0.122); // #ff5a1f
  vec3 hi     = vec3(1.000, 0.478, 0.271); // #ff7a45

  vec3 col = mix(base, mid, smoothstep(0.0, 0.9, f));
  float vein = smoothstep(0.58, 0.96, f + 0.5 * length(r - 0.5));
  col = mix(col, orange, vein * 0.30);
  col += hi * pow(smoothstep(0.74, 1.0, f), 3.0) * 0.14;

  float vig = smoothstep(1.3, 0.15, length(uv));
  col *= mix(0.70, 1.0, vig);

  col += (hash(gl_FragCoord.xy + t) - 0.5) * 0.022; // dither to kill banding
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[LiquidEmber] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export default function LiquidEmber() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
    if (!gl) return; // canvas keeps its CSS dark background as a graceful fallback

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[LiquidEmber] program link failed:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    // Single full-screen triangle.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');

    // Cap DPR — a full-screen fragment shader gets expensive fast on retina.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    };
    resize();
    window.addEventListener('resize', resize);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const start = performance.now();

    const draw = (now: number) => {
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    if (reduce) {
      draw(start + 8000); // one settled frame, no animation
    } else {
      const loop = (now: number) => {
        draw(now);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    // Pause the loop while the tab is hidden.
    const onVisibility = () => {
      if (reduce) return;
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        const loop = (now: number) => {
          draw(now);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        pointerEvents: 'none',
        background: '#0a0908',
        display: 'block',
      }}
    />
  );
}
