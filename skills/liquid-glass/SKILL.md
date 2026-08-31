---
name: liquid-glass
description: 在任意 Web 前端项目中集成 iOS 26 风格「液态玻璃」物理折射组件(零依赖单文件 liquid-glass.js,捆绑可复制的成品源码)。Use whenever the user mentions 液态玻璃、Liquid Glass、玻璃拟态、玻璃质感/磨砂按钮、导航、卡片、iOS 26 风格 UI,或想要透镜折射、边缘色散、镜面高光、光斑跟随等"真玻璃"效果——哪怕只说"把这个按钮/导航做成玻璃的"。也用于玻璃效果不显示、折射失效的排查。
---

# 液态玻璃(Liquid Glass)物理折射组件

零依赖单文件组件:`backdrop-filter: url(#SVG滤镜)` + 圆角矩形 SDF 逐像素解 **Snell 折射定律**——
边缘把玻璃足迹之外的背景拉入倒角带(平坦中心物理零畸变),R/G/B 每通道独立解算产生物理正确的
「外红内蓝」色散,叠加锥形光谱环高光(glint 随指针方位旋转)、磨砂增艳、按压/拖拽液体反馈。
非 Chromium 浏览器自动降级为纯 blur 毛玻璃。

## 捆绑文件(直接复制使用,勿凭记忆重写——位移场是逐像素物理解算,凭印象写必然走样)

| 文件 | 用途 |
| --- | --- |
| [assets/liquid-glass.js](assets/liquid-glass.js) | 组件本体 v2.3(含物理推导注释),**原样复制**到目标项目 |
| [assets/demo.html](assets/demo.html) | 完整演示页:跑马灯/照片接缝/可拖拽玻璃/参数控制台(图片引用原项目 images/,单独拷出时显示 alt 占位) |
| [references/pitfalls.md](references/pitfalls.md) | Chromium 静默失效坑清单(附实测证据)、物理模型推导、参数详解、调试方法论 |

## 集成步骤

1. 复制 `assets/liquid-glass.js` 到目标项目(如 `js/liquid-glass.js`),script 标签**必须带版本参数防缓存**:
   ```html
   <script src="js/liquid-glass.js?v=1" defer></script>
   ```
2. 两种用法任选:
   ```html
   <!-- 声明式:内容直接写在标签内,内容层独立于滤镜,文字永不扭曲 -->
   <liquid-glass data-ior="1.5" data-thickness="0.6" data-bezel="0.35" data-dispersion="0.15">
     <button>按钮文字</button>
   </liquid-glass>
   ```
   ```js
   // JS API:可作用于任意元素,运行时热切换
   const lg = new LiquidGlass(el, { ior: 1.5, thickness: 0.6 });
   lg.setOptions({ ior: 1.9, dispersion: 0.3 });
   ```
3. 验证:`window.LiquidGlass.version`(当前 2.3)、`LiquidGlass.CAN_REFRACT`、
   `LiquidGlass.all.map(i => i.mode)` 全为 `'refraction'`——出现 `'basic'` 说明踩了下面的坑或浏览器不支持。

## 核心参数(≤1 的小数 = min(w,h) 比例;>1 = px)

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `ior` | 1.5 | 折射率 n(水 1.33/冕玻璃 1.5/蓝宝石 1.77);**n 越接近 1 边缘位移越大** |
| `thickness` / `bezel` | ×0.7 / ×0.34 | 玻璃厚度 / 倒角半径;直壁段 (H−r) 决定边缘位移强度 |
| `dispersion` | 0.08 | 分谱折射率宽 n(蓝)−n(红);物理冕玻璃 ≈0.007,视觉可夸大 |
| `refraction` | 1 | 1 = 严格 Snell 解;≠1 为艺术夸张 |
| `blur` / `saturation` / `brightness` | 10 / 1.6 / 1.05 | 磨砂与增艳 |
| `shadow` / `pointerGlow` / `press` | true | 阴影 / 指针高光+glint 旋转 / 按压缩放 |

## 四个 Chromium 静默杀手(违反任意一条,位移直接消失,无报错无警告)

1. **玻璃宿主内任何兄弟层带 `mix-blend-mode`**(含 plus-lighter)——宿主被迫成为合成层,
   surface 的 backdrop 位移被整体丢弃。组件高光层已规避;用户自行加发光层时严禁混合模式。
2. **宿主 `border-radius: 999px` 药丸写法**——位移同样静默失效(12px/40px/半高值均正常)。
   组件已把各层半径显式钳制到 min(w,h)/2 规避,不要覆盖层圆角。
3. **祖先带 `filter` / `opacity<1` / `mask` / `isolation:isolate`**(或其 will-change)——
   形成 backdrop root 截断采样。保持玻璃祖先链干净。
4. **脚本缓存**——改版后浏览器可能仍跑旧 JS(表现:所有参数静默无效)。script 标签永远带
   `?v=N`;页面徽章显示 `LiquidGlass.version` 可直接识别。

排查失效时先读 [references/pitfalls.md](references/pitfalls.md) 的「调试方法论」:
逐点断言位移贴图与 Snell 解析解、开关往返 + 强制出帧取证、警惕静置读数撞上 rAF 冻结。
