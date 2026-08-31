# LiquidGlass.js — 物理折射版「液态玻璃」通用组件

零依赖、单文件的 Web 复刻版 iOS 26 Liquid Glass。**位移场按 Snell 折射定律逐像素解析求解**,
视觉完全由物理参数(折射率 / 厚度 / 倒角半径)决定,而非美术近似。

## 快速开始

```html
<script src="liquid-glass.js" defer></script>
```

```html
<!-- 用法一:自定义元素(data-* 传参;thickness/bezel ≤1 的小数按 min(w,h) 比例取值) -->
<liquid-glass data-ior="1.5" data-thickness="24" data-bezel="0.4" data-dispersion="0.12">
  <button>按钮文字(永不参与折射)</button>
</liquid-glass>
```

```js
// 用法二:JS API,可作用于任意元素
const lg = new LiquidGlass(document.querySelector('#box'), { ior: 1.5, thickness: 24 });
lg.setOptions({ ior: 1.9 });          // 运行时热切换
LiquidGlass.setAll({ dispersion: 0 }); // 全部实例
```

## 物理模型(俯视 UI 玻璃)

玻璃 = 平板(厚 H)+ 边缘圆角倒角(fillet 半径 r),视线垂直向下:

1. **表面轮廓** d 为到边缘的内部距离(SDF)。`d ≥ r` 为平坦顶面(倾角 0);
   `d < r` 为四分之一圆弧:`sinθ₁ = 1 − d/r`,入射高度 `z(d) = H − r + √(r² − (r−d)²)`
2. **Snell 定律** `sinθ₂ = sinθ₁ / n`
3. **所见偏移** `Δ(d) = z(d)·tanθ₂ = z(d)·sinθ₁/√(n²−sin²₁)`,方向沿法线水平分量(向外)
   - 物理推论:平坦中心**零畸变**;倒角带把玻璃足迹之外的背景「拉入」边缘;
     直壁段(H−r)越高位移越大;**n 越接近 1 位移越大**(n→1 发散,∂Δ/∂n < 0),
     n=1.5 时墙面处 ≈0.89×(H−r)
4. **分谱色散** n(蓝) > n(绿) > n(红) → tanθ₂ 随 n 减小 → **红端图像位移最大、蓝端最小**,
   边缘分带由外向内呈 红→绿→蓝 的物理正确排序。v2.3 起**每通道一张独立贴图、各自精确解
   Snell**(不再用绿通道 × 缩放比的小角度近似),倒角高倾斜区色散更宽更准
5. **Fresnel** Schlick 近似透射率 `T(θ)` 编码进位移贴图 B 通道(墙面处 T→0,近乎全反射)
6. **锥形光谱环(v2.3)**:rim 层为 conic-gradient 描边环——主 glint(75°)+ 对侧次亮弧,
   glint 两侧带暖→冷的光谱微染,且随指针方位旋转(`--lg-rim-rot`,@property 注册可过渡),
   模拟光随视角打在倒角上

> 说明:①本模型光线自顶面入射、底面出射,θ₂ ≤ 临界角,不发生 TIR(TIR 只出现在「底进侧出」);
> ②`feDisplacementMap` 只能弯折采样、无法聚光,故没有真实焦散——W3C svgwg#1142 承认的平台限制;
> ③feDisplacementMap 无法逐通道更换 IOR,红/蓝通道取墙面工况的位移比缩放,小角度区间解析精确。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `ior` | 1.5 | 折射率 n(水 1.33,冕玻璃 1.5,蓝宝石 1.77) |
| `thickness` | `min(w,h)×0.6` | 玻璃厚度 px(≤1 小数 = 比例) |
| `bezel` | `min(w,h)×0.34` | 倒角半径 r px(≤1 小数 = 比例);物理约束 r ≤ H |
| `dispersion` | 0.08 | 分谱折射率宽 n(蓝)−n(红);物理冕玻璃 ≈0.007,视觉可夸大 |
| `refraction` | 1 | 物理倍率:**1 = 严格 Snell 解**,≠1 为艺术夸张 |
| `blur` / `saturation` / `brightness` | 10 / 1.6 / 1.05 | 磨砂与增艳 |
| `tint` | `rgba(255,255,255,.08)` | 着色层 |
| `radius` | 读 CSS `border-radius` | 圆角(折射场按它生成 SDF) |
| `shadow` / `pointerGlow` / `press` | true | 阴影 / 指针高光 / 按压缩放 |

内部结构(**内容层不参与折射,文字永不扭曲**):

```
host
├─ .lg-surface    backdrop-filter = url(#物理位移+分谱滤镜) blur() saturate()
├─ .lg-rim        锥形光谱环:crisp 描边 + 主/次 glint(随 --lg-rim-rot 指针联动旋转)
├─ .lg-highlight  指针跟随 radial 高光(禁止 mix-blend-mode,见坑清单)
└─ .lg-content    任意内容
```

## 浏览器支持

| 浏览器 | 折射 + 色散 | 结果 |
| --- | --- | --- |
| Chrome / Edge / 其他 Chromium | ✅ `backdrop-filter: url(#svg)` | 完整液态玻璃 |
| Safari | ❌(WebKit bug 245510) | 自动降级纯 blur 毛玻璃 |
| Firefox | ❌(未实现) | 同上 |

组件按 UA + `CSS.supports` 自动降级并打 `lg--basic` 类;`instance.mode` 可读当前模式。

## 已知坑(务必阅读,全部实测踩过)

- **兄弟层 mix-blend-mode 静默杀死位移(最隐蔽)**:玻璃宿主内任何兄弟层带
  `mix-blend-mode`(含 plus-lighter)会迫使宿主成为合成层,Chromium 会**静默丢弃**
  `.lg-surface` 的 backdrop 位移——无异常、无警告、blur 照常。组件 v2.2 起高光层
  已改用普通白色渐变规避;自行给玻璃加发光/混合层时务必警惕;
- **超大 border-radius 同样静默丢弃位移**:`border-radius: 999px` 这类药丸写法会让
  backdrop 位移失效(12px/40px/半高值均正常)。组件已把各层半径显式钳制到
  `min(w,h)/2`(视觉不变),宿主写 999px 也没关系;
- **rAF 在无合成帧时不执行**:页面刚加载、静止无动画时,排队在 rAF 上的重建不会运行。
  组件已加 setTimeout 兜底通道 + 有界重试 + `_lastError` 记录,并暴露
  `LiquidGlass.CAN_REFRACT` / `LiquidGlass.version`;
- **backdrop root**:玻璃祖先带 `filter`、`opacity<1`、`mask`、`isolation:isolate`
  (或其 `will-change`)会截断 backdrop 采样——保持祖先链干净;
- 全站滤镜统一注册在单个隐藏 `<svg id="liquid-glass-defs">` 池(不能 `display:none`);
- **缓存**:`liquid-glass.js` 改版后浏览器可能仍跑旧文件(表现为参数全部无效),
  demo 的 script 标签带 `?v=` 版本参数,右下角徽章会显示组件版本;
- Liquid Glass 属**功能层材质**(导航 / 悬浮控件 / CTA),不要全站卡片化滥用——与 Apple HIG 一致。

## 文件

- `liquid-glass.js` 组件(约 350 行,含物理推导注释)
- `demo.html` 独立验证页:跑马灯 / 照片接缝 / 可拖拽玻璃 / 折射率滑杆(1.10–1.90)实时热切换,
  访问 `http://localhost:8000/liquid-glass/demo.html`(项目根 `python -m http.server 8000`)
