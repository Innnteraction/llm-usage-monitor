import { nativeImage, type NativeImage } from "electron";

export const createTrayIcon = (): NativeImage =>
  nativeImage.createFromPath(process.execPath).resize({
    width: 16,
    height: 16,
  });
