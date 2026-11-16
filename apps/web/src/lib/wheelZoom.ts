/** Zoom factor for a Ctrl+scroll / trackpad-pinch wheel event: a mouse notch (about 100 units) is a gentle step, a pinch sends many tiny deltas. */
export const wheelZoomFactor = (e: WheelEvent) => Math.exp(-e.deltaY * (Math.abs(e.deltaY) >= 50 ? 0.0025 : 0.01));
