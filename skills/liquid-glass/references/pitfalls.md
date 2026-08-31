# Liquid Glass 坑手册与物理推导

## 一、物理模型(v2.3,俯视 UI 玻璃)

玻璃 = 平板(厚 H)+ 边缘圆角倒角(fillet 半径 r),视线垂直向下。

1. **表面轮廓**:d 为像素到边缘的内部距离(圆角矩形 SDF,数值梯度即外法线方向)。
   - `d ≥ r`:平坦顶面,倾角 0 → **物理零畸变**(这是与凸透镜近似的本质区别)
   - `d < r`:四分之一圆弧倒角,`sinθ₁ = 1 − d/r`,入射高度 `z(d) = H − r + √(r² − (r−d)²)`
2. **Snell 定律**:`sinθ₂ = sinθ₁ / n`
3. **所见偏移**(屏幕点 P 显示的是折射光线到达玻璃底面的位置):
   `Δ(d) = z(d) · tanθ₂ = z(d) · sinθ₁ / √(n² − sin²₁)`,方向沿法线水平分量(向外)
   - 直壁段 (H−r) 越高、n 越接近 1,位移越大(n→1 发散,**∂Δ/∂n < 0**,勿写反)
   - n=1.5 时墙面位移 ≈ 0.89×(H−r)
4. **分谱色散**:n(蓝) > n(绿) > n(红) → tanθ₂ 随 n 减小 → **红端图像位移最大、蓝端最小**,
   倒角带由外向内呈红→绿→蓝排序。每通道一张独立贴图各自精确解算(v2.3 前「绿贴图×墙面缩放比」
   只是 paraxial 近似,大角度误差可达 5%)。
5. **Fresnel**:Schlick 近似 `R(θ) = R₀ + (1−R₀)(1−cosθ)⁵`,透射率 T=1−R 编码进贴图 B 通道
   (墙面 T→0 近乎全反射;cos⁵ 特性使其只在贴墙 1–2px 内骤降,这是正确物理,勿当作 bug)。
6. **平台限制**:`feDisplacementMap` 只弯折采样、不聚光 → 无真实焦散(W3C svgwg#1142);
   本模型顶入底出,θ₂ ≤ 临界角,不发生 TIR(TIR 只在「底进侧出」路径)。

## 二、实现要点

- DOM 分层(内容层独立于滤镜,文字永不扭曲):
  `host > .lg-surface(backdrop-filter: url(#滤镜) blur() saturate()) + .lg-tint + .lg-rim + .lg-highlight + .lg-content`
- 位移贴图:canvas 逐像素解算 → PNG dataURL → `feImage` → `feDisplacementMap`。
  编码:`R/G = 128 + 归一化偏移×127`(归一化基准 = 墙面位移 ×1.15 余量,折叠区饱和无害);
  `feDisplacementMap` 偏移 = `scale × (通道值 − 0.5)` → `scale = 2 × M`。
- 滤镜链:开色散 = 3×(feImage+feDisplacementMap)+ 3×feColorMatrix 取通道 + 2×feComposite 算术叠加;
  关色散退化为单贴图单位移。
- 尺寸变化经 ResizeObserver + setTimeout 兜底重解;调度必须带 setTimeout 通道(见坑 5)。
- 跨页共享一个隐藏滤镜池 `<svg id="liquid-glass-defs">`(**不能 display:none**,滤镜会失效)。

## 三、Chromium 静默失效清单(全部实测复现,违反即「只剩 blur、毫无折射」)

| # | 触发条件 | 机制/证据 | 规避 |
| --- | --- | --- | --- |
| 1 | 玻璃宿主内**兄弟层**带 `mix-blend-mode`(含 plus-lighter) | 宿主被迫成合成层,backdrop 位移整体丢弃。证据:隐藏 `.lg-highlight` 的一瞬间边缘彩虹立即出现 | 高光层用普通白色渐变;用户层严禁混合模式 |
| 2 | 宿主/层 `border-radius: 999px` 药丸 | 同滤镜克隆:12px/40px 狂野折射,999px 全平 | 各层半径显式钳制到 min(w,h)/2(视觉不变) |
| 3 | 祖先带 filter / opacity<1 / mask / isolation:isolate(或 will-change) | 形成 backdrop root 截断采样 | 祖先链保持干净 |
| 4 | 脚本缓存旧版 | 旧 JS 无新参数 → 参数全部静默无效 | script 标签带 ?v=N;徽章显示 LiquidGlass.version |
| 5 | 页面无合成帧时 rAF 不出队 | 排队在 rAF 上的重建全部滞留,实例卡 basic | 调度加 setTimeout 通道 + 有界重试 + `_lastError` 记录 |

## 四、调试方法论(本环境实测有效)

1. **贴图数值断言**(最严格):解码实际下发 feImage 的 dataURL → drawImage → getImageData,
   逐点对照解析解。健康指标:中心 R=G=128(零畸变)、B≈245+(全透射);墙面 |R−128|≈127
   (向外最大);从墙向中心单调衰减;d=8px 处贴图值与解析值差 ≤3(8-bit 量化)。
2. **开关往返 + 强制出帧**:`setOptions({refraction:0/1})` 各截一帧;截图前翻转一次 body
   内联样式强制合成器出帧。本环境静置读数可能撞上 rAF 冻结(mode 延迟自愈)、裁剪截图
   坐标系偏移——**视觉结论必须全屏目检 + DOM 数值断言双确认**。
3. 失效排查顺序:mode 是否 refraction → `_lastError` → backdrop-filter 内联值 → 滤镜池
   filter 是否存在 → 逐项对上表 1–3。
4. `||` 短路表达式里做 DOM 副作用必踩坑(曾让 bisect 的 `highlight.remove()` 从未执行,
   拖偏整个排查方向)——副作用单独写语句。

## 五、浏览器支持

| 浏览器 | 折射+色散 | 结果 |
| --- | --- | --- |
| Chrome/Edge/其他 Chromium | ✅ | 完整液态玻璃 |
| Safari | ❌ WebKit bug 245510 | 自动降级 basic(纯 blur 毛玻璃) |
| Firefox | ❌ 未实现 | 同上 |

组件按 UA + `CSS.supports` 探测;`LiquidGlass.CAN_REFRACT`、`instance.mode`、页面徽章可查。
设计约定(与 Apple HIG 一致):玻璃是**功能层材质**(导航/悬浮控件/CTA),不要全站卡片化。
