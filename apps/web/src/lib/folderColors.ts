import type { FolderColor } from "@superdrive/shared";

/** The colours a folder can have: the label for pickers and the three shades its picture is drawn with. Blue is the default. */
export const FOLDER_TONES: Record<FolderColor, { label: string; back: string; top: string; bottom: string }> = {
  blue: { label: "Biru", back: "#3b78d8", top: "#72a8f6", bottom: "#2f6cd0" },
  red: { label: "Merah", back: "#d6483f", top: "#f58a80", bottom: "#c93a31" },
  orange: { label: "Oranye", back: "#ec7a38", top: "#ffa86e", bottom: "#ee7b3a" },
  yellow: { label: "Kuning", back: "#d9a514", top: "#f7d462", bottom: "#cf9a0b" },
  green: { label: "Hijau", back: "#2b9d77", top: "#58cba3", bottom: "#23916c" },
  teal: { label: "Toska", back: "#1f93a8", top: "#55c8da", bottom: "#19808f" },
  purple: { label: "Ungu", back: "#7a59d4", top: "#a690f1", bottom: "#6a49c8" },
  pink: { label: "Merah muda", back: "#d4559a", top: "#f68fc5", bottom: "#c44690" },
  gray: { label: "Abu-abu", back: "#6b7686", top: "#9eaabb", bottom: "#5d6878" },
};
export const toneOf = (color?: string | null) => FOLDER_TONES[(color as FolderColor) in FOLDER_TONES ? (color as FolderColor) : "blue"];
