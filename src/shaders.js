// GLSL for the live Starry Night. Four passes:
//   FLOW   - the physics: a stream function (vortices + a wind current + Kolmogorov turbulence) -> flow direction
//   TARGET - what colour each spot should be (the reference, or a sky generated from the flow)
//   LIC    - brushwork: smears colour and bristle noise along the flow (line integral convolution)
//   FINAL  - lights the paint thickness, then colour grading
window.SN = window.SN || {};

SN.shaders = {};

SN.shaders.VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  vUv = vec2(p.x, 1.0 - p.y);   // (0,0) is the top-left of the picture
}`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;
const float PI = 3.14159265;
vec4 S(sampler2D s, vec2 uv) { return texture(s, vec2(uv.x, 1.0 - uv.y)); }
vec4 SL(sampler2D s, vec2 uv, float l) { return textureLod(s, vec2(uv.x, 1.0 - uv.y), l); }
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) * 2.0 - 1.0;
}
`;

const VORTICES = `
uniform int uVN;
uniform vec4 uV[32];     // u, v, sigma, amplitude
uniform float uT[32];    // 0 = swirl, 1 = star / moon
uniform float uAspect, uTime;
float jetY(float x) {
  float u = x / uAspect;
  return 0.655 - 0.285 * smoothstep(0.30, 1.0, u) + 0.015 * sin(9.4 * u + uTime * 0.15);
}
`;

SN.shaders.FLOW = COMMON + VORTICES + `
uniform float uWind, uSwirlGain, uStarGain, uSwirlSize, uTurb, uTurbScale, uJet, uSpiral, uUseScene, uSceneWind;
uniform vec4 uGust;       // u, v, vx, vy
uniform float uGustStr;
uniform sampler2D uScene, uRegion;

float turbPsi(vec2 p, float t) {
  float a = 1.0, s = 0.0, f = 1.0;
  for (int o = 0; o < 6; o++) {
    // Kolmogorov: velocity per octave ~ k^(-1/3), so the stream function ~ k^(-4/3) = 0.397 per octave
    s += a * vnoise(p * f + vec2(t * 0.05 * float(o + 1), -t * 0.03 * float(o + 1)) + float(o) * 17.3);
    a *= 0.397;
    f *= 2.0;
  }
  return s;
}

void main() {
  vec2 P = vec2(vUv.x * uAspect, vUv.y);
  float psi = 0.0;
  vec2 vel = vec2(0.0);

  for (int i = 0; i < 32; i++) {
    if (i >= uVN) break;
    vec4 v = uV[i];
    float fi = float(i);
    vec2 c = vec2(v.x * uAspect, v.y) + 0.006 * vec2(cos(uTime * 0.35 + fi * 1.7), sin(uTime * 0.29 + fi * 2.3));
    float sig = v.z * uSwirlSize;
    float amp = v.w * mix(uSwirlGain, uStarGain, uT[i]) * (1.0 + 0.10 * sin(uTime * 0.5 + fi));
    vec2 d = P - c;
    float G = amp * exp(-dot(d, d) / (2.0 * sig * sig));
    psi += G;
    // curl of the stream function (a swirl) plus a little inflow so the big swirls spiral inward
    vel += G / (sig * sig) * vec2(-d.y - uSpiral * d.x, d.x - uSpiral * d.y);
  }

  // the wind current that carries the pale band
  float jy = jetY(P.x);
  float e = 0.004;
  float dj = (jetY(P.x + e) - jetY(P.x - e)) / (2.0 * e);
  float z = (P.y - jy) / 0.06;
  float ch = cosh(z);
  float sech2 = 1.0 / (ch * ch);
  psi += uJet * 0.7 * tanh(z);
  vel += uJet * 0.7 * sech2 / 0.06 * vec2(1.0, dj);

  // turbulence, from the curl of a Kolmogorov-spectrum stream function
  float amp = uTurb * 0.2;
  float sc = uTurbScale * 2.0;
  float tp = amp * turbPsi(P * sc, uTime);
  float ty1 = amp * turbPsi((P + vec2(0.0, e)) * sc, uTime), ty0 = amp * turbPsi((P - vec2(0.0, e)) * sc, uTime);
  float tx1 = amp * turbPsi((P + vec2(e, 0.0)) * sc, uTime), tx0 = amp * turbPsi((P - vec2(e, 0.0)) * sc, uTime);
  vel += vec2((ty1 - ty0) / (2.0 * e), -(tx1 - tx0) / (2.0 * e));
  psi += tp;

  vel.x += uWind;
  psi += uWind * P.y;

  vec2 gd = P - vec2(uGust.x * uAspect, uGust.y);
  vel += uGust.zw * uGustStr * exp(-dot(gd, gd) / (2.0 * 0.075 * 0.075));

  vec2 wdir = normalize(vel + vec2(1e-5));
  vec4 sc4 = S(uScene, vUv);
  vec2 sdir = sc4.rg * 2.0 - 1.0;
  float nonSky = uUseScene * (1.0 - sc4.b);
  vec2 dir = normalize(mix(wdir, sdir + uSceneWind * wdir, nonSky) + vec2(1e-5));
  float cls = uUseScene * floor(S(uRegion, vUv).r * 255.0 / 32.0 + 0.5);
  outColor = vec4(dir, psi, cls / 8.0);
}`;

SN.shaders.TARGET = COMMON + VORTICES + `
uniform sampler2D uRef, uFlow, uScene;
uniform float uSimSky, uBand;
uniform int uStarN;
uniform vec4 uStar[16];   // u, v, halo radius
uniform vec4 uMoon;       // u, v, radius

vec3 C(float r, float g, float b) { return vec3(r, g, b) / 255.0; }

vec3 haloCol(float r) {
  vec3 c0 = C(238.0, 200.0, 66.0), c1 = C(240.0, 214.0, 100.0), c2 = C(232.0, 232.0, 168.0),
       c3 = C(208.0, 228.0, 206.0), c4 = C(150.0, 200.0, 230.0), c5 = C(70.0, 122.0, 200.0);
  if (r < 0.22) return mix(c0, c1, r / 0.22);
  if (r < 0.45) return mix(c1, c2, (r - 0.22) / 0.23);
  if (r < 0.62) return mix(c2, c3, (r - 0.45) / 0.17);
  if (r < 0.80) return mix(c3, c4, (r - 0.62) / 0.18);
  if (r < 1.00) return mix(c4, c5, (r - 0.80) / 0.20);
  return c5;
}
vec3 moonHaloCol(float r) {
  vec3 c0 = C(228.0, 230.0, 166.0), c1 = C(236.0, 234.0, 172.0), c2 = C(224.0, 234.0, 186.0),
       c3 = C(184.0, 216.0, 204.0), c4 = C(120.0, 172.0, 202.0), c5 = C(70.0, 122.0, 188.0);
  if (r < 0.42) return mix(c0, c1, r / 0.42);
  if (r < 0.62) return mix(c1, c2, (r - 0.42) / 0.20);
  if (r < 0.78) return mix(c2, c3, (r - 0.62) / 0.16);
  if (r < 0.92) return mix(c3, c4, (r - 0.78) / 0.14);
  if (r < 1.00) return mix(c4, c5, (r - 0.92) / 0.08);
  return c5;
}
float haloAlpha(float r) { return r < 1.0 ? mix(1.0, 0.96, r) : (r < 1.4 ? mix(0.96, 0.34, (r - 1.0) / 0.4) : mix(0.34, 0.0, clamp((r - 1.4) / 0.6, 0.0, 1.0))); }

vec3 simSky(vec2 P, float psi) {
  float v = P.y;
  vec3 top = C(20.0, 40.0, 112.0), m1 = C(32.0, 64.0, 150.0), m2 = C(58.0, 104.0, 176.0), low = C(98.0, 142.0, 190.0);
  vec3 base = v < 0.3 ? mix(top, m1, v / 0.3) : (v < 0.55 ? mix(m1, m2, (v - 0.3) / 0.25) : mix(m2, low, clamp((v - 0.55) / 0.15, 0.0, 1.0)));
  float band = 0.5 + 0.5 * sin(psi * uBand);

  float envSw = 0.0;
  for (int i = 0; i < 32; i++) {
    if (i >= uVN) break;
    if (uT[i] < 0.5 && abs(uV[i].w) > 0.5) {
      float r = length(P - vec2(uV[i].x * uAspect, uV[i].y)) / (2.3 * uV[i].z);
      envSw += exp(-r * r);
    }
  }
  envSw = clamp(envSw, 0.0, 1.0);
  float jz = (P.y - jetY(P.x)) / 0.085;
  float envJ = exp(-jz * jz);

  vec3 sky = base * (0.72 + 0.50 * band);
  sky = mix(sky, C(168.0, 204.0, 228.0), clamp(0.55 * band * envSw, 0.0, 1.0));
  sky = mix(sky, C(14.0, 28.0, 96.0), clamp((0.30 - band) * 2.6, 0.0, 1.0) * envSw * 0.6);
  sky = mix(sky, C(224.0, 230.0, 198.0), clamp((band - 0.20) * 1.9, 0.0, 1.0) * envJ * 0.85);
  sky = mix(sky, C(176.0, 206.0, 226.0), clamp((0.55 - band) * 1.5, 0.0, 1.0) * envJ * 0.35);

  for (int i = 0; i < 16; i++) {
    if (i >= uStarN) break;
    vec4 s = uStar[i];
    vec2 d = P - vec2(s.x * uAspect, s.y);
    float r = length(d) / s.z;
    r *= 1.0 + 0.07 * sin(3.0 * atan(d.y, d.x) + 7.0 * r + uTime * 0.8);
    sky = mix(sky, haloCol(r), haloAlpha(r));
  }
  if (uMoon.z > 0.0) {
    vec2 mc = vec2(uMoon.x * uAspect, uMoon.y);
    float mr = uMoon.z;
    vec2 d = P - mc;
    float r = length(d) / (mr * 2.3);
    r *= 1.0 + 0.05 * sin(3.0 * atan(d.y, d.x) + 7.0 * r + uTime * 0.6);
    sky = mix(sky, moonHaloCol(r), haloAlpha(r) * 0.95);
    float d1 = length(d);
    float d2 = length(P - (mc + vec2(0.52 * mr, -0.22 * mr)));
    float cres = smoothstep(mr * 0.92 - 0.002, mr * 0.92 + 0.002, d2) * (1.0 - smoothstep(mr - 0.002, mr + 0.002, d1));
    sky = mix(sky, C(226.0, 178.0, 40.0), cres);
  }
  return sky;
}

void main() {
  vec3 ref = S(uRef, vUv).rgb;
  vec3 col = ref;
  if (uSimSky > 0.5) {
    vec2 P = vec2(vUv.x * uAspect, vUv.y);
    float psi = S(uFlow, vUv).b;
    col = mix(ref, simSky(P, psi), S(uScene, vUv).b);
  }
  outColor = vec4(col, 1.0);
}`;

SN.shaders.LIC = COMMON + `
uniform sampler2D uFlow, uTarget, uNoise;
uniform vec2 uRes;
uniform float uAspect, uTime;
uniform float uLen, uWidthPx, uEdge, uLod, uBristle, uStrokeVar, uShimmer;
uniform int uSteps;
uniform float uClassLen[8];

vec2 nUV(vec2 p, float scalePx) { return p * uRes / scalePx / 512.0; }

void main() {
  vec2 uv = vUv;
  vec2 asp = vec2(uAspect, 1.0);
  vec4 f0 = S(uFlow, uv);
  float cls = floor(f0.w * 8.0 + 0.5);
  float L = uLen * uClassLen[int(clamp(cls, 0.0, 7.0))];
  vec3 c0 = SL(uTarget, uv, uLod).rgb;
  float N = float(uSteps);
  float ds = L / N;
  float phase = uTime * uShimmer;

  vec3 cacc = c0;
  float wcs = 1.0;
  float w0 = 1.0 + cos(-2.0 * PI * phase);
  float nfa = texture(uNoise, nUV(uv, uWidthPx)).r * w0;
  float nca = texture(uNoise, nUV(uv, uWidthPx * 3.3) + 0.37).g * w0;
  float wns = w0;

  for (int d = 0; d < 2; d++) {
    float sgn = d == 0 ? 1.0 : -1.0;
    vec2 p = uv;
    for (int i = 1; i <= 48; i++) {
      if (i > uSteps) break;
      vec4 f = S(uFlow, p);
      if (abs(f.w - f0.w) > 0.02) break;
      p += sgn * f.xy * ds / asp;
      float s = float(i) / N;
      float w = 0.5 + 0.5 * cos(PI * s);
      vec3 c = SL(uTarget, p, uLod).rgb;
      vec3 dc = c - c0;
      float wc = w * exp(-dot(dc, dc) * uEdge);
      cacc += c * wc;
      wcs += wc;
      float wn = w * (1.0 + cos(2.0 * PI * (sgn * s * 1.5 - phase)));
      nfa += texture(uNoise, nUV(p, uWidthPx)).r * wn;
      nca += texture(uNoise, nUV(p, uWidthPx * 3.3) + 0.37).g * wn;
      wns += wn;
    }
  }
  vec3 col = cacc / wcs;
  float nfine = nfa / wns, ncoarse = nca / wns;
  float tone = 1.0 + uStrokeVar * (ncoarse - 0.5) * 1.1;
  col *= tone;
  float h = 0.5 + uBristle * 2.2 * (nfine - 0.5) + uStrokeVar * 1.4 * (ncoarse - 0.5);
  outColor = vec4(col, clamp(h, 0.0, 1.0));
}`;

SN.shaders.FINAL = COMMON + `
uniform sampler2D uLic;
uniform vec2 uRes;
uniform float uImpasto, uLightAng, uGloss, uCanvas, uVignette;
uniform float uHueSky, uHueLight, uHueFoliage, uHueAll, uSat, uBright, uContrast;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float hueW(float h, float c, float w) {
  float d = abs(h - c);
  d = min(d, 1.0 - d);
  return exp(-d * d / (2.0 * w * w));
}

void main() {
  vec2 px = 1.5 / uRes;
  vec4 c = S(uLic, vUv);
  float hl = S(uLic, vUv - vec2(px.x, 0.0)).a, hr = S(uLic, vUv + vec2(px.x, 0.0)).a;
  float hu = S(uLic, vUv - vec2(0.0, px.y)).a, hd = S(uLic, vUv + vec2(0.0, px.y)).a;
  vec2 g = vec2(hr - hl, hd - hu);
  vec3 N = normalize(vec3(-g * uImpasto * 1.4, 1.0));
  float a = radians(uLightAng);
  vec3 Ld = normalize(vec3(cos(a), -sin(a), 0.85));
  vec3 col = c.rgb * (1.0 + clamp((dot(N, Ld) - Ld.z) * 1.3, -0.30, 0.30));
  col += pow(max(dot(reflect(-Ld, N), vec3(0.0, 0.0, 1.0)), 0.0), 22.0) * uGloss * 0.35;

  vec2 wp = vUv * uRes;
  float weave = sin(wp.x * 1.1) * sin(wp.y * 1.1);
  col *= 1.0 + weave * 0.035 * uCanvas + (hash21(wp) - 0.5) * 0.05 * uCanvas;

  vec3 hsv = rgb2hsv(clamp(col, 0.0, 1.0));
  float sw = smoothstep(0.06, 0.28, hsv.y);
  float h = hsv.x;
  h += uHueSky * hueW(h, 0.62, 0.09) * sw + uHueLight * hueW(h, 0.13, 0.07) * sw
     + uHueFoliage * hueW(h, 0.36, 0.08) * sw + uHueAll;
  hsv.x = fract(h);
  hsv.y = clamp(hsv.y * uSat, 0.0, 1.0);
  col = hsv2rgb(hsv);
  col = (col - 0.5) * uContrast + 0.5 + uBright;

  vec2 q = vUv - 0.5;
  col *= 1.0 - uVignette * dot(q, q) * 1.6;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
