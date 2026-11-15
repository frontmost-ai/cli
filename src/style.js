// Color and marks for a terminal. Everything is plain text in a pipe, with NO_COLOR, and with TERM=dumb.
// The brand (wordmouth DESIGN.md): ink, warm grays, and one highlighter yellow. Yellow means "named you" and nothing else.

const YELLOW = { hex: [229, 245, 75], c256: 191, basic: 93 };
const YELLOW_ON_LIGHT = { hex: [168, 184, 0], c256: 142, basic: 33 };
const RED = { hex: [180, 35, 24], c256: 124, basic: 31 };

/** @typedef {{ on: boolean, truecolor?: boolean, light?: boolean }} Look */

/** @param {Look} [look] */
export function makeStyle({ on, truecolor = false, light = false } = { on: false }) {
  /** @param {typeof YELLOW} c */
  const fg = (c) => (truecolor ? `38;2;${c.hex.join(";")}` : `38;5;${c.c256}`);
  /** @param {string} open @param {string} close @returns {(text: unknown) => string} */
  const sgr = (open, close) => (text) => (on ? `\x1b[${open}m${text}\x1b[${close}m` : String(text));
  const yellow = sgr(fg(light ? YELLOW_ON_LIGHT : YELLOW), "39");
  const gray = sgr("90", "39");
  return {
    on,
    bold: sgr("1", "22"),
    dim: sgr("2", "22"),
    gray,
    /** Only for "named you": your dots, your row, your name. */
    named: yellow,
    /** The logo: a yellow quote mark, then the name. */
    logo: () => `${yellow("”")} ${sgr("1", "22")("frontmost")}`,
    /** The dot before an error message. */
    errorDot: () => (on ? sgr(fg(RED), "39")("●") : "Error:"),
    /**
     * One dot for each answer: yellow when the answer named you, gray when it did not.
     * Above `max` answers, each dot stands for an equal share of them.
     * @param {number} named @param {number} total @param {number} [max]
     */
    tally(named, total, max = 40) {
      if (!(total > 0)) return "";
      const dots = Math.min(total, max);
      const lit = Math.max(0, Math.min(dots, Math.round((named / total) * dots)));
      const rest = dots - lit;
      return on ? yellow("●".repeat(lit)) + gray("●".repeat(rest)) : "●".repeat(lit) + "○".repeat(rest);
    },
  };
}

/** @typedef {ReturnType<typeof makeStyle>} Style */
export const PLAIN = makeStyle();

/**
 * The style for one output stream.
 * @param {{ isTTY?: boolean }} stream @param {Record<string, string | undefined>} env
 */
export function styleFor(stream, env) {
  const forced = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0";
  const on = env.NO_COLOR ? false : forced || (Boolean(stream.isTTY) && env.TERM !== "dumb");
  const truecolor = /^(truecolor|24bit)$/i.test(env.COLORTERM ?? "");
  // COLORFGBG is "foreground;background". A background of 7 or 15 is a light theme.
  const light = /;(7|15)$/.test(env.COLORFGBG ?? "");
  return makeStyle({ on, truecolor, light });
}

/** The width of text as the terminal shows it, without style codes. @param {string} text */
export const visible = (text) => text.replace(/\x1b\[[0-9;]*m/g, "").length;

/** @param {string} text @param {number} width */
export const padEnd = (text, width) => text + " ".repeat(Math.max(0, width - visible(text)));
/** @param {string} text @param {number} width */
export const padStart = (text, width) => " ".repeat(Math.max(0, width - visible(text))) + text;

const FRAMES = ["●○○", "○●○", "○○●", "○●○"];

/**
 * Three dots that move while a request runs. They show after a short wait, so a fast reply shows nothing.
 * @param {{ write: (text: string) => unknown }} stream @param {Style} style
 */
export function spinner(stream, style) {
  let active = 0;
  /** @type {NodeJS.Timeout | undefined} */ let timer;
  let shown = false;
  let frame = 0;
  const draw = () => {
    shown = true;
    stream.write(`\r${style.gray(FRAMES[frame++ % FRAMES.length])}`);
  };
  const clear = () => {
    clearTimeout(timer);
    clearInterval(timer);
    timer = undefined;
    if (shown) stream.write("\r\x1b[2K");
    shown = false;
  };
  return {
    clear,
    /** @template T @param {Promise<T>} work @returns {Promise<T>} */
    async around(work) {
      if (active++ === 0) timer = setTimeout(() => ((timer = setInterval(draw, 120)), draw()), 300);
      try {
        return await work;
      } finally {
        if (--active === 0) clear();
      }
    },
  };
}
