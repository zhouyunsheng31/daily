/**
 * Canvas coordinate utilities.
 *
 * Background: CSS zoom on `canvas-container` in React mount + inline style has a
 * Chrome rendering quirk where `getBoundingClientRect().left !== style.left * style.zoom`.
 * We use `getBoundingClientRect()` directly to avoid relying on the model.
 */

/**
 * Get the active panel's canvas-container DOM element.
 * Callers should cache the result in a ref via useLayoutEffect to avoid per-frame querySelector.
 */
export function getActiveCanvasContainer(area: HTMLDivElement | null): HTMLElement | null {
  if (!area) return null
  return area.querySelector('.panel-layer--active .canvas-container') as HTMLElement | null
}

/**
 * Convert a viewport (screen) coordinate to a canvas coordinate.
 * Uses measured ccRect to avoid the React mount + inline style zoom quirk.
 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  ccRect: { left: number; top: number },
  zoom: number,
): { x: number; y: number } {
  return {
    x: (screenX - ccRect.left) / zoom,
    y: (screenY - ccRect.top) / zoom,
  }
}

/**
 * Get the canvas coordinate at the viewport center.
 * Uses measured ccRect to avoid the React mount + inline style zoom quirk.
 */
export function getViewportCenterCanvas(
  ccRect: { left: number; top: number },
  zoom: number,
  vw: number,
  vh: number,
): { x: number; y: number } {
  // Viewport center in viewport coords = (vw/2, vh/2)
  // ccRect.left + canvasX * zoom = vw/2
  // => canvasX = (vw/2 - ccRect.left) / zoom
  return {
    x: (vw / 2 - ccRect.left) / zoom,
    y: (vh / 2 - ccRect.top) / zoom,
  }
}
