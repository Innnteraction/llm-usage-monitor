export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

const finite = (value: number): boolean => Number.isFinite(value);

const overlaps = (first: WindowRect, second: WindowRect): boolean =>
  first.x < second.x + second.width &&
  first.x + first.width > second.x &&
  first.y < second.y + second.height &&
  first.y + first.height > second.y;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export const clampPopoverHeight = (
  requestedHeight: number | undefined,
  minimumHeight: number,
  workAreaHeight: number,
): number => {
  const maximumHeight = finite(workAreaHeight) && workAreaHeight > 0
    ? Math.floor(workAreaHeight)
    : minimumHeight;
  const naturalHeight =
    requestedHeight !== undefined && finite(requestedHeight) && requestedHeight > 0
      ? Math.ceil(requestedHeight)
      : minimumHeight;
  return Math.min(Math.max(minimumHeight, naturalHeight), maximumHeight);
};

export const selectPopoverAnchor = (
  trayBounds: WindowRect | undefined,
  displays: readonly WindowRect[],
  cursor: { x: number; y: number },
): { x: number; y: number } => {
  const validTrayBounds =
    trayBounds &&
    [trayBounds.x, trayBounds.y, trayBounds.width, trayBounds.height].every(finite) &&
    trayBounds.width > 0 &&
    trayBounds.height > 0 &&
    displays.some((workArea) => overlaps(trayBounds, workArea));
  return validTrayBounds
    ? {
        x: trayBounds.x + Math.round(trayBounds.width / 2),
        y: trayBounds.y + Math.round(trayBounds.height / 2),
      }
    : cursor;
};

export const calculatePopoverPosition = (
  anchor: { x: number; y: number },
  workArea: WindowRect,
  windowSize: WindowSize,
): { x: number; y: number } => {
  const distances = {
    top: Math.abs(anchor.y - workArea.y),
    bottom: Math.abs(workArea.y + workArea.height - anchor.y),
    left: Math.abs(anchor.x - workArea.x),
    right: Math.abs(workArea.x + workArea.width - anchor.x),
  };
  const edge = (Object.entries(distances) as [keyof typeof distances, number][]).reduce(
    (nearest, candidate) => (candidate[1] < nearest[1] ? candidate : nearest),
  )[0];
  const centeredX = anchor.x - Math.round(windowSize.width / 2);
  const centeredY = anchor.y - Math.round(windowSize.height / 2);
  const raw =
    edge === "top"
      ? { x: centeredX, y: workArea.y }
      : edge === "left"
        ? { x: workArea.x, y: centeredY }
        : edge === "right"
          ? { x: workArea.x + workArea.width - windowSize.width, y: centeredY }
          : { x: centeredX, y: workArea.y + workArea.height - windowSize.height };
  return {
    x: clamp(raw.x, workArea.x, workArea.x + workArea.width - windowSize.width),
    y: clamp(raw.y, workArea.y, workArea.y + workArea.height - windowSize.height),
  };
};

export const clampWindowPosition = (
  position: { x: number; y: number },
  windowSize: WindowSize,
  workArea: WindowRect,
): { x: number; y: number } => {
  const validX = finite(position.x) ? position.x : workArea.x;
  const validY = finite(position.y) ? position.y : workArea.y;
  const maxX = workArea.x + workArea.width - windowSize.width;
  const maxY = workArea.y + workArea.height - windowSize.height;
  return {
    x: clamp(validX, workArea.x, Math.max(workArea.x, maxX)),
    y: clamp(validY, workArea.y, Math.max(workArea.y, maxY)),
  };
};
