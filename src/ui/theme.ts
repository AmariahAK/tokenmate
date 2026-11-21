import { atLum, lum, mix } from "./palette";

export type State = "none" | "last" | "selected" | "check";

export type Theme = {
  key: string;
  name: string;
  note: string;
  light: string;
  dark: string;
  whitePiece: string;
  blackPiece: string;
  accents: Record<Exclude<State, "none">, string>;
  blend: number;
  hint: string;
  coord: string;
};

// A highlight is a hue shift at CONSTANT luminance. Brightening the square would
// spend the piece's contrast budget, so the tint is re-normalised to the square's
// original luminance — the board changes colour without changing legibility.
export const square = (t: Theme, isLight: boolean, state: State = "none") => {
  const base = isLight ? t.light : t.dark;
  return state === "none" ? base : atLum(mix(base, t.accents[state], t.blend), lum(base));
};

export const STATES: State[] = ["none", "last", "selected", "check"];

const AMBER = "#E0A93B";
const BLUE = "#4A9EFF";
const RED = "#E05252";

const mk = (
  o: { light: string; dark: string; whiteBody: string; blackBody: string; accents: Theme["accents"]; blend: number },
  key: string,
  name: string,
  note: string,
): Theme => ({
  key,
  name,
  note,
  light: o.light,
  dark: o.dark,
  whitePiece: o.whiteBody,
  blackPiece: o.blackBody,
  accents: o.accents,
  blend: o.blend,
  hint: mix(o.dark, "#000000", 0.3),
  coord: "#8b949e",
});

export const themes: Theme[] = [
  mk(
    {
      light: atLum("#C0AE97", 0.190),
      dark: atLum("#5A6E85", 0.170),
      // Pieces must pop against BOTH square colours. Pure white/black vanish
      // against the square they match. Cream and near-black with enough
      // distance from both squares keeps them legible everywhere.
      whiteBody: "#F0E6D0",
      blackBody: "#1A1A2E",
      accents: { last: AMBER, selected: BLUE, check: RED },
      blend: 0.7,
    },
    "slate",
    "Slate",
    "default — warm/cool squares, neutral under long play",
  ),
  mk(
    {
      light: atLum("#CBA97B", 0.190),
      dark: atLum("#6B4F32", 0.170),
      whiteBody: "#F5ECD7",
      blackBody: "#1A1A2E",
      accents: { last: AMBER, selected: BLUE, check: RED },
      blend: 0.7,
    },
    "wood",
    "Wood",
    "walnut and maple, the classic club feel",
  ),
  mk(
    {
      light: atLum("#AAB28F", 0.190),
      dark: atLum("#4E6155", 0.170),
      whiteBody: "#F0E6D0",
      blackBody: "#1A1A2E",
      accents: { last: AMBER, selected: BLUE, check: RED },
      blend: 0.7,
    },
    "moss",
    "Moss",
    "cool green, low glare for long sessions",
  ),
  // Mono trades dual-side contrast for checkerboard legibility: on a 16-colour
  // terminal the pieces still separate by brightness, and glyph fill in compact mode.
  mk(
    {
      light: atLum("#9E9E9E", 0.280),
      dark: atLum("#6E6E6E", 0.110),
      whiteBody: "#FFFFFF",
      blackBody: "#1A1A2E",
      accents: { last: "#9A7A28", selected: "#3C70A8", check: "#C04040" },
      blend: 0.65,
    },
    "mono",
    "Mono",
    "16-colour safe — luminance split, no RGB assumed",
  ),
  // Neon is the inverse board: near-black squares, so BOTH sides must be bright
  // and are separated by hue *and* brightness.
  mk(
    {
      light: atLum("#2A3A4A", 0.030),
      dark: atLum("#18222E", 0.018),
      whiteBody: "#9BEBFF",
      blackBody: "#C24FA0",
      accents: { last: "#FFD447", selected: "#3ED1A0", check: "#FF5555" },
      blend: 0.6,
    },
    "neon",
    "Neon",
    "streaming — dark board, bright pieces",
  ),
];

export const themeByKey = (key: string) => themes.find((t) => t.key === key);
