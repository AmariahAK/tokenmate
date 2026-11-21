export type RGB = [number, number, number];

const rgb = (h: string): RGB => {
  const m = h.replace("#", "").match(/../g);
  if (!m || m.length !== 3) throw new Error(`not a 6-digit hex colour: ${h}`);
  return [parseInt(m[0]!, 16), parseInt(m[1]!, 16), parseInt(m[2]!, 16)];
};

const hex = (c: number[]) =>
  "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

export const mix = (a: string, b: string, t: number) => {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x.map((v, i) => v + ((y[i] ?? 0) - v) * t));
};

export const lum = (h: string) => {
  const c = rgb(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};

// Scale a colour's channels until it hits a target luminance, preserving its hue.
export const atLum = (h: string, target: number) => {
  let lo = 0;
  let hi = 4;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (lum(hex(rgb(h).map((v) => v * m))) < target) lo = m;
    else hi = m;
  }
  return hex(rgb(h).map((v) => v * ((lo + hi) / 2)));
};
