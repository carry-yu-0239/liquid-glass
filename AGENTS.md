# AGENTS.md

This file provides guidance to Lingma (lingma.aliyun.com) when working with code in this repository.

## 项目概述

LiquidGlass.js — 零依赖、单文件的 iOS 26「液态玻璃」Web 组件（vanilla JS，无构建系统、无包管理器、无测试框架）。核心是 `liquid-glass.js`（约 500 行）：用 `backdrop-filter: url(#SVG滤镜)` + 圆角矩形 SDF 逐像素解析求解 Snell 折射定律生成位移贴图，视觉完全由物理参数（折射率 / 厚度 / 倒角半径）决定，非 Chromium 浏览器自动降级为纯 blur 毛玻璃。

## 常用命令

```powershell
# 本地预览 index.html（项目根目录启动静态服务器，然后访问 http://localhost:8000/）
python -m http.server 8000
```

无 build / lint / test 流程。验证方式：
- 打开 `index.html`（跑马灯 / 照片接缝 / 可拖拽玻璃 / 折射率滑杆实时热切换）；
- 控制台检查 `window.LiquidGlass.version`（当前 2.3）、`LiquidGlass.CAN_REFRACT`、`LiquidGlass.all.map(i => i.mode)` —— 出现 `'basic'` 说明降级（浏览器不支持或踩了静默坑，见下）。

## 架构

- `liquid-glass.js` — 组件本体（IIFE，零依赖）。关键流程：能力检测（`CAN_REFRACT`，UA + `CSS.supports`）→ `sdRoundedRect`（SDF）逐像素解 Snell 生成每通道位移贴图（R/G/B 各自独立解算，B 通道编码 Schlick Fresnel 透射率）→ 动态构建 SVG `feDisplacementMap` 滤镜挂到全站共享的隐藏 `<svg id="liquid-glass-defs">` 池 → 写入 `.lg-surface` 的 `backdrop-filter`。DOM 分层：`.lg-surface`（折射/磨砂）→ `.lg-tint` → `.lg-rim`（锥形光谱环，glint 随指针方位旋转）→ `.lg-highlight`（指针光斑）→ `.lg-content`（内容不参与折射，文字永不扭曲）。支持自定义元素 `<liquid-glass data-*>` 与 JS API `new LiquidGlass(el, opts)` 双用法。
- `index.html` — 独立验证页（原 demo.html）；script 标签必须带 `?v=N` 版本参数防缓存。
- `skills/liquid-glass/` — 可分发的 Skill 打包（`assets/` 内是组件与 demo 的**捆绑副本**，根目录文件为主源码；`references/pitfalls.md` 是 Chromium 静默失效坑清单 + 调试方法论）。**修改根目录组件后需同步 `skills/liquid-glass/assets/liquid-glass.js`**。

## 关键约束（Chromium 静默杀手，违反任意一条位移直接消失且无警告）

1. 玻璃宿主内任何兄弟层禁用 `mix-blend-mode`（含 plus-lighter）——会迫使宿主成为合成层，`backdrop-filter` 位移被静默丢弃。
2. 宿主禁止 `border-radius: 999px` 药丸写法（组件已把各层半径钳制到 `min(w,h)/2` 规避，不要覆盖层圆角）。
3. 玻璃祖先链保持干净：祖先带 `filter` / `opacity<1` / `mask` / `isolation:isolate`（或其 will-change）会形成 backdrop root 截断采样。
4. 滤镜 SVG 池不能 `display:none`（会失效）；组件内部已有 rAF + setTimeout 兜底通道应对「无合成帧时 rAF 冻结」。

调试失效时先读 `skills/liquid-glass/references/pitfalls.md` 的调试方法论（开关往返 + 强制出帧取证、逐点断言位移贴图与 Snell 解析解）。
