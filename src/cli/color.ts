export type Colorize = (text: string) => string;

export type Palette = {
  bold: Colorize;
  dim: Colorize;
  red: Colorize;
  green: Colorize;
  yellow: Colorize;
  blue: Colorize;
  magenta: Colorize;
  cyan: Colorize;
};

export type ColorOutput = { isTTY?: boolean };

export function createPalette(output: ColorOutput): Palette {
  const enabled = supportsColor(output);
  const wrap = (code: string): Colorize =>
    enabled ? (text: string) => `\x1b[${code}m${text}\x1b[0m` : (text: string) => text;

  return {
    bold: wrap("1"),
    dim: wrap("2"),
    red: wrap("31"),
    green: wrap("32"),
    yellow: wrap("33"),
    blue: wrap("34"),
    magenta: wrap("35"),
    cyan: wrap("36")
  };
}

function supportsColor(output: ColorOutput): boolean {
  if (typeof process.env.NO_COLOR === "string" && process.env.NO_COLOR.length > 0) {
    return false;
  }

  return output.isTTY === true;
}
