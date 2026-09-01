import { app, nativeImage, type NativeImage } from "electron";
import path from "node:path";

export const createTrayIcon = (): NativeImage =>
  nativeImage.createFromPath(
    path.join(app.getAppPath(), "assets", "icons", "tray-icon.png"),
  );
