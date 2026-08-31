/*!
 * LiquidGlass.js v2.3 — 物理折射版「液态玻璃」材质组件(vanilla / 零依赖 / 单文件)
 * =========================================================================
 * v2.3:①边缘高光升级为锥形光谱环(crisp 描边 + 主/次 glint + 光谱微染 + 指针联动旋转);
 *      ②色散升级为每通道独立解 Snell 的三张贴图(v2.2 为绿通道贴图 × 缩放比的小角度近似)
 * v2 与 v1 的区别:位移场不再是「法线 × 任意衰减曲线」的美术近似,而是按
 * **Snell 折射定律解析计算**,视觉完全由物理参数(折射率 / 厚度 / 倒角半径)决定。
 *
 * 物理模型(俯视 UI 玻璃):
 *   玻璃 = 平板(厚 H)+ 边缘圆角倒角(fillet 半径 r)。视线垂直向下:
 *   ① 表面轮廓   d 为到边缘的内部距离(SDF),d ≥ r 为平坦顶面(倾角 0);
 *                d < r 为四分之一圆弧倒角:sinθ₁ = 1 − d/r,入射高度 z(d) = H − r + √(r² − (r−d)²)
 *   ② Snell 定律 sinθ₂ = sinθ₁ / n(n 为玻璃折射率 IOR)
 *   ③ 所见偏移   屏幕点 P 显示的是折射光线到达玻璃底面的位置:
 *                Δ = z(d) · tanθ₂ = z(d) · sinθ₁ / √(n² − sin²₁),方向沿表面法线的水平分量(向外)
 *                → 物理推论:平坦中心零畸变;倒角处背景从玻璃足迹之外被「拉入」边缘带;
 *                  直壁段(H−r)越高位移越大;n 越接近 1 位移越大(n→1 时发散),
 *                  n 增大反而收敛(∂Δ/∂n < 0)
 *   ④ 色散       柯西色散:n蓝 > n绿 > n红 → tanθ₂ 随 n 减小 → **红端图像位移最大、蓝端最小**,
 *                边缘分带由外向内呈 红→绿→蓝 的物理正确排序(v1 的任意倍率已废弃)
 *   ⑤ Fresnel    Schlick 近似透射率 T(θ) 编码进位移贴图 B 通道(供扩展使用)
 *   注:本模型光线自顶面入射、底面出射,θ₂ ≤ 临界角,不会发生全反射(TIR 只出现在
 *       「底进侧出」路径);feDisplacementMap 只能弯折采样、无法聚光,故没有真实焦散,
 *       这是 W3C svgwg#1142 承认的平台级限制。
 *
 * DOM 结构(内容层不参与折射,文字永不扭曲):
 *   <liquid-glass>
 *     ├─ .lg-surface    backdrop-filter = url(#物理位移+分谱滤镜) blur() saturate()
 *     ├─ .lg-tint       着色层
 *     ├─ .lg-rim        边缘镜面高光 / 细描边
 *     ├─ .lg-highlight  指针跟随镜面光
 *     └─ .lg-content    任意内容(文字 / 图标 / 控件)
 *
 * 用法一(自定义元素,data-* 传参):
 *   <liquid-glass data-ior="1.5" data-thickness="24" data-bezel="0.4" data-dispersion="0.12">
 *     <button>按钮</button>
 *   </liquid-glass>
 *   (thickness / bezel 传 ≤1 的小数时按 min(w,h) 的比例取值)
 *
 * 用法二(JS API):
 *   const lg = new LiquidGlass(el, { ior: 1.5, thickness: 24 });
 *   lg.setOptions({ ior: 1.9 });   // 运行时热切换
 *
 * 注意:玻璃元素的祖先不要带 filter / opacity<1 / isolation:isolate / mask,
 *       否则会形成「backdrop root」导致折射层采样不到页面背景。
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- 0. 能力检测 ---------- */
  var CAN_REFRACT = (function () {
    try {
      var ua = navigator.userAgent;
      if (/Firefox\//i.test(ua)) return false;
      var chromium = /Chrome\/\d+/i.test(ua) || /Chromium\/\d+/i.test(ua) ||
                     /Edg\/\d+/i.test(ua) || /OPR\/\d+/i.test(ua);
      var bf = window.CSS &&
        (CSS.supports('backdrop-filter', 'blur(2px)') ||
         CSS.supports('-webkit-backdrop-filter', 'blur(2px)'));
      return chromium && bf;
    } catch (e) { return false; }
  })();

  var uidCounter = 0;
  function nextId() { return 'lg-f' + (++uidCounter) + '_' + Math.random().toString(36).slice(2, 7); }

  /* ---------- 1. 基础样式(组件自带,注入一次) ---------- */
  function injectBaseStyle() {
    if (document.getElementById('liquid-glass-style')) return;
    var style = document.createElement('style');
    style.id = 'liquid-glass-style';
    style.textContent =
      'liquid-glass { position: relative; display: inline-block; border-radius: 18px; }\n' +
      '.lg-host { transition: transform .28s cubic-bezier(.2,.8,.2,1); -webkit-tap-highlight-color: transparent; }\n' +
      '.lg-surface, .lg-tint, .lg-rim, .lg-highlight { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }\n' +
      '.lg-surface { z-index: 1; -webkit-backdrop-filter: blur(10px) saturate(1.6); backdrop-filter: blur(10px) saturate(1.6); }\n' +
      '.lg-tint { z-index: 2; background: var(--lg-tint, rgba(255,255,255,.08)); }\n' +
      '.lg-rim { z-index: 3; background: linear-gradient(155deg, rgba(255,255,255,.16), rgba(255,255,255,0) 42%);\n' +
      '  box-shadow: inset 0 0 0 1px rgba(255,255,255,.22), inset 0 1.5px 1px rgba(255,255,255,.45), inset 0 -1px 1px rgba(255,255,255,.10); }\n' +
      '@property --lg-rim-rot { syntax: \'<angle>\'; inherits: true; initial-value: 0deg; }\n' +
      '/* 锥形光谱环:1.4px crisp 描边 + 主 glint(75°)与对侧次亮弧;\n' +
      '   glint 两侧的暖→冷微染是真实玻璃 specular 边缘的色散;\n' +
      '   --lg-rim-rot 由指针方位驱动,模拟光随视角打在倒角上 */\n' +
      '@supports ((-webkit-mask-composite: xor) or (mask-composite: exclude)) {\n' +
      '  .lg-rim { transition: --lg-rim-rot .15s ease-out; padding: 1.4px;\n' +
      '    background: conic-gradient(from var(--lg-rim-rot, 0deg),\n' +
      '      rgba(255,255,255,.06) 0deg,\n' +
      '      rgba(255,255,255,.55) 58deg,\n' +
      '      rgba(255,255,255,.92) 74deg,\n' +
      '      rgba(255,228,190,.55) 86deg,\n' +
      '      rgba(170,215,255,.30) 98deg,\n' +
      '      rgba(255,255,255,.08) 130deg,\n' +
      '      rgba(255,255,255,.03) 185deg,\n' +
      '      rgba(255,255,255,.38) 248deg,\n' +
      '      rgba(255,255,255,.10) 300deg,\n' +
      '      rgba(255,255,255,.06) 360deg);\n' +
      '    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);\n' +
      '    -webkit-mask-composite: xor;\n' +
      '            mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);\n' +
      '            mask-composite: exclude; }\n' +
      '}\n' +
      '.lg-highlight { z-index: 3; opacity: var(--lg-glow, 0); transition: opacity .18s linear;\n' +
      '  background: radial-gradient(circle at var(--lg-mx, 50%) var(--lg-my, 50%), rgba(255,255,255,.38), rgba(255,255,255,0) 55%); }\n' +
      '/* 注意:.lg-highlight 禁止使用 mix-blend-mode——兄弟层的混合模式会迫使宿主成为\n' +
      '   合成层,Chromium 会因此静默丢弃 .lg-surface 的 backdrop 位移(无警告) */\n' +
      '.lg-content { position: relative; z-index: 4; }\n' +
      '.lg--press { transform: scale(.965); }\n' +
      '.lg--shadow { box-shadow: 0 14px 38px rgba(0,0,0,.30), 0 3px 12px rgba(0,0,0,.22); }\n';
    document.head.appendChild(style);
  }

  /* ---------- 2. 几何 ---------- */
  // 返回值 < 0 表示在圆角矩形内部,绝对值即到边缘的距离
  function sdRoundedRect(px, py, w, h, r) {
    var hw = w / 2, hh = h / 2;
    r = Math.min(r, hw, hh);
    var qx = Math.abs(px - hw) - (hw - r);
    var qy = Math.abs(py - hh) - (hh - r);
    var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
  }

  // Snell:给定表面倾角正弦与折射率,返回玻璃内 tanθ₂(顶面入射 → 底面出射的横向漂移系数)
  function tanRefracted(sinT, n) {
    var s2 = Math.min(sinT / n, 0.9999);
    return s2 / Math.sqrt(1 - s2 * s2); // = sinθ₁ / √(n² − sin²θ₁)
  }

  /**
   * 生成物理折射位移贴图(单次遍历,按分谱折射率输出 1~3 张 canvas):
   *   每个波长通道独立解 Snell:Δ_c(d) = z(d)·sinθ₁/√(n_c²−sin²₁)
   *   (v2.2 的「单贴图 × 通道缩放比」只是小角度近似;v2.3 逐通道精确,倒角高倾斜区色散更宽更准)
   *   R/G = 归一化偏移向量,B = Fresnel 透射率(Schlick);平坦区恒为中性(物理零畸变)
   * 返回 [{canvas, url, w, h, M}],M 为该通道墙面位移 ×1.15 余量(倒角带折叠区允许饱和)
   */
  function buildRefractionMaps(w, h, radius, p) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = Math.max(2, Math.round(w * dpr));
    var ch = Math.max(2, Math.round(h * dpr));
    var ns = p.iors, nc = ns.length;
    var canvases = [], ctxs = [], imgs = [], maxOff = [];
    for (var c = 0; c < nc; c++) {
      var cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      canvases.push(cv);
      ctxs.push(cv.getContext('2d'));
      imgs.push(ctxs[c].createImageData(cw, ch));
      // 墙面(d→0, sinθ₁=1)处的物理位移 ×1.15 余量,作为归一化基准
      maxOff.push(Math.max((p.thickness - p.bezel) * tanRefracted(1, ns[c]) * p.k * 1.15, 0.001));
    }
    var H = p.thickness, r = p.bezel, k = p.k;
    var r0 = Math.pow((ns[1] - 1) / (ns[1] + 1), 2); // Schlick R0(绿基准)
    var i = 0;
    for (var py = 0; py < ch; py++) {
      var y = (py + 0.5) / dpr;
      for (var px = 0; px < cw; px++, i += 4) {
        var x = (px + 0.5) / dpr;
        var d = sdRoundedRect(x, y, w, h, radius);
        if (d < 0) {
          var depth = -d;
          // 数值梯度 → 外法线(采样方向的骨架)
          var nx = sdRoundedRect(x + 1, y, w, h, radius) - sdRoundedRect(x - 1, y, w, h, radius);
          var ny = sdRoundedRect(x, y + 1, w, h, radius) - sdRoundedRect(x, y - 1, w, h, radius);
          var len = Math.hypot(nx, ny) || 1;
          nx /= len; ny /= len;
          var sinT, z;
          if (depth < r) {
            sinT = 1 - depth / r;                                      // 倒角圆弧的表面倾角
            z = (H - r) + r * Math.sqrt(Math.max(1 - sinT * sinT, 0)); // 入射点高度
          } else {
            sinT = 0; z = H;                                           // 平坦顶面:物理零畸变
          }
          var cosT = Math.sqrt(Math.max(1 - sinT * sinT, 0));
          var trans = Math.round((1 - (r0 + (1 - r0) * Math.pow(1 - cosT, 5))) * 255);
          for (var j = 0; j < nc; j++) {
            var e = z * tanRefracted(sinT, ns[j]) * k / maxOff[j];
            var data = imgs[j].data;
            data[i]     = Math.round(128 + Math.max(-1.15, Math.min(1.15, nx * e)) * 127);
            data[i + 1] = Math.round(128 + Math.min(1.15, Math.max(-1.15, ny * e)) * 127);
            data[i + 2] = trans;
            data[i + 3] = 255;
          }
        } else {
          for (var j2 = 0; j2 < nc; j2++) {
            var dat = imgs[j2].data;
            dat[i] = 128; dat[i + 1] = 128; dat[i + 2] = 255; dat[i + 3] = 255;
          }
        }
      }
    }
    var out = [];
    for (var c2 = 0; c2 < nc; c2++) {
      ctxs[c2].putImageData(imgs[c2], 0, 0);
      out.push({ canvas: canvases[c2], url: canvases[c2].toDataURL('image/png'), w: w, h: h, M: maxOff[c2] });
    }
    return out;
  }

  /* ---------- 3. SVG 滤镜:物理位移 + 分谱色散 ---------- */
  // v2.3:开色散时每通道一张独立贴图(各自精确解 Snell,不再用墙面缩放比近似);
  // 关色散时退化为单张贴图 + 单次位移,省 2/3 贴图内存与填充率。
  function buildFilterPrimitives(maps, hasDispersion) {
    var g = maps.length > 1 ? maps[1] : maps[0];
    function feImage(m, res) {
      return '<feImage href="' + m.url + '" x="0" y="0" width="' + m.w + '" height="' + m.h + '" preserveAspectRatio="none" result="' + res + '"/>';
    }
    function disp(mapRes, outRes, M) {
      return '<feDisplacementMap in="SourceGraphic" in2="' + mapRes + '" scale="' + (2 * M).toFixed(2) +
             '" xChannelSelector="R" yChannelSelector="G" result="' + outRes + '"/>';
    }
    if (!hasDispersion) {
      return feImage(g, 'map') + disp('map', 'd', g.M);
    }
    // 物理排序:红端(IOR 最低)位移最大、蓝端最小 → 边缘分带外红外蓝
    return feImage(maps[0], 'mapR') + feImage(maps[1], 'mapG') + feImage(maps[2], 'mapB') +
      disp('mapR', 'dR', maps[0].M) +
      disp('mapG', 'dG', maps[1].M) +
      disp('mapB', 'dB', maps[2].M) +
      '<feColorMatrix in="dR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cR"/>' +
      '<feColorMatrix in="dG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cG"/>' +
      '<feColorMatrix in="dB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cB"/>' +
      '<feComposite in="cR" in2="cG" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="cRG"/>' +
      '<feComposite in="cRG" in2="cB" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>';
  }

  // 全站共享一个隐藏 <svg> 滤镜池(不能用 display:none,滤镜会失效)
  function ensureDefsBucket() {
    var svg = document.getElementById('liquid-glass-defs');
    if (!svg) {
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.id = 'liquid-glass-defs';
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
      svg.innerHTML = '<defs></defs>';
      document.body.insertBefore(svg, document.body.firstChild);
    }
    return svg.querySelector('defs');
  }

  /* ---------- 4. 组件本体 ---------- */
  function makeEl(cls) { var d = document.createElement('div'); d.className = cls; return d; }

  function parseRadiusPx(cs, w, h) {
    var v = cs.borderTopLeftRadius || '';
    var m = v.match(/^([\d.]+)(.*)$/);
    if (!m) return 18;
    var val = parseFloat(m[1]);
    return m[2] === '%' ? (val / 100) * Math.min(w, h) : val;
  }

  function LiquidGlass(host, options) {
    if (!host) return null;
    if (host._liquidGlass) return host._liquidGlass;
    injectBaseStyle();

    this.host = host;
    this.o = Object.assign({}, LiquidGlass.defaults, options || {});
    this.id = nextId();
    this.mode = 'basic';
    this.filterEl = null;
    this._raf = 0;
    host._liquidGlass = this;
    host.classList.add('lg-host');
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    // 分层:surface(折射/磨砂)→ tint → rim → highlight → content(清晰内容)
    this.surface = makeEl('lg-surface');
    this.tint = makeEl('lg-tint');
    this.rim = makeEl('lg-rim');
    this.highlight = makeEl('lg-highlight');
    this.content = makeEl('lg-content');
    while (host.firstChild) this.content.appendChild(host.firstChild);
    host.appendChild(this.surface);
    host.appendChild(this.tint);
    host.appendChild(this.rim);
    host.appendChild(this.highlight);
    host.appendChild(this.content);

    this._apply();
    this._bindPointer();
    this._bindPress();

    if ('ResizeObserver' in window) {
      var self = this;
      this.ro = new ResizeObserver(function () { self._scheduleRebuild(); });
      this.ro.observe(host);
    } else {
      var self2 = this;
      window.addEventListener('resize', function () { self2._scheduleRebuild(); });
    }
    this._scheduleRebuild();
    /* 兜底:自定义元素升级 / 字体加载 / 首次布局存在竞态,首次重建可能拿不到最终几何。
       在 load 与 100~800ms 间有界重试,直到折射场求解成功(重建幂等,可安全重复) */
    var attempts = 0;
    var self3 = this;
    var retryInit = function () {
      attempts++;
      if (!self3.host.isConnected || attempts > 20) return;
      if (self3.mode !== 'refraction' && self3.o.refraction > 0 && CAN_REFRACT) {
        self3._scheduleRebuild();
        setTimeout(retryInit, 150);
      }
    };
    if (document.readyState !== 'complete') {
      window.addEventListener('load', retryInit, { once: true });
    }
    setTimeout(retryInit, 100);
    LiquidGlass.all.push(this);
  }

  LiquidGlass.defaults = {
    blur: 10,            // 磨砂半径 px(光散射)
    saturation: 1.6,     // 背景饱和度(环境色透入)
    brightness: 1.05,    // 提亮
    tint: 'rgba(255,255,255,0.08)',
    ior: 1.5,            // 折射率 n(冕牌玻璃 ≈1.5;水 1.33,蓝宝石 1.77)
    thickness: null,     // 玻璃厚度 px;默认 min(w,h) × 0.7(直壁段 H−r 决定边缘位移量)
    bezel: null,         // 倒角半径 r px;传 ≤1 小数按 min(w,h) 比例;默认 ×0.34
    dispersion: 0.08,    // 分谱折射率宽 n蓝−n红(物理冕玻璃 ≈0.007,视觉可夸大)
    refraction: 1,       // 物理倍率:1 = 严格 Snell 解,≠1 为艺术夸张
    radius: null,        // 圆角 px;默认读 CSS border-radius
    shadow: true,
    pointerGlow: true,
    press: true
  };
  LiquidGlass.all = [];
  LiquidGlass.setAll = function (partial) {
    LiquidGlass.all.forEach(function (inst) { inst.setOptions(partial); });
  };

  LiquidGlass.prototype._apply = function () {
    this.host.style.setProperty('--lg-tint', this.o.tint);
    this.host.classList.toggle('lg--shadow', !!this.o.shadow);
  };

  /* 指针跟随的镜面光 + 边缘 glint 旋转:只更新 CSS 变量 */
  LiquidGlass.prototype._bindPointer = function () {
    var host = this.host, self = this;
    host.addEventListener('pointermove', function (e) {
      if (!self.o.pointerGlow) return;
      var r = host.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      host.style.setProperty('--lg-mx', x.toFixed(1) + 'px');
      host.style.setProperty('--lg-my', y.toFixed(1) + 'px');
      /* glint 顶点(锥形 75°)转向指针方位:光从指针一侧打向倒角 */
      var ang = Math.atan2(y - r.height / 2, x - r.width / 2) * 180 / Math.PI + 90;
      host.style.setProperty('--lg-rim-rot', (ang - 75).toFixed(1) + 'deg');
      host.style.setProperty('--lg-glow', '1');
    });
    host.addEventListener('pointerleave', function () {
      host.style.setProperty('--lg-glow', '0');
    });
  };

  LiquidGlass.prototype._bindPress = function () {
    if (!this.o.press) return;
    var host = this.host;
    host.addEventListener('pointerdown', function () { host.classList.add('lg--press'); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
      host.addEventListener(t, function () { host.classList.remove('lg--press'); });
    });
  };

  LiquidGlass.prototype._scheduleRebuild = function () {
    if (this._raf) return;
    this._raf = 1;
    var self = this;
    var run = function () { if (!self._raf) return; self._raf = 0; self._rebuild(); };
    requestAnimationFrame(run);   // 有帧时对齐帧,避免撕裂
    /* 兜底:刚加载还没有合成帧、或页面完全静止时,rAF 可能长时间不出队,
       重建是纯同步几何/贴图计算,退化为宏任务执行 */
    setTimeout(run, 160);
  };

  /* 尺寸/参数变化 → 重新求解折射场(ResizeObserver 驱动) */
  LiquidGlass.prototype._rebuild = function () {
    try {
      this._rebuildInner();
      this._lastError = null;
    } catch (e) {
      // 任何重建异常都记录到实例上,并保底一层毛玻璃(避免整体失效)
      this._lastError = (e && (e.stack || e.message)) || String(e);
      this.mode = 'basic';
      this.host.classList.add('lg--basic');
      this.surface.style.backdropFilter = 'blur(' + Math.max(this.o.blur, 8) + 'px) saturate(' + this.o.saturation + ')';
      if (this.filterEl && this.filterEl.parentNode) this.filterEl.parentNode.removeChild(this.filterEl);
      this.filterEl = null;
    }
  };

  LiquidGlass.prototype._rebuildInner = function () {
    var host = this.host, o = this.o;
    var rect = host.getBoundingClientRect();
    var w = Math.round(rect.width), h = Math.round(rect.height);
    if (w < 4 || h < 4) return;

    var cs = getComputedStyle(host);
    var radius = o.radius != null ? o.radius : parseRadiusPx(cs, w, h);
    radius = Math.max(0, Math.min(radius, Math.min(w, h) / 2));

    /* 关键 Chromium 坑:border-radius 采用超大值(如 999px 药丸)时,
       backdrop-filter: url(#feDisplacementMap) 的位移会被静默丢弃(无异常、无警告)。
       解法:各层显式写入钳制后的半径(药丸钳到半高,视觉不变),宿主原值保持外观兼容 */
    var rr = radius + 'px';
    this.surface.style.borderRadius = rr;
    this.tint.style.borderRadius = rr;
    this.rim.style.borderRadius = rr;
    this.highlight.style.borderRadius = rr;

    var minDim = Math.min(w, h);
    var H = o.thickness != null
      ? (o.thickness <= 1 ? o.thickness * minDim : o.thickness)
      : minDim * 0.7;   // 玻璃厚度(直壁段 H−r 产生边缘位移)
    var bezelPx = o.bezel != null
      ? (o.bezel <= 1 ? o.bezel * minDim : o.bezel)             // ≤1 视为比例
      : minDim * 0.34;                                          // 倒角半径
    var r = Math.min(bezelPx, H - 2, minDim / 2);               // 物理约束:倒角不高于厚度

    if (this.filterEl && this.filterEl.parentNode) this.filterEl.parentNode.removeChild(this.filterEl);
    this.filterEl = null;

    var bf;
    if (CAN_REFRACT && o.refraction > 0 && H > 3 && r >= 2) {
      var dn = o.dispersion || 0;
      var nG = Math.max(o.ior, 1.05);
      var iors = dn > 0.001
        ? [Math.max(nG - dn / 2, 1.05), nG, nG + dn / 2]  // R,G,B 分谱折射率(柯西色散)
        : [nG];
      var maps = buildRefractionMaps(w, h, radius, { thickness: H, bezel: r, iors: iors, k: o.refraction });
      var defs = ensureDefsBucket();
      var filter = document.createElementNS(SVG_NS, 'filter');
      filter.id = this.id;
      filter.setAttribute('x', '-25%');
      filter.setAttribute('y', '-25%');
      filter.setAttribute('width', '150%');
      filter.setAttribute('height', '150%');
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      filter.innerHTML = buildFilterPrimitives(maps, iors.length === 3);
      defs.appendChild(filter);
      this.filterEl = filter;
      this.mode = 'refraction';
      host.classList.remove('lg--basic');
      bf = 'url(#' + this.id + ') blur(' + o.blur + 'px) saturate(' + o.saturation + ') brightness(' + o.brightness + ')';
    } else {
      this.mode = 'basic';
      host.classList.add('lg--basic');
      bf = 'blur(' + Math.max(o.blur, 8) + 'px) saturate(' + o.saturation + ') brightness(' + o.brightness + ')';
    }
    this.surface.style.webkitBackdropFilter = bf;
    this.surface.style.backdropFilter = bf;
  };

  LiquidGlass.prototype.setOptions = function (partial) {
    if (!partial) return;
    Object.keys(partial).forEach(function (k) {
      if (partial[k] !== undefined) this.o[k] = partial[k];
    }, this);
    this._apply();
    this._scheduleRebuild();
  };

  LiquidGlass.prototype.destroy = function () {
    if (this.ro) this.ro.disconnect();
    if (this.filterEl) this.filterEl.remove();
    [this.surface, this.tint, this.rim, this.highlight].forEach(function (n) { n.remove(); });
    while (this.content.firstChild) this.host.appendChild(this.content.firstChild);
    this.content.remove();
    this.host.classList.remove('lg-host', 'lg--basic', 'lg--shadow');
    var idx = LiquidGlass.all.indexOf(this);
    if (idx >= 0) LiquidGlass.all.splice(idx, 1);
    delete this.host._liquidGlass;
  };

  /* ---------- 5. <liquid-glass> 自定义元素 ---------- */
  function numAttr(v) {
    if (v == null || v === '') return undefined;
    var n = parseFloat(v);
    return isNaN(n) ? undefined : n;
  }

  var LiquidGlassElement = class extends HTMLElement {
    connectedCallback() {
      if (this._lg) return;
      var opts = {
        blur: numAttr(this.dataset.blur),
        refraction: numAttr(this.dataset.refraction),
        ior: numAttr(this.dataset.ior),
        thickness: numAttr(this.dataset.thickness),
        bezel: numAttr(this.dataset.bezel),
        dispersion: numAttr(this.dataset.dispersion),
        radius: numAttr(this.dataset.radius),
        tint: this.dataset.tint || undefined,
        shadow: this.dataset.shadow !== 'off',
        pointerGlow: this.dataset.glow !== 'off',
        press: this.dataset.press !== 'off'
      };
      Object.keys(opts).forEach(function (k) { if (opts[k] === undefined) delete opts[k]; });
      this._lg = new LiquidGlass(this, opts);
    }
  };
  if (!customElements.get('liquid-glass')) {
    customElements.define('liquid-glass', LiquidGlassElement);
  }

  window.LiquidGlass = LiquidGlass;
  LiquidGlass.version = '2.3';
  LiquidGlass.CAN_REFRACT = CAN_REFRACT; // 暴露给徽章/调试:当前浏览器是否支持 backdrop SVG 滤镜
})();
