import path from "path";
import { carouselDir } from "../store";

/** Рабочая папка карусели формата раздела: исследование, скриншоты, обложка, кадры и ролик. */
export const sidDir = (id: string) => path.join(carouselDir(id), "sid");
