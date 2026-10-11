import type { Locator } from '@playwright/test';

/**
 * sRGB [r, g, b] (0-255) of an element's computed text colour.
 *
 * Tailwind 4's palette is written in oklch() and its opacity utilities in
 * color-mix(), and getComputedStyle() hands those back verbatim — not as
 * "rgb(r, g, b)". Parsing that string with an rgb() regex silently reads it
 * as black. This asks the browser itself to convert any CSS colour to sRGB
 * (via a 1x1 canvas), so the tests stay correct whatever notation the CSS uses.
 */
export async function computedTextRgb(locator: Locator): Promise<[number, number, number]> {
  return locator.evaluate((el) => {
    const css = getComputedStyle(el).color;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b] as [number, number, number];
  });
}
