/**
 * Subtle ambient rendering pass — applied after the main scene so sprites are
 * never obscured.
 *
 * Effect: a gentle breathing vignette (radial gradient, dark perimeter) that
 * oscillates at ~0.08 Hz (12-second cycle). Alpha is capped at 0.10 so the
 * dark edge reads as atmosphere rather than obstruction.
 */

import { AMBIENT_OVERLAY_CLEAR, ambientOverlayEdge } from '../../constants.js';

const BREATHE_HZ = 0.08; // one full inhale/exhale every 12.5 seconds
const ALPHA_MIN = 0.03;
const ALPHA_MAX = 0.10;

/**
 * Draw a breathing vignette over the canvas.
 * Call this once per frame, after renderFrame(), before any HUD chrome.
 */
export function renderAmbientOverlay(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const t = performance.now() / 1000;
  const breathe = 0.5 + 0.5 * Math.sin(t * BREATHE_HZ * Math.PI * 2);
  const alpha = ALPHA_MIN + breathe * (ALPHA_MAX - ALPHA_MIN);

  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  // Radius extends to the farthest corner so all edges are tinted
  const r = Math.hypot(cx, cy);

  const gradient = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
  gradient.addColorStop(0, AMBIENT_OVERLAY_CLEAR);
  gradient.addColorStop(1, ambientOverlayEdge(alpha.toFixed(3)));

  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.restore();
}
