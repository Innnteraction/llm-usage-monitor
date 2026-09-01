import squirrelStartup from "electron-squirrel-startup";
import { startApplication } from "./application";

if (!squirrelStartup) {
  startApplication();
}
