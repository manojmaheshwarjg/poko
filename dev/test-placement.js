/* Pure check of caption placement: no DOM, no browser.
   The menu case below is the real bug seen on 2026-09-23, where the caption for
   "Choose Edit permissions" landed on top of "Use a different scheme", which is
   the option that step's reasoning tells you not to pick. */
global.window = {};
require('../core/highlighter.js');
const { choosePlacement, overlapArea } = global.window.CC.highlighter;

const box = (left, top, right, bottom) => ({ left, top, right, bottom });
const obstacle = (rect, weight = 1) => ({ rect, weight });
const VIEWPORT = { w: 1140, h: 800 };

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
}

/* 1. Nothing in the way: preference order should hold. */
{
  const target = box(300, 300, 420, 330);
  const p = choosePlacement(target, { w: 160, h: 28 }, [obstacle(target, 4)], VIEWPORT);
  check('open space uses below-left', p.name === 'below-left', `got ${p.name}`);
  check('open space covers nothing', p.covered === 0);
}

/* 2. The real bug: an open menu directly below the target. */
{
  const editPermissions = box(674, 96, 882, 128);
  const useDifferentScheme = box(674, 136, 882, 168);
  const copyScheme = box(674, 166, 882, 198);
  const actionsButton = box(800, 52, 884, 84);

  const obstacles = [
    obstacle(useDifferentScheme),
    obstacle(copyScheme),
    obstacle(actionsButton),
    obstacle(editPermissions, 4),
  ];
  const p = choosePlacement(editPermissions, { w: 168, h: 28 }, obstacles, VIEWPORT);

  check('menu case covers nothing', p.covered === 0, `placement ${p.name}, covered ${p.covered}`);
  check(
    'menu case misses "Use a different scheme"',
    overlapArea(p.rect, useDifferentScheme) === 0,
    `overlap ${overlapArea(p.rect, useDifferentScheme)}px2`
  );
  check('menu case misses "Copy scheme"', overlapArea(p.rect, copyScheme) === 0);

  /* What the old code did, for contrast. */
  const old = { left: 674, top: 136, right: 674 + 168, bottom: 136 + 28 };
  check(
    'old placement genuinely was broken',
    overlapArea(old, useDifferentScheme) > 0,
    `old overlap ${overlapArea(old, useDifferentScheme)}px2`
  );
}

/* 3. Target near the bottom edge: prefer above over being shoved up onto things. */
{
  const target = box(300, 745, 420, 775);
  const p = choosePlacement(target, { w: 160, h: 28 }, [obstacle(target, 4)], VIEWPORT);
  check('bottom edge flips above', p.rect.top < target.top, `top ${p.rect.top}`);
  check('bottom edge stays in viewport', p.rect.bottom <= VIEWPORT.h);
}

/* 4. Never cover the highlighted element itself. */
{
  const target = box(500, 400, 700, 440);
  const crowd = [
    obstacle(box(500, 448, 700, 488)),
    obstacle(box(500, 352, 700, 392)),
    obstacle(target, 4),
  ];
  const p = choosePlacement(target, { w: 160, h: 28 }, crowd, VIEWPORT);
  check('never covers the target', overlapArea(p.rect, target) === 0, `placement ${p.name}`);
}

/* 5. Boxed in on every side: still picks the least bad, and says so. */
{
  const target = box(500, 400, 620, 430);
  const crowd = [
    obstacle(box(300, 438, 900, 478)),
    obstacle(box(300, 352, 900, 392)),
    obstacle(box(628, 380, 900, 450)),
    obstacle(box(200, 380, 492, 450)),
    obstacle(target, 4),
  ];
  const p = choosePlacement(target, { w: 160, h: 28 }, crowd, VIEWPORT);
  check('boxed in still returns a placement', !!p && p.rect.left >= 0);
  check('boxed in reports what it covered', p.covered > 0, `covered ${Math.round(p.covered)}px2`);
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
