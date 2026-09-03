import { describe, expect, it } from "vitest";
import {
  calculatePopoverPosition,
  clampPopoverHeight,
  selectPopoverAnchor,
} from "../../src/main";

const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
const size = { width: 420, height: 320 };

describe("popover positioning", () => {
  it("places the popover against the nearest tray edge", () => {
    expect(calculatePopoverPosition({ x: 960, y: 0 }, workArea, size)).toEqual({ x: 750, y: 0 });
    expect(calculatePopoverPosition({ x: 960, y: 1080 }, workArea, size)).toEqual({ x: 750, y: 760 });
    expect(calculatePopoverPosition({ x: 0, y: 500 }, workArea, size)).toEqual({ x: 0, y: 340 });
    expect(calculatePopoverPosition({ x: 1920, y: 500 }, workArea, size)).toEqual({ x: 1500, y: 340 });
  });

  it("uses cursor fallback for invalid or removed tray bounds", () => {
    const cursor = { x: -500, y: 300 };
    expect(
      selectPopoverAnchor({ x: 0, y: 0, width: 0, height: 20 }, [workArea], cursor),
    ).toEqual(cursor);
    expect(
      selectPopoverAnchor({ x: Number.NaN, y: 0, width: 20, height: 20 }, [workArea], cursor),
    ).toEqual(cursor);
    expect(
      selectPopoverAnchor({ x: 5000, y: 5000, width: 20, height: 20 }, [workArea], cursor),
    ).toEqual(cursor);
    expect(
      selectPopoverAnchor({ x: 10, y: 10, width: 20, height: 20 }, [workArea], cursor),
    ).toEqual({ x: 20, y: 20 });
  });

  it("keeps tray anchors in display bounds even when taskbars exclude their edge", () => {
    const displayBounds = { x: 0, y: 0, width: 1920, height: 1100 };
    const cursor = { x: -500, y: 300 };
    for (const trayBounds of [
      { x: 100, y: 0, width: 20, height: 20 },
      { x: 100, y: 1080, width: 20, height: 20 },
      { x: 0, y: 500, width: 20, height: 20 },
      { x: 1900, y: 500, width: 20, height: 20 },
    ]) {
      expect(selectPopoverAnchor(trayBounds, [displayBounds], cursor)).not.toEqual(cursor);
    }
  });

  it("clamps negative displays and work areas smaller than the popover", () => {
    const negative = { x: -1600, y: -100, width: 1200, height: 900 };
    expect(calculatePopoverPosition({ x: -1600, y: 350 }, negative, size)).toEqual({ x: -1600, y: 190 });
    expect(calculatePopoverPosition({ x: 20, y: 20 }, { x: 10, y: 20, width: 200, height: 100 }, size)).toEqual({ x: 10, y: 20 });
  });

  it("clamps natural content height to the active work area", () => {
    expect(clampPopoverHeight(640, 304, 1080)).toBe(640);
    expect(clampPopoverHeight(undefined, 360, 1080)).toBe(360);
    expect(clampPopoverHeight(Number.NaN, 304, 200)).toBe(200);
    expect(clampPopoverHeight(640, 304, 200)).toBe(200);
  });
});
