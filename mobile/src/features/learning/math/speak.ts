// Голосовая метка формулы для VoiceOver / TalkBack: порт CSCATeX.spoken (iPhone 1.1,
// ios/EVOAdmissions/Services/CSCA/CSCATeX.swift). Простые правила над подмножеством TeX
// контракта §14; результат без обратных слэшей. Английские слова: формулы экзамена
// на английском (метку помечает языком вызывающий экран).
import { splitMathText } from "@web/lib/portal/csca";

type Token = { t: "cmd"; v: string } | { t: "ch"; v: string } | { t: "open" } | { t: "close" } | { t: "sup" } | { t: "sub" };

const WORDS: Readonly<Record<string, string>> = {
  infty: "infinity", in: "in", notin: "not in", cdot: "times", times: "times",
  leq: "less than or equal to", geq: "greater than or equal to", ne: "not equal to",
  pm: "plus or minus", Rightarrow: "implies", Leftrightarrow: "if and only if",
  to: "approaches", approx: "approximately equals", ldots: "and so on",
  cap: "intersect", cup: "union", subseteq: "is a subset of", emptyset: "empty set",
  parallel: "parallel", perp: "perpendicular", Delta: "delta", pi: "pi",
  alpha: "alpha", beta: "beta", theta: "theta", mu: "mu", sigma: "sigma",
  omega: "omega", varphi: "phi", circ: "degrees", quad: ",",
  sin: "sine", cos: "cosine", tan: "tangent", ln: "natural log of", lim: "limit",
};
const BLACKBOARD: Readonly<Record<string, string>> = { R: "the real numbers", N: "the natural numbers", Z: "the integers", Q: "the rational numbers" };
const SYMBOLS: Readonly<Record<string, string>> = {
  "+": "plus", "-": "minus", "=": "equals", "<": "less than", ">": "greater than",
  "/": "divided by", "!": "factorial", "'": "prime", ",": ",", ".": ".",
  "(": "(", ")": ")", "[": "[", "]": "]", "{": "{", "}": "}",
};
const isLetter = (ch: string) => /\p{L}/u.test(ch);
const isDigit = (ch: string) => /\p{N}/u.test(ch);

function tokenize(tex: string): Token[] {
  const chars = Array.from(tex);
  const out: Token[] = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === "\\") {
      const next = chars[i + 1];
      if (next === undefined) { i += 1; continue; }
      if (isLetter(next)) {
        let end = i + 1;
        while (end < chars.length && isLetter(chars[end])) end += 1;
        out.push({ t: "cmd", v: chars.slice(i + 1, end).join("") });
        i = end;
      } else {
        out.push({ t: "ch", v: next }); // \{ \} \, и подобные: сам символ
        i += 2;
      }
      continue;
    }
    if (ch === "{") out.push({ t: "open" });
    else if (ch === "}") out.push({ t: "close" });
    else if (ch === "^") out.push({ t: "sup" });
    else if (ch === "_") out.push({ t: "sub" });
    else if (ch !== " " && ch !== "\t" && ch !== "\n") out.push({ t: "ch", v: ch });
    i += 1;
  }
  return out;
}

class Speech {
  private pos = 0;
  private absoluteOpen = false;
  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token | undefined { return this.tokens[this.pos]; }

  private argument(): string[] {
    const token = this.peek();
    if (!token) return [];
    if (token.t === "open") { this.pos += 1; return this.sequence("close"); }
    // Без скобок аргумент ровно один символ, как в TeX: `\log_2 8` это log по основанию 2 от 8.
    if (token.t === "ch") { this.pos += 1; return [SYMBOLS[token.v] ?? token.v]; }
    return this.atom();
  }

  sequence(until: "close" | null): string[] {
    const out: string[] = [];
    for (let token = this.peek(); token; token = this.peek()) {
      if (until && token.t === until) { this.pos += 1; break; }
      out.push(...this.atom());
    }
    return out;
  }

  private isDigitAt(offset: number): boolean {
    const token = this.tokens[this.pos + offset];
    return token?.t === "ch" && isDigit(token.v);
  }

  private power(): string[] {
    const next = this.peek();
    if (next?.t === "cmd" && next.v === "circ") { this.pos += 1; return ["degrees"]; }
    const exponent = this.argument();
    const joined = exponent.join("\u0000");
    if (joined === "2") return ["squared"];
    if (joined === "3") return ["cubed"];
    return ["to the power", ...exponent, ","];
  }

  private atom(): string[] {
    const token = this.tokens[this.pos];
    if (!token) return [];
    this.pos += 1;
    switch (token.t) {
      case "open": return this.sequence("close");
      case "close": return [];
      case "sup": return this.power();
      case "sub": return ["sub", ...this.argument()];
      case "ch": {
        const ch = token.v;
        if (ch === "|") { this.absoluteOpen = !this.absoluteOpen; return this.absoluteOpen ? ["absolute value of"] : [","]; }
        if (isDigit(ch)) {
          let number = ch;
          for (let next = this.peek(); next?.t === "ch" && (isDigit(next.v) || (next.v === "." && this.isDigitAt(1))); next = this.peek()) {
            number += next.v;
            this.pos += 1;
          }
          return [number];
        }
        return [SYMBOLS[ch] ?? ch];
      }
      case "cmd": {
        switch (token.v) {
          case "frac": {
            const numerator = this.argument();
            const denominator = this.argument();
            if (numerator.length > 1 || denominator.length > 1) return ["the fraction", ...numerator, "over", ...denominator, "end fraction", ","];
            return [...numerator, "over", ...denominator, ","];
          }
          case "sqrt": return ["square root of", ...this.argument(), ","];
          case "log": {
            if (this.peek()?.t === "sub") { this.pos += 1; return ["log base", ...this.argument(), "of"]; }
            return ["log of"];
          }
          case "mathbb": { const inner = this.argument().join(""); return [BLACKBOARD[inner] ?? inner]; }
          case "left":
          case "right": return [];
          default: return [WORDS[token.v] ?? token.v];
        }
      }
    }
  }
}

/** Формула простыми английскими словами для экранного диктора. */
export function speakTex(tex: string): string {
  return new Speech(tokenize(tex))
    .sequence(null)
    .join(" ")
    .replaceAll(" ,", ",")
    .replaceAll("( ", "(")
    .replaceAll(" )", ")")
    .split(" ")
    .filter((word) => word.length > 0)
    .join(" ");
}

/** Текст с формулами `$…$` одной строкой для диктора. */
export function speakMathText(source: string): string {
  return splitMathText(source).map((s) => (s.math ? speakTex(s.value) : s.value)).join("").replaceAll("  ", " ");
}

/** Формулы строки: нечётные куски между `$`. */
export function formulasIn(source: string): string[] {
  return splitMathText(source).filter((s) => s.math).map((s) => s.value);
}
