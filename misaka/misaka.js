/* ══════════════════════════════════════════════════════════
   Cover Flow — 惯性拖拽 + 物理吸附 + 3D + 文字联动
   原生 JS + CSS transform（无第三方库）
   移动端 / prefers-reduced-motion 降级为 scroll-snap 列表
   ══════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const wrap    = document.getElementById('coverflow');
  const stage   = document.getElementById('cfStage');
  const items   = Array.from(stage.querySelectorAll('.coverflow__item'));
  const details = document.getElementById('details');
  const inner   = document.getElementById('detailsInner');
  const dTitle  = document.getElementById('dTitle');
  const dDesc   = document.getElementById('dDesc');
  const dAct    = document.getElementById('dActions');

  const N = items.length;
  if (!N) return;

  /* ── 参数 ─────────────────────────────────────────────── */

  const spring = { k: 0.11, damp: 0.78, snap: 0.08 };   // 弹簧：劲度 / 阻尼 / 归位阈值
  const momentumFric = 0.94;                             // 松手惯性衰减
  const VEL_SNAP     = 0.45;                             // 速度阈值：越过就翻页
  const TILT_MAX     = 48;                               // 两侧卡片最大 rotateY
  const BRIGHT_MIN   = 0.55;                             // 两侧卡片最小亮度

  let pos = 0;        // 浮点位置（卡片步距为 1）
  let target = 0;     // 目标格
  let vel = 0;        // 惯性速度
  let mode = 'anim';  // 'anim' | 'scroll'
  let dragging = false;
  let raf = 0;
  let lastIdx = -1;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mod   = (n, m) => ((n % m) + m) % m;

  /* ── 3D 布局 ─────────────────────────────────────────── */

  function layout(p) {
    const gap = parseFloat(getComputedStyle(document.documentElement)
                    .getPropertyValue('--gap')) || 36;
    const cardW = items[0].offsetWidth || 240;

    items.forEach((el, i) => {
      let d = i - p;
      // 循环：只渲染最近的 ±2 张，其余藏起来（视觉上等同环绕）
      d = mod(d + N / 2, N) - N / 2;
      const ad = Math.abs(d);

      if (ad > 2.4) { el.style.opacity = '0'; el.style.visibility = 'hidden'; return; }
      el.style.visibility = 'visible';

      // 平面位移：中间 0，两侧按步距展开（略带透视压缩）
      const x = d * gap + (cardW * 0) + d * cardW * 0.42;
      const rotY = clamp(-d * TILT_MAX, -TILT_MAX, TILT_MAX);   // 外侧向内倾斜
      const z    = -ad * 90;                                     // 越远越后
      const bright = clamp(1 - ad * (1 - BRIGHT_MIN) * 0.9, BRIGHT_MIN, 1);
      const scale  = 1 - ad * 0.05;
      const op     = clamp(1 - ad * 0.18, 0, 1);

      el.style.transform =
        `translate(-50%,0) translateX(${x.toFixed(2)}px) translateZ(${z.toFixed(1)}px)` +
        ` rotateY(${rotY.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      el.style.filter = `brightness(${bright.toFixed(3)})`;
      el.style.opacity = op.toFixed(3);
      el.style.zIndex = String(100 - Math.round(ad * 10));
      el.setAttribute('aria-selected', ad < 0.5 ? 'true' : 'false');
    });
  }

  /* ── 动画主循环（惯性 → 弹簧吸附）───────────────────── */

  function tick() {
    if (dragging) { raf = requestAnimationFrame(tick); return; }

    if (Math.abs(vel) > 0.001) {
      // 松手惯性：速度衰减，推动 pos
      pos += vel;
      vel *= momentumFric;
      if (Math.abs(vel) < 0.02) vel = 0;
      // 惯性结束自然进入吸附
    } else {
      // 弹簧吸附到最近的整数格
      const diff = target - pos;
      pos += diff * spring.k;
      vel  = 0;
      if (Math.abs(diff) < spring.snap) pos = target;
    }

    // 持续把 target 吸附到 pos 最近格（拖拽结束瞬间接管）
    if (!dragging) target = Math.round(pos);

    layout(pos);
    syncDetails(Math.round(pos));

    const settled = Math.abs(target - pos) < 0.001 && vel === 0;
    raf = settled ? 0 : requestAnimationFrame(tick);
  }

  function kick() { if (!raf) raf = requestAnimationFrame(tick); }

  /* ── 文字联动：Details 淡入淡出 ─────────────────────── */

  function syncDetails(idx) {
    idx = mod(idx, N);
    if (idx === lastIdx) return;
    lastIdx = idx;

    const el = items[idx];
    const write = () => {
      dTitle.textContent = el.dataset.title || '';
      dDesc.textContent  = el.dataset.desc  || '';
      if (el.dataset.link) {
        dAct.innerHTML = '';
        const a = document.createElement('a');
        a.className = 'details__link';
        a.href = el.dataset.link;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = el.dataset.linkText || '查看详情';
        dAct.appendChild(a);
      } else {
        dAct.innerHTML = '';
      }
      stage.setAttribute('aria-activedescendant', el.id);
      inner.classList.remove('is-fading');
    };

    inner.classList.add('is-fading');
    setTimeout(write, 180);   // 等淡出到一半再换文字，避免闪跳
  }

  /* ── 拖拽 / 滚轮 / 键盘 ─────────────────────────────── */

  function pointerDown(e) {
    if (mode === 'scroll') return;
    dragging = true;
    wrap.classList.add('is-dragging');
    wrap.setPointerCapture?.(e.pointerId);
    startX = e.clientX;
    startPos = pos;
    vel = 0;
    kick();
  }

  let startX = 0, startPos = 0, lastX = 0, lastT = 0;

  function pointerMove(e) {
    if (!dragging || mode === 'scroll') return;
    const dx = e.clientX - startX;
    const cardW = items[0].offsetWidth || 240;
    pos = startPos - dx / cardW;            // 拖动距离 → 卡片位移
    pos = clamp(pos, -0.6, N - 0.4);        // 两端留阻尼

    // 瞬时速度（px/ms → 卡片单位）
    const now = performance.now();
    if (lastT) {
      const dt = now - lastT;
      if (dt > 0) vel = -((e.clientX - lastX) / cardW) * (16 / dt);
    }
    lastX = e.clientX; lastT = now;
    layout(pos);
  }

  function pointerUp() {
    if (!dragging) return;
    dragging = false;
    wrap.classList.remove('is-dragging');

    // 惯性越过半张卡 → 翻页，否则回弹
    let next = Math.round(pos);
    if (Math.abs(vel) > VEL_SNAP) {
      next = vel > 0 ? Math.ceil(pos) : Math.floor(pos);
    }
    target = clamp(next, 0, N - 1);
    pos = clamp(pos, -0.6, N - 0.4);
    kick();
  }

  wrap.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('pointercancel', pointerUp);

  // 滚轮：横向意图 → 翻一张
  wrap.addEventListener('wheel', (e) => {
    if (mode === 'scroll') return;
    const dir = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(dir) < 4) return;
    e.preventDefault();
    target = clamp(target + (dir > 0 ? 1 : -1), 0, N - 1);
    kick();
  }, { passive: false });

  // 键盘：左右翻页
  wrap.tabIndex = 0;
  wrap.addEventListener('keydown', (e) => {
    if (mode === 'scroll') return;
    if (e.key === 'ArrowRight') { target = clamp(target + 1, 0, N - 1); kick(); e.preventDefault(); }
    if (e.key === 'ArrowLeft')  { target = clamp(target - 1, 0, N - 1); kick(); e.preventDefault(); }
  });

  // 点击卡片 → 吸附到它
  items.forEach((el, i) => {
    el.addEventListener('click', () => {
      if (mode === 'scroll') return;
      target = i; kick();
    });
  });

  /* ── 移动端降级：scroll-snap ─────────────────────────── */

  const mq = window.matchMedia('(max-width: 640px)');
  function applyMode() {
    if (mq.matches) {
      mode = 'scroll';
      cancelAnimationFrame(raf); raf = 0;
      wrap.classList.add('is-scrollmode');
      layout(0);                       // 复位 transform（CSS !important 兜底）
      syncDetails(0);
      lastIdx = -1;
      // 滚动联动 Details
      wrap.addEventListener('scroll', onScroll, { passive: true });
    } else {
      mode = 'anim';
      wrap.classList.remove('is-scrollmode');
      wrap.removeEventListener('scroll', onScroll);
      pos = clamp(Math.round(pos), 0, N - 1);
      target = pos;
      layout(pos); syncDetails(pos); kick();
    }
  }
  let scrollRaf = 0;
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const cardW = (items[0].offsetWidth || 200) + 16;
      const idx = Math.round(wrap.scrollLeft / cardW);
      syncDetails(idx);
    });
  }
  mq.addEventListener('change', applyMode);

  /* ── 初始化 ──────────────────────────────────────────── */

  layout(pos);
  syncDetails(pos);
  applyMode();
  kick();
})();
