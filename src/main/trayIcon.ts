import { app, nativeImage, type NativeImage } from "electron";
import path from "node:path";

export const EMBEDDED_TRAY_ICON_DATA_URL =
  "data:image/png;base64,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";

export const createTrayIcon = (): NativeImage => {
  const candidatePaths = [
    path.join(app.getAppPath(), "assets", "icons", "tray-icon.png"),
    path.join(process.resourcesPath, "assets", "icons", "tray-icon.png"),
    path.join(app.getAppPath(), "..", "assets", "icons", "tray-icon.png"),
    path.resolve("assets", "icons", "tray-icon.png"),
  ];

  for (const candidate of candidatePaths) {
    try {
      const img = nativeImage.createFromPath(candidate);
      if (!img.isEmpty()) {
        return img;
      }
    } catch {
      // try next candidate
    }
  }

  return nativeImage.createFromDataURL(EMBEDDED_TRAY_ICON_DATA_URL);
};
