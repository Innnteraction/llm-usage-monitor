import { describe, expect, it, vi } from "vitest";

interface MockImage {
  isEmpty: () => boolean;
  getSize: () => { width: number; height: number };
  isTemplateImage: () => boolean;
  setTemplateImage: (val: boolean) => void;
  resize: (options: { width: number; height: number }) => MockImage;
}

const createMockImage = (initialSize = { width: 32, height: 32 }): MockImage => {
  let size = initialSize;
  let isTemplate = false;
  return {
    isEmpty: (): boolean => false,
    getSize: () => size,
    isTemplateImage: (): boolean => isTemplate,
    setTemplateImage: (val: boolean): void => {
      isTemplate = val;
    },
    resize: ({ width, height }: { width: number; height: number }): MockImage => {
      size = { width, height };
      const resized = createMockImage(size);
      resized.setTemplateImage(isTemplate);
      return resized;
    },
  };
};

vi.mock("electron", () => ({
  app: {
    getAppPath: (): string => "/mock/app",
  },
  nativeImage: {
    createFromPath: vi.fn((targetPath: string) => {
      if (targetPath.includes("tray-iconTemplate.png")) {
        return createMockImage({ width: 22, height: 22 });
      }
      if (targetPath.includes("tray-icon.png")) {
        return createMockImage({ width: 32, height: 32 });
      }
      return { isEmpty: (): boolean => true };
    }),
    createFromDataURL: vi.fn(() => createMockImage({ width: 32, height: 32 })),
  },
}));

import {
  createTrayIcon,
  EMBEDDED_TRAY_ICON_DATA_URL,
  EMBEDDED_TRAY_TEMPLATE_ICON_DATA_URL,
} from "../../src/main/index";

describe("tray icon generator", () => {
  it("exports valid embedded data URLs", () => {
    expect(EMBEDDED_TRAY_ICON_DATA_URL).toMatch(/^data:image\/png;base64,/);
    expect(EMBEDDED_TRAY_TEMPLATE_ICON_DATA_URL).toMatch(/^data:image\/png;base64,/);
  });

  it("configures template mode and maximum 22px bounds for macOS", () => {
    const icon = createTrayIcon("darwin");
    expect(icon.isEmpty()).toBe(false);
    expect(icon.isTemplateImage()).toBe(true);
    const size = icon.getSize();
    expect(size.width).toBeLessThanOrEqual(22);
    expect(size.height).toBeLessThanOrEqual(22);
  });

  it("returns a valid native image on Windows", () => {
    const icon = createTrayIcon("win32");
    expect(icon.isEmpty()).toBe(false);
    expect(icon.getSize().width).toBe(32);
  });
});
