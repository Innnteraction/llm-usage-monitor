import { app, nativeImage, type NativeImage } from "electron";
import path from "node:path";

export const EMBEDDED_TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAAAAAAAAPlDu38AAAAHdElNRQfqCQEKAzW+roVmAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTA5LTAxVDEwOjAzOjUyKzAwOjAwpwF1BgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0wOS0wMVQxMDowMzozMyswMDowMLZEz4kAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMDktMDFUMTA6MDM6NTMrMDA6MDAnPufRAAAGkUlEQVRYw+1XW2wcZxX+zsw/u2PP3uz1ZXd2cdQ2IYQ4gSi4cpo4btYhSpSqRSD1gYc8kNBAW8ETCNSq4vqEKpWqrUBVQTwhhICotCZx48S0duI0jhsnxbbUVMSO7bXj21683tnbHB52d/bqokrwBL+00px//nPO95/Ld2aB//VFxQef7s8LBIALD1RfgWt2GRWHmbfWIgAmIxxeLL3WAzr0gI5AMICvPflk8dh//Hf26WegB3T4C/4AgPSgjkw6g1g0KmtOR6ipqfmkw+FoIZKsS9UJRNkul8mVN2eAiyaYGRsbG+vra6tvG0bqoqZpWaEoEACwfH9Z6tjW8d0jfUdf6O0LuYkAM2eCqMwFoyBT3qzJ+MRVhUeWJDARLl4cODV0afDHc7P3XgoEA6YAA26Pu+vg4d4fnjp9xv3WH67xzD9cgGm3jJTuSEhnl7C49y6y+3aWgeAqjwSiEnAQICdT6NpM4/Q3z7oMw/j+QLT/MgMfCKEo0DTtwKHDvS3Xr0zw7cE98DYcAWBW1ykIEtKpW1jqGEL6ieNA1qy8cXn4qwJEEmHu/CA+PzXJjxzqaX9v6HKXRPSBVDxvhZ1FWeiqrBZFql8Vtc4ZAOfVGIBpgohA+R0TAEQ2m0UikbhydXh4+dTM61L98Z4bvouwAK1zUSghiX4ZmeQPXcexFzdgGVlyaVKBCAMA90pRufBL9Jrr7w8l9zcHBUuV74Io5HojXf/PvQzoSgvHOzp8XY+nEMulyoVXcXyANwEmGYhEuVdUAnDqgEwZKcT5Jbwxuu/XhodGf5RLBb/0Ol2gfRgAJl0Csv3V6Tm5qYDTV5vSNM0D0BcyUVVaMjyQRUgyPJegYjZRGJjY2VtbfWd9bXIjda2VrbZbBAAI5fLIdjxGTM8PzeVyWYlIWRHhekiiVWRXUkuRoLAVdVntTID2WwmlkgkPvL5ffzwgR6MXRvJE5FNsSGZTPZ17v3Cz/d3de2xq4pgk60LlfL8icxUUStgAnGZJhHiiUTm2tUr16enJr8nhBiTZBmkB3TEYrHtj4b63jz7zLO7piZm8dHtTWZTqjG7VVNU75qcRLxlEbkHfaACHYpsDl3uZtrmbcXLL7343vujV7/qbWldEYqiwOVy9R07cWLXnelZHvhdC9zKkRqirXG8ZRQIqdQ93Pryn7H5+NESnZiMKxcG+acpJw719Hbdnpj4EsDnhaIoAOBxulyYngjDhm4owgmw+SluXYSanzum0CDbVciaVgIgy0gF/FhdjsLpcimyLDkIBGEYBpLJ5PitmzcTob5j2szkAG8szoJIVBmvB6FeCxIy0jJs9++Bh0et0S4ZBvb8cw6dj/TSb994fTGVSk2pagMEMyMaibx7of/tVzVN+85jp3apayuzyOXMyjFfj3G2SEF+cu0EFuPWriLL8Dy0E2+e+0tsdGT4FxvxxKTb7QEFggEYhoFYNKK2tbef9OuBUGNjowN1PivKzFsiVQ5LLu2UGodAYDBikej6wsJ8/8rK8iWv15u12ez5LohEIvB4PFiYX3DaVdvnZFnWCs1kDUNrrhfmRj04zHUKtGiAGTkzl0gZ6Wm/7t8IL4ShB3VQm68dqt0Ow0j27Nrd+ZN9+/fvU1W7YOb84KhX8lT5aFUCS6DiiK7+PiEgsZnM3LhxfXx6cvI5IcSoxQPxeGx775HQuTPfenr3x9Nh3PkwyWxSJQf927SbSKhzSH+2GZBFCWdBW86ZvNfhpu1tPrz2yi/Hro6MfMXT5JkXdrsdJLmPHT/52O67d8L8t9944RaHQaBibrnaVyVFF17nMpgK/grL3z4AaM5akMy4PDTMz62vIXT02L5bN28eJpJ+L+yqCgaa3R4Pbo/Nws7dsAl3yXUZlxPVBsT6FqI0ZJsK2aEBmqPqBABJRrojiMXJu2h3e2QhhEcigtiIx2EYxvjE+HiyJ9TXMDN5gRP3ZwAIFIJQmYh6NAAAUhbCmEPjtXFAbbB0LMypNHbcmUF3dw+d+9Mf15PJ5ISmaRAmM2LR6KX+t/76qqo2PHvi6zvUtdWPkcuZn3oAMe0AVg0ARs17IUlwb3sIA+f745cHL74YWY+8r2laOQ9E1da2tuNtPt+jDaraWLo31cNQlQuqx9rVVUrxeDy6GA6/s7q6cqmpqTljt9sBn9+HQDAAf8CPBx58AD94/nkw83/l942nnkLHtg7rT5AkSSXQekBHsfdr8rxV3ut1KVUKJSYvU2TGwnwY/18A8C/vdguHamvrCQAAAABJRU5ErkJggg==";

export const EMBEDDED_TRAY_TEMPLATE_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAABl0lEQVR4nLyVzy4EQRDGv9mdEbE4OIlIXAhP4OhBOLuLN3AXL+CIxEs4uXFwE1xEJDiQkPV3MeOr7epsbZsZs8JW8svudHXVVFVX19TwTxIHzzUS/WyGNGctsw9VnPxKwogXySz5DF7so6mTC7IPl53Xyf97cmMdy2KqTndQTdbJHhk2QYiPA3INdNd0Tn8/Shz62o6TZ/KutEhCRlQf1Y3RJZknDdIkL2rseSKv5JRsqx4m4lvVtQMLD29Q08uQL7L/UV+QaMaZyTS1G3uVyDhMizbZrpBI1+DK0VIHeS/2DiXiY7IFV44Hcqa6rq5YJqvoTRbgWnCXTJE3cg50evHPRSL2ddokk8gvhT3MTAlLcQV3edpS9fDsgWVmLS0zsJLXbrbFBgJdYbvFaijKabi0ZnSTN5JfuTwbcLMg0XUbseyRrjiCXpy6IhtXyJJGNQp3AxuaxQTc7TvUjCJj68fCmGZ1J8+xSeXEZIEgXWi0Q+jcuPBgZWY0/VpY43Bs+qzCUYnA6bex2bdBX/ZpKmwtlf58mr4AAAD//xCIf0MAAAAGSURBVAMA/bpuBPa0XOIAAAAASUVORK5CYII=";

export const createTrayIcon = (platform: NodeJS.Platform = process.platform): NativeImage => {
  const isMac = platform === "darwin";
  const iconFileNames = isMac
    ? ["tray-iconTemplate.png", "tray-icon.png"]
    : ["tray-icon.png"];

  const candidateDirs: string[] = [];
  try {
    if (typeof app?.getAppPath === "function") {
      candidateDirs.push(path.join(app.getAppPath(), "assets", "icons"));
      candidateDirs.push(path.join(app.getAppPath(), "..", "..", "assets", "icons"));
      candidateDirs.push(path.join(app.getAppPath(), "..", "assets", "icons"));
    }
  } catch {
    // ignore
  }
  if (typeof process?.resourcesPath === "string") {
    candidateDirs.push(path.join(process.resourcesPath, "assets", "icons"));
  }
  candidateDirs.push(path.resolve("assets", "icons"));

  for (const fileName of iconFileNames) {
    for (const dir of candidateDirs) {
      try {
        const candidate = path.join(dir, fileName);
        const img = nativeImage.createFromPath(candidate);
        if (!img.isEmpty()) {
          if (isMac) {
            img.setTemplateImage(true);
            const size = img.getSize();
            if (size.width > 22 || size.height > 22) {
              return img.resize({ width: 22, height: 22 });
            }
          }
          return img;
        }
      } catch {
        // try next candidate
      }
    }
  }

  const fallback = nativeImage.createFromDataURL(
    isMac ? EMBEDDED_TRAY_TEMPLATE_ICON_DATA_URL : EMBEDDED_TRAY_ICON_DATA_URL,
  );
  if (isMac) {
    fallback.setTemplateImage(true);
    const size = fallback.getSize();
    if (size.width > 22 || size.height > 22) {
      return fallback.resize({ width: 22, height: 22 });
    }
  }
  return fallback;
};

