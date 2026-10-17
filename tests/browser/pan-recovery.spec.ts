import { resolve } from 'node:path';
import { test, expect, type Page } from './fixtures';

const transform = (page: Page) =>
  page.locator('.react-flow__viewport').evaluate((element) => getComputedStyle(element).transform);

for (const offline of [false, true]) {
  for (const interruption of ['missing-mouseup', 'blur', 'hidden'] as const) {
    test(`パン中断後にマウス移動で図が動かず再ドラッグできる (${interruption}, ${offline ? 'HTML' : '開発画面'})`, async ({
      page,
      context,
    }) => {
      // OS / ブラウザーの外で離した mouseup が届かない状態を再現する。
      await page.addInitScript(() => {
        window.addEventListener(
          'mouseup',
          (event) => {
            if (document.documentElement.hasAttribute('data-drop-mouseup'))
              event.stopImmediatePropagation();
          },
          true,
        );
      });
      if (offline) await context.setOffline(true);
      await page.goto(
        offline
          ? 'file://' + resolve('artifacts/aws.html')
          : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
      );
      await expect(page.locator('.canvas-footer')).toContainText('19 要素');
      // 初期 fitView が完了してからパンを開始する。
      await page.locator('.react-flow__viewport').evaluate(async () => {
        for (let frame = 0; frame < 35; frame++) await new Promise(requestAnimationFrame);
      });
      const start = await page.locator('.react-flow__pane').evaluate((pane) => {
        const bounds = pane.getBoundingClientRect();
        for (let y = bounds.bottom - 180; y > bounds.top + 150; y -= 40)
          for (let x = bounds.left + 40; x < bounds.right - 200; x += 40)
            if (document.elementFromPoint(x, y) === pane) return { x, y };
        throw new Error('パン開始用の背景が見つかりません');
      });
      const before = await transform(page);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 60, start.y + 50, { steps: 5 });
      await expect.poll(() => transform(page)).not.toBe(before);
      const panned = await transform(page);

      if (interruption === 'blur') {
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      } else if (interruption === 'hidden') {
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden',
          });
          document.dispatchEvent(new Event('visibilitychange'));
          Reflect.deleteProperty(document, 'visibilityState');
        });
      }
      if (interruption !== 'missing-mouseup') {
        // フォーカス喪失は、ボタン解除を待たずにパンを終了させる。
        await page.mouse.move(start.x + 80, start.y + 70, { steps: 3 });
        expect(await transform(page)).toBe(panned);
      }
      await page.evaluate(() => document.documentElement.setAttribute('data-drop-mouseup', ''));
      await page.mouse.up();
      await page.evaluate(() => document.documentElement.removeAttribute('data-drop-mouseup'));
      await page.mouse.move(start.x + 120, start.y + 90, { steps: 5 });
      expect(await transform(page)).toBe(panned);

      // 中断で通常のパンや次の mouseup の処理を壊さない。
      await page.mouse.down();
      await page.mouse.move(start.x + 160, start.y + 120, { steps: 5 });
      await page.mouse.up();
      const resumed = await transform(page);
      expect(resumed).not.toBe(panned);
      await page.mouse.move(start.x + 190, start.y + 150, { steps: 3 });
      expect(await transform(page)).toBe(resumed);
    });
  }
}
