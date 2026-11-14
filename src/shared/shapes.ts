/**
 * Heading shapes, as Excel's Insert → Shapes gallery offers them.
 *
 * Excel groups its shapes as Lines, Rectangles, Basic Shapes, Block Arrows,
 * Equation Shapes, Flowchart, Stars and Banners and Callouts. A heading is a
 * box that words sit in, so the groups that make one are here: every
 * rectangle, the basic shapes that frame text, the block arrows a title can
 * point with, the banners and the callouts - and a group of our own, the
 * decorated frames the school's samples show (gold plaque, badge, flowers).
 * Lines, equation shapes and flowchart symbols hold no heading and are left out.
 *
 * Each shape is drawn for the heading's real size - never stretched - so a
 * rounded corner stays round and an outline keeps its weight however wide the
 * heading. `shapePieces` gives the outline as SVG paths, each with a role that
 * says how it is painted (see `shapeSvg`). It is pure: the print pages, the
 * gallery's thumbnails and the tests all call it.
 *
 * Like Excel's yellow handles, most shapes take one adjustment (0..100): how
 * round the corners, how deep the snip, how long the point, where the tail.
 */

export const SHAPE_GROUPS = ["rectangles", "basic", "arrows", "banners", "callouts", "decorative"] as const;
export type ShapeGroup = (typeof SHAPE_GROUPS)[number];

interface ShapeInfo {
  id: string;
  group: ShapeGroup;
  labelGu: string;
  labelEn: string;
  /** The adjustment's default, 0..100; absent when the shape has none. */
  adjust?: number;
  /** Room the words need inside the shape, mm: left and right, top and bottom. */
  padXMm: number;
  padYMm: number;
  /** Extra room at the bottom (a callout's tail, a ribbon's tails). */
  padBottomMm?: number;
}

export const SHAPES = [
  // Rectangles - Excel's nine.
  { id: "rect", group: "rectangles", labelGu: "લંબચોરસ", labelEn: "Rectangle", padXMm: 1.5, padYMm: 0.6 },
  { id: "rounded", group: "rectangles", labelGu: "ગોળ ખૂણાવાળો", labelEn: "Rounded rectangle", adjust: 30, padXMm: 2.5, padYMm: 0.8 },
  { id: "snip1", group: "rectangles", labelGu: "એક ખૂણો કાપેલો", labelEn: "Snip single corner", adjust: 35, padXMm: 3, padYMm: 0.8 },
  { id: "snip2same", group: "rectangles", labelGu: "ઉપરના બે ખૂણા કાપેલા", labelEn: "Snip same-side corners", adjust: 35, padXMm: 3, padYMm: 0.8 },
  { id: "snip2diag", group: "rectangles", labelGu: "સામસામા ખૂણા કાપેલા", labelEn: "Snip diagonal corners", adjust: 35, padXMm: 3, padYMm: 0.8 },
  { id: "snipRound", group: "rectangles", labelGu: "એક કાપેલો, એક ગોળ", labelEn: "Snip and round corner", adjust: 35, padXMm: 3, padYMm: 0.8 },
  { id: "round1", group: "rectangles", labelGu: "એક ખૂણો ગોળ", labelEn: "Round single corner", adjust: 40, padXMm: 3, padYMm: 0.8 },
  { id: "round2same", group: "rectangles", labelGu: "ઉપરના બે ખૂણા ગોળ", labelEn: "Round same-side corners", adjust: 40, padXMm: 3, padYMm: 0.8 },
  { id: "round2diag", group: "rectangles", labelGu: "સામસામા ખૂણા ગોળ", labelEn: "Round diagonal corners", adjust: 40, padXMm: 3, padYMm: 0.8 },

  // Basic shapes that frame words.
  { id: "pill", group: "basic", labelGu: "ગોળ છેડા", labelEn: "Rounded ends", padXMm: 5, padYMm: 0.8 },
  { id: "oval", group: "basic", labelGu: "અંડાકાર", labelEn: "Oval", padXMm: 9, padYMm: 1.5 },
  { id: "concave", group: "basic", labelGu: "અંદર વળેલા ખૂણા (પ્લેક)", labelEn: "Plaque", adjust: 30, padXMm: 4, padYMm: 1 },
  { id: "hexagon", group: "basic", labelGu: "ષટ્કોણ", labelEn: "Hexagon", adjust: 45, padXMm: 6, padYMm: 0.8 },
  { id: "octagon", group: "basic", labelGu: "અષ્ટકોણ", labelEn: "Octagon", adjust: 30, padXMm: 4, padYMm: 0.8 },
  { id: "parallelogram", group: "basic", labelGu: "સમાંતરબાજુ", labelEn: "Parallelogram", adjust: 50, padXMm: 6, padYMm: 0.8 },
  { id: "trapezoid", group: "basic", labelGu: "સમલંબ", labelEn: "Trapezoid", adjust: 50, padXMm: 6, padYMm: 0.8 },
  { id: "frame", group: "basic", labelGu: "ફ્રેમ", labelEn: "Frame", adjust: 20, padXMm: 3, padYMm: 1.2 },
  { id: "bevel", group: "basic", labelGu: "ઉપસેલું ખાનું", labelEn: "Bevel", adjust: 25, padXMm: 3, padYMm: 1.2 },
  { id: "double", group: "basic", labelGu: "બેવડી કિનારી", labelEn: "Double border", adjust: 30, padXMm: 2.5, padYMm: 1 },
  { id: "foldedCorner", group: "basic", labelGu: "વાળેલો ખૂણો", labelEn: "Folded corner", adjust: 35, padXMm: 3, padYMm: 0.8 },
  { id: "bracketPair", group: "basic", labelGu: "કૌંસ ( )", labelEn: "Double bracket", adjust: 30, padXMm: 3, padYMm: 0.8 },
  { id: "bracePair", group: "basic", labelGu: "છગડિયો કૌંસ { }", labelEn: "Double brace", adjust: 30, padXMm: 4, padYMm: 0.8 },

  // Block arrows.
  { id: "pentagon", group: "arrows", labelGu: "તીર (એક બાજુ અણી)", labelEn: "Pentagon arrow", adjust: 45, padXMm: 3, padYMm: 0.8 },
  { id: "chevron", group: "arrows", labelGu: "શેવરોન", labelEn: "Chevron", adjust: 45, padXMm: 6, padYMm: 0.8 },
  { id: "banner", group: "arrows", labelGu: "બંને બાજુ અણીદાર", labelEn: "Pointed both ends", adjust: 40, padXMm: 6, padYMm: 0.8 },
  { id: "arrowRight", group: "arrows", labelGu: "જમણું તીર", labelEn: "Right arrow", adjust: 50, padXMm: 3, padYMm: 1.5 },
  { id: "arrowLeftRight", group: "arrows", labelGu: "બંને બાજુ તીર", labelEn: "Left-right arrow", adjust: 50, padXMm: 7, padYMm: 1.5 },

  // Stars and banners.
  { id: "ribbon", group: "banners", labelGu: "રિબન (કાપેલા છેડા)", labelEn: "Ribbon, notched ends", adjust: 45, padXMm: 7, padYMm: 0.8 },
  { id: "ribbonDown", group: "banners", labelGu: "રિબન — છેડા નીચે", labelEn: "Ribbon tilted down", adjust: 40, padXMm: 10, padYMm: 0.6, padBottomMm: 1.5 },
  { id: "ribbonUp", group: "banners", labelGu: "રિબન — છેડા ઉપર", labelEn: "Ribbon tilted up", adjust: 40, padXMm: 10, padYMm: 1.2 },
  { id: "scroll", group: "banners", labelGu: "વીંટો (સ્ક્રોલ)", labelEn: "Scroll", adjust: 35, padXMm: 7, padYMm: 1.2 },
  { id: "wave", group: "banners", labelGu: "લહેર", labelEn: "Wave", adjust: 40, padXMm: 3, padYMm: 1.8 },
  { id: "doubleWave", group: "banners", labelGu: "બેવડી લહેર", labelEn: "Double wave", adjust: 40, padXMm: 3, padYMm: 1.8 },
  { id: "seal", group: "banners", labelGu: "દાંતાવાળી કિનારી", labelEn: "Seal (starburst edge)", adjust: 40, padXMm: 4, padYMm: 1.6 },

  // Callouts.
  { id: "calloutRect", group: "callouts", labelGu: "કૉલઆઉટ — લંબચોરસ", labelEn: "Rectangular callout", adjust: 15, padXMm: 2, padYMm: 0.6, padBottomMm: 2.5 },
  { id: "calloutRound", group: "callouts", labelGu: "કૉલઆઉટ — ગોળ ખૂણા", labelEn: "Rounded callout", adjust: 15, padXMm: 3, padYMm: 0.6, padBottomMm: 2.5 },
  { id: "calloutOval", group: "callouts", labelGu: "કૉલઆઉટ — અંડાકાર", labelEn: "Oval callout", adjust: 20, padXMm: 9, padYMm: 1.2, padBottomMm: 3 },

  // Decorated frames, after the school's own samples.
  { id: "plaque", group: "decorative", labelGu: "તકતી (સોનેરી ફ્રેમ)", labelEn: "Gold plaque", adjust: 50, padXMm: 9, padYMm: 1.6 },
  { id: "badge", group: "decorative", labelGu: "બેજ (સોનેરી કિનારી)", labelEn: "Gold badge", adjust: 50, padXMm: 4.5, padYMm: 1.6 },
  { id: "floral", group: "decorative", labelGu: "ફૂલવાળી ફ્રેમ", labelEn: "Floral frame", adjust: 50, padXMm: 7, padYMm: 1.6 },
] as const satisfies readonly ShapeInfo[];

export type ShapeId = (typeof SHAPES)[number]["id"];
export const SHAPE_IDS = SHAPES.map((shape) => shape.id) as [ShapeId, ...ShapeId[]];

export function shapeInfo(id: ShapeId): ShapeInfo {
  return SHAPES.find((shape) => shape.id === id) ?? SHAPES[0];
}

/** Excel's outline dashes. */
export const OUTLINE_DASHES = ["solid", "dashed", "dotted", "none"] as const;
export type OutlineDash = (typeof OUTLINE_DASHES)[number];

/** Excel's Shape Effects that print: shadow presets, bevel presets. */
export const SHADOWS = ["outer", "outerStrong", "below", "inner"] as const;
export type ShadowPreset = (typeof SHADOWS)[number];
export const BEVELS = ["soft", "round", "angle"] as const;
export type BevelPreset = (typeof BEVELS)[number];

/** How one piece of a shape is painted. */
export type PieceRole =
  /** The shape itself: the fill (or gradient), the outline and the effects. */
  | "body"
  /** Behind the body, a shade darker: a ribbon's tails, a scroll's rolls. */
  | "shade"
  /** A fold or a turn, darker still. */
  | "dark"
  /** A highlight laid over the body. */
  | "light"
  /** A decorated frame's outer band: the outline colour, edged in the accent. */
  | "band"
  /** The panel the words sit on inside a band: the fill, edged in the accent. */
  | "panel"
  /** Ornament in the accent colour. */
  | "accent"
  /** A line in the outline colour, no fill (brackets, a second border). */
  | "line"
  /** Flower petals: the outline colour. */
  | "petal";

export interface ShapePiece {
  d: string;
  role: PieceRole;
  /** Holes punched by an inner outline (a frame). */
  evenOdd?: boolean;
}

const f = (value: number): string => (Math.round(value * 100) / 100).toString();

function points(list: [number, number][]): string {
  return `M${list.map(([x, y]) => `${f(x)},${f(y)}`).join(" L")} Z`;
}

function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) return points([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  return (
    `M${f(x + rr)},${f(y)} H${f(x + w - rr)} A${f(rr)},${f(rr)} 0 0 1 ${f(x + w)},${f(y + rr)} ` +
    `V${f(y + h - rr)} A${f(rr)},${f(rr)} 0 0 1 ${f(x + w - rr)},${f(y + h)} H${f(x + rr)} ` +
    `A${f(rr)},${f(rr)} 0 0 1 ${f(x)},${f(y + h - rr)} V${f(y + rr)} A${f(rr)},${f(rr)} 0 0 1 ${f(x + rr)},${f(y)} Z`
  );
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${f(cx - rx)},${f(cy)} A${f(rx)},${f(ry)} 0 1 0 ${f(cx + rx)},${f(cy)} A${f(rx)},${f(ry)} 0 1 0 ${f(cx - rx)},${f(cy)} Z`;
}

/**
 * The shape's pieces for a heading `w` by `h` pixels, back to front.
 * `adjust` is 0..100; out of range or absent, the shape's own default.
 */
export function shapePieces(id: ShapeId, w: number, h: number, adjust?: number): ShapePiece[] {
  const info = shapeInfo(id);
  const a = Math.max(0, Math.min(100, adjust ?? info.adjust ?? 50)) / 100;
  const m = Math.min(w, h);
  const body = (d: string): ShapePiece => ({ d, role: "body" });

  switch (id) {
    case "rect":
      return [body(points([[0, 0], [w, 0], [w, h], [0, h]]))];
    case "rounded":
      return [body(roundRect(0, 0, w, h, (a * m) / 2))];
    case "snip1": {
      const s = a * m;
      return [body(points([[0, 0], [w - s, 0], [w, s], [w, h], [0, h]]))];
    }
    case "snip2same": {
      const s = a * m;
      return [body(points([[s, 0], [w - s, 0], [w, s], [w, h], [0, h], [0, s]]))];
    }
    case "snip2diag": {
      const s = a * m;
      return [body(points([[s, 0], [w, 0], [w, h - s], [w - s, h], [0, h], [0, s]]))];
    }
    case "snipRound": {
      const s = a * m;
      return [body(`M${f(s)},0 H${f(w - s)} L${f(w)},${f(s)} V${f(h)} H0 V${f(s)} Q0,0 ${f(s)},0 Z`)];
    }
    case "round1": {
      const r = a * m;
      return [body(`M0,0 H${f(w - r)} Q${f(w)},0 ${f(w)},${f(r)} V${f(h)} H0 Z`)];
    }
    case "round2same": {
      const r = a * m;
      return [body(`M${f(r)},0 H${f(w - r)} Q${f(w)},0 ${f(w)},${f(r)} V${f(h)} H0 V${f(r)} Q0,0 ${f(r)},0 Z`)];
    }
    case "round2diag": {
      const r = a * m;
      return [body(`M${f(r)},0 H${f(w)} V${f(h - r)} Q${f(w)},${f(h)} ${f(w - r)},${f(h)} H0 V${f(r)} Q0,0 ${f(r)},0 Z`)];
    }
    case "pill":
      return [body(roundRect(0, 0, w, h, h / 2))];
    case "oval":
      return [body(ellipse(w / 2, h / 2, w / 2, h / 2))];
    case "concave": {
      const c = (a * m) / 1.5;
      return [
        body(
          `M${f(c)},0 H${f(w - c)} A${f(c)},${f(c)} 0 0 0 ${f(w)},${f(c)} V${f(h - c)} ` +
            `A${f(c)},${f(c)} 0 0 0 ${f(w - c)},${f(h)} H${f(c)} A${f(c)},${f(c)} 0 0 0 0,${f(h - c)} ` +
            `V${f(c)} A${f(c)},${f(c)} 0 0 0 ${f(c)},0 Z`,
        ),
      ];
    }
    case "hexagon":
    case "banner": {
      const d = Math.min(a * h, w / 4);
      return [body(points([[d, 0], [w - d, 0], [w, h / 2], [w - d, h], [d, h], [0, h / 2]]))];
    }
    case "octagon": {
      const c = (a * m) / 1.2;
      return [body(points([[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]]))];
    }
    case "parallelogram": {
      const d = Math.min(a * h, w / 4);
      return [body(points([[d, 0], [w, 0], [w - d, h], [0, h]]))];
    }
    case "trapezoid": {
      const d = Math.min(a * h, w / 4);
      return [body(points([[0, h], [d, 0], [w - d, 0], [w, h]]))];
    }
    case "frame": {
      const t = Math.max(1, (a * m) / 2);
      return [
        {
          d: `${points([[0, 0], [w, 0], [w, h], [0, h]])} ${points([[t, t], [t, h - t], [w - t, h - t], [w - t, t]])}`,
          role: "body",
          evenOdd: true,
        },
      ];
    }
    case "bevel": {
      const t = Math.max(1, (a * m) / 2);
      return [
        body(points([[0, 0], [w, 0], [w, h], [0, h]])),
        { d: points([[0, 0], [w, 0], [w - t, t], [t, t], [t, h - t], [0, h]]), role: "light" },
        { d: points([[w, 0], [w, h], [0, h], [t, h - t], [w - t, h - t], [w - t, t]]), role: "dark" },
      ];
    }
    case "double": {
      const g = Math.max(1.5, (a * m) / 6);
      return [body(points([[0, 0], [w, 0], [w, h], [0, h]])), { d: points([[g, g], [w - g, g], [w - g, h - g], [g, h - g]]), role: "line" }];
    }
    case "foldedCorner": {
      const c = (a * m) / 1.5;
      return [
        body(points([[0, 0], [w, 0], [w, h - c], [w - c, h], [0, h]])),
        { d: points([[w - c, h], [w - c * 0.8, h - c * 0.8], [w, h - c]]), role: "dark" },
      ];
    }
    case "bracketPair": {
      const c = (a * m) / 1.5;
      return [
        { d: points([[0, 0], [w, 0], [w, h], [0, h]]), role: "body" },
        {
          d:
            `M${f(c)},0 Q0,0 0,${f(c)} V${f(h - c)} Q0,${f(h)} ${f(c)},${f(h)} ` +
            `M${f(w - c)},0 Q${f(w)},0 ${f(w)},${f(c)} V${f(h - c)} Q${f(w)},${f(h)} ${f(w - c)},${f(h)}`,
          role: "line",
        },
      ];
    }
    case "bracePair": {
      const c = Math.min((a * m) / 3, h / 4);
      const brace = (x: number, dir: 1 | -1): string =>
        `M${f(x + dir * 2 * c)},0 Q${f(x + dir * c)},0 ${f(x + dir * c)},${f(c)} V${f(h / 2 - c)} ` +
        `Q${f(x + dir * c)},${f(h / 2)} ${f(x)},${f(h / 2)} Q${f(x + dir * c)},${f(h / 2)} ${f(x + dir * c)},${f(h / 2 + c)} ` +
        `V${f(h - c)} Q${f(x + dir * c)},${f(h)} ${f(x + dir * 2 * c)},${f(h)}`;
      return [{ d: points([[0, 0], [w, 0], [w, h], [0, h]]), role: "body" }, { d: `${brace(0, 1)} ${brace(w, -1)}`, role: "line" }];
    }
    case "pentagon": {
      const d = Math.min(a * h, w / 3);
      return [body(points([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h]]))];
    }
    case "chevron": {
      const d = Math.min(a * h, w / 4);
      return [body(points([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h], [d, h / 2]]))];
    }
    case "arrowRight": {
      const head = Math.min(h * 0.9, w / 3);
      const s = (h * (1 - a)) / 2.5;
      return [body(points([[0, s], [w - head, s], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h - s], [0, h - s]]))];
    }
    case "arrowLeftRight": {
      const head = Math.min(h * 0.9, w / 5);
      const s = (h * (1 - a)) / 2.5;
      return [
        body(points([[0, h / 2], [head, 0], [head, s], [w - head, s], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h - s], [head, h - s], [head, h]])),
      ];
    }
    case "ribbon": {
      const n = Math.min(a * h * 0.8, w / 8);
      return [body(points([[0, 0], [w, 0], [w - n, h / 2], [w, h], [0, h], [n, h / 2]]))];
    }
    case "ribbonDown":
    case "ribbonUp": {
      const t = Math.min(w * 0.12, h * (0.8 + a));
      const drop = h * 0.22;
      const up = id === "ribbonUp";
      const y = (value: number): number => (up ? h - value : value);
      const tail = (x0: number, x1: number, notchX: number): ShapePiece => ({
        d: points([[x0, y(drop)], [x1, y(drop)], [x1, y(h)], [x0, y(h)], [notchX, y((drop + h) / 2)]]),
        role: "shade",
      });
      return [
        tail(0, t * 1.4, t * 0.45),
        tail(w, w - t * 1.4, w - t * 0.45),
        { d: points([[t, y(h - drop)], [t * 1.4, y(h)], [t * 1.4, y(h - drop)]]), role: "dark" },
        { d: points([[w - t, y(h - drop)], [w - t * 1.4, y(h)], [w - t * 1.4, y(h - drop)]]), role: "dark" },
        body(points([[t, y(0)], [w - t, y(0)], [w - t, y(h - drop)], [t, y(h - drop)]])),
      ];
    }
    case "scroll": {
      const r = Math.min((a * h) / 1.2, w / 10);
      return [
        body(points([[r, r * 0.4], [w - r, r * 0.4], [w - r, h - r * 0.4], [r, h - r * 0.4]])),
        { d: roundRect(0, 0, r * 1.4, h, r * 0.7), role: "shade" },
        { d: roundRect(w - r * 1.4, 0, r * 1.4, h, r * 0.7), role: "shade" },
        { d: `M${f(r * 0.7)},${f(r * 0.4)} V${f(h - r * 0.4)} M${f(w - r * 0.7)},${f(r * 0.4)} V${f(h - r * 0.4)}`, role: "line" },
      ];
    }
    case "wave": {
      const amp = Math.min(a * h * 0.25, h / 4);
      return [
        body(
          `M0,${f(amp)} C${f(w / 3)},${f(-amp)} ${f((2 * w) / 3)},${f(3 * amp)} ${f(w)},${f(amp)} V${f(h - amp)} ` +
            `C${f((2 * w) / 3)},${f(h - 3 * amp)} ${f(w / 3)},${f(h + amp)} 0,${f(h - amp)} Z`,
        ),
      ];
    }
    case "doubleWave": {
      const amp = Math.min(a * h * 0.25, h / 4);
      return [
        body(
          `M0,${f(amp)} Q${f(w / 8)},${f(-amp)} ${f(w / 4)},${f(amp)} T${f(w / 2)},${f(amp)} T${f((3 * w) / 4)},${f(amp)} T${f(w)},${f(amp)} ` +
            `V${f(h - amp)} Q${f((7 * w) / 8)},${f(h + amp)} ${f((3 * w) / 4)},${f(h - amp)} T${f(w / 2)},${f(h - amp)} T${f(w / 4)},${f(h - amp)} T0,${f(h - amp)} Z`,
        ),
      ];
    }
    case "seal": {
      const d = Math.max(1.5, (a * m) / 4);
      const teeth = (from: [number, number], to: [number, number], out: [number, number]): [number, number][] => {
        const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const count = Math.max(2, Math.round(length / (d * 2.2)));
        const list: [number, number][] = [];
        for (let i = 0; i < count; i += 1) {
          const t0 = i / count;
          const tm = (i + 0.5) / count;
          list.push([from[0] + (to[0] - from[0]) * t0, from[1] + (to[1] - from[1]) * t0]);
          list.push([from[0] + (to[0] - from[0]) * tm + out[0] * d, from[1] + (to[1] - from[1]) * tm + out[1] * d]);
        }
        return list;
      };
      return [
        body(
          points([
            ...teeth([d, d], [w - d, d], [0, -1]),
            ...teeth([w - d, d], [w - d, h - d], [1, 0]),
            ...teeth([w - d, h - d], [d, h - d], [0, 1]),
            ...teeth([d, h - d], [d, d], [-1, 0]),
          ]),
        ),
      ];
    }
    case "calloutRect":
    case "calloutRound": {
      const hb = h * 0.78;
      const tw = Math.min(w * 0.06, hb * 0.8);
      const tx = Math.max(tw, Math.min(w - tw * 2, a * w));
      const r = id === "calloutRound" ? Math.min(hb * 0.3, w / 4) : 0;
      return [
        body(
          `M${f(r)},0 H${f(w - r)} Q${f(w)},0 ${f(w)},${f(r)} V${f(hb - r)} Q${f(w)},${f(hb)} ${f(w - r)},${f(hb)} ` +
            `H${f(tx + tw)} L${f(tx - tw * 0.4)},${f(h)} L${f(tx)},${f(hb)} H${f(r)} Q0,${f(hb)} 0,${f(hb - r)} V${f(r)} Q0,0 ${f(r)},0 Z`,
        ),
      ];
    }
    case "calloutOval": {
      const hb = h * 0.8;
      const tx = Math.max(w * 0.1, Math.min(w * 0.45, a * w));
      return [
        { d: points([[tx, hb * 0.7], [tx + w * 0.08, hb * 0.8], [tx - w * 0.04, h]]), role: "body" },
        body(ellipse(w / 2, hb / 2, w / 2, hb / 2)),
      ];
    }
    case "plaque": {
      const p = Math.min(h * (0.4 + a * 0.5), w * 0.08);
      const i = h * 0.17;
      return [
        { d: points([[0, h / 2], [p, 0], [w - p, 0], [w, h / 2], [w - p, h], [p, h]]), role: "band" },
        { d: points([[i * 1.7, h / 2], [p + i * 0.3, i], [w - p - i * 0.3, i], [w - i * 1.7, h / 2], [w - p - i * 0.3, h - i], [p + i * 0.3, h - i]]), role: "panel" },
        { d: `${ellipse(i * 0.95, h / 2, h * 0.05, h * 0.05)} ${ellipse(w - i * 0.95, h / 2, h * 0.05, h * 0.05)}`, role: "accent" },
      ];
    }
    case "badge": {
      const r = Math.min(h * (0.15 + a * 0.3), w / 6);
      const i = h * 0.13;
      const tick = i * 0.9;
      return [
        { d: roundRect(0, 0, w, h, r), role: "band" },
        { d: roundRect(i, i, w - 2 * i, h - 2 * i, r * 0.6), role: "panel" },
        {
          d:
            `M${f(i * 0.25)},${f(r)} L${f(tick)},${f(i * 0.25 + r * 0.35)} M${f(i * 0.25)},${f(h - r)} L${f(tick)},${f(h - i * 0.25 - r * 0.35)} ` +
            `M${f(w - i * 0.25)},${f(r)} L${f(w - tick)},${f(i * 0.25 + r * 0.35)} M${f(w - i * 0.25)},${f(h - r)} L${f(w - tick)},${f(h - i * 0.25 - r * 0.35)}`,
          role: "accent",
        },
      ];
    }
    case "floral": {
      const r = Math.min(h * (0.2 + a * 0.3), w / 6);
      const flowerR = Math.min(h * 0.11, 9);
      const flower = (cx: number, cy: number): string =>
        [0, 72, 144, 216, 288]
          .map((angle) => {
            const rad = (angle * Math.PI) / 180;
            return ellipse(cx + Math.cos(rad) * flowerR, cy + Math.sin(rad) * flowerR, flowerR * 0.75, flowerR * 0.75);
          })
          .join(" ");
      const corners: [number, number][] = [
        [flowerR * 1.6, flowerR * 1.6],
        [w - flowerR * 1.6, flowerR * 1.6],
        [flowerR * 1.6, h - flowerR * 1.6],
        [w - flowerR * 1.6, h - flowerR * 1.6],
      ];
      const inset = flowerR * 0.9;
      return [
        { d: roundRect(0, 0, w, h, r), role: "panel" },
        { d: roundRect(inset, inset, w - 2 * inset, h - 2 * inset, Math.max(0, r - inset)), role: "line" },
        { d: corners.map(([x, y]) => flower(x, y)).join(" "), role: "petal" },
        { d: corners.map(([x, y]) => ellipse(x, y, flowerR * 0.45, flowerR * 0.45)).join(" "), role: "accent" },
      ];
    }
  }
}

// ------------------------------------------------------------------ painting

/** How a shape is painted: everything optional, the defaults a plain look. */
export interface ShapePaint {
  /** The fill, "#rrggbb", or null for none. */
  fill: string | null;
  /** With fill2, a two-colour gradient at `gradientAngle` degrees (0 = left to right). */
  fill2?: string;
  gradientAngle?: number;
  /** The outline. */
  outline: string;
  outlinePt?: number;
  outlineDash?: OutlineDash;
  /** A decorated frame's ornaments. */
  accent?: string;
  shadow?: ShadowPreset;
  glow?: string;
  glowPt?: number;
  softEdgePt?: number;
  bevel?: BevelPreset;
}

export const DEFAULT_ACCENT = "#d4a017";
const PT_TO_PX = 96 / 72;

/** A colour made darker (amount < 0) or lighter (amount > 0), -1..1. */
export function shade(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): number => {
    const c = (value >> shift) & 255;
    const next = amount < 0 ? c * (1 + amount) : c + (255 - c) * amount;
    return Math.round(Math.max(0, Math.min(255, next)));
  };
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("")}`;
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}

/**
 * The shape as SVG markup, `w` by `h` pixels, painted. `uid` keeps the
 * gradient and filter ids of one heading apart from another's on the page.
 */
export function shapeSvg(id: ShapeId, w: number, h: number, paint: ShapePaint, adjust?: number, uid = "s"): string {
  const pieces = shapePieces(id, w, h, adjust);
  const outlinePx = (paint.outlinePt ?? 1) * PT_TO_PX;
  const dash = paint.outlineDash ?? "solid";
  const accent = paint.accent ?? DEFAULT_ACCENT;
  const fill = paint.fill;
  const base = fill ?? "#ffffff";
  const defs: string[] = [];

  let bodyFill = fill === null ? "none" : fill;
  if (fill !== null && paint.fill2) {
    const angle = ((paint.gradientAngle ?? 90) * Math.PI) / 180;
    const x = Math.cos(angle) / 2;
    const y = Math.sin(angle) / 2;
    defs.push(
      `<linearGradient id="${uid}-g" x1="${f(0.5 - x)}" y1="${f(0.5 - y)}" x2="${f(0.5 + x)}" y2="${f(0.5 + y)}">` +
        `<stop offset="0" stop-color="${escapeAttr(fill)}"/><stop offset="1" stop-color="${escapeAttr(paint.fill2)}"/></linearGradient>`,
    );
    bodyFill = `url(#${uid}-g)`;
  }

  // Effects, as Excel's Shape Effects: shadow, glow and soft edges on the whole shape.
  const filters: string[] = [];
  if (paint.shadow === "outer") filters.push(`<feDropShadow dx="2" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity="0.35"/>`);
  if (paint.shadow === "outerStrong") filters.push(`<feDropShadow dx="3.5" dy="3.5" stdDeviation="2.6" flood-color="#000" flood-opacity="0.5"/>`);
  if (paint.shadow === "below") filters.push(`<feDropShadow dx="0" dy="3" stdDeviation="2.4" flood-color="#000" flood-opacity="0.4"/>`);
  if (paint.glow) {
    const size = (paint.glowPt ?? 4) * PT_TO_PX;
    filters.push(`<feDropShadow dx="0" dy="0" stdDeviation="${f(size / 2)}" flood-color="${escapeAttr(paint.glow)}" flood-opacity="0.85"/>`);
  }
  if (paint.softEdgePt) filters.splice(0, 0, `<feGaussianBlur stdDeviation="${f((paint.softEdgePt * PT_TO_PX) / 2)}"/>`);
  if (filters.length > 0) {
    defs.push(`<filter id="${uid}-f" x="-20%" y="-40%" width="140%" height="180%">${filters.join("")}</filter>`);
  }
  if (paint.shadow === "inner") {
    defs.push(
      `<filter id="${uid}-i" x="0" y="0" width="100%" height="100%"><feOffset dx="2" dy="2"/><feGaussianBlur stdDeviation="2" result="b"/>` +
        `<feComposite in="SourceAlpha" in2="b" operator="out" result="ring"/><feFlood flood-color="#000" flood-opacity="0.45"/>` +
        `<feComposite in2="ring" operator="in"/><feComposite in2="SourceGraphic" operator="over"/></filter>`,
    );
  }

  const stroke = (colour: string, widthPx: number, dashed: OutlineDash): string => {
    if (dashed === "none" || widthPx <= 0) return `stroke="none"`;
    const pattern =
      dashed === "dashed" ? ` stroke-dasharray="${f(widthPx * 4)} ${f(widthPx * 2.5)}"` : dashed === "dotted" ? ` stroke-dasharray="${f(widthPx)} ${f(widthPx * 1.6)}" stroke-linecap="round"` : "";
    return `stroke="${escapeAttr(colour)}" stroke-width="${f(widthPx)}" stroke-linejoin="round"${pattern}`;
  };

  const shapes = pieces.map((piece) => {
    const rule = piece.evenOdd ? ` fill-rule="evenodd"` : "";
    const d = `d="${piece.d}"`;
    switch (piece.role) {
      case "body":
        return `<path ${d}${rule} fill="${bodyFill}" ${stroke(paint.outline, outlinePx, dash)}${paint.shadow === "inner" ? ` filter="url(#${uid}-i)"` : ""}/>`;
      case "shade":
        return `<path ${d}${rule} fill="${escapeAttr(shade(base, -0.2))}" ${stroke(paint.outline, outlinePx, dash)}/>`;
      case "dark":
        return `<path ${d}${rule} fill="${escapeAttr(shade(base, -0.45))}" fill-opacity="0.8" stroke="none"/>`;
      case "light":
        return `<path ${d}${rule} fill="#ffffff" fill-opacity="0.45" stroke="none"/>`;
      case "band":
        return `<path ${d}${rule} fill="${escapeAttr(paint.outline)}" ${stroke(accent, Math.max(1.2, outlinePx), "solid")}/>`;
      case "panel":
        return `<path ${d}${rule} fill="${fill === null ? "#fff8e7" : bodyFill}" ${stroke(id === "floral" ? paint.outline : accent, id === "floral" ? Math.max(2, outlinePx * 2) : Math.max(1, outlinePx * 0.8), dash === "none" ? "solid" : dash)}/>`;
      case "accent":
        return id === "badge"
          ? `<path ${d} fill="none" ${stroke(accent, Math.max(1, outlinePx), "solid")} stroke-linecap="round"/>`
          : `<path ${d} fill="${escapeAttr(accent)}" stroke="none"/>`;
      case "line":
        return `<path ${d} fill="none" ${stroke(id === "floral" ? accent : paint.outline, id === "floral" ? Math.max(0.8, outlinePx * 0.7) : outlinePx, dash === "none" ? "solid" : dash)}/>`;
      case "petal":
        return `<path ${d} fill="${escapeAttr(paint.outline)}" fill-opacity="0.85" stroke="none"/>`;
    }
  });

  // A bevel: light from the top left, shade towards the bottom right, over the shape.
  if (paint.bevel) {
    const strength = paint.bevel === "soft" ? 0.35 : paint.bevel === "round" ? 0.55 : 0.75;
    defs.push(
      `<linearGradient id="${uid}-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${f(strength)}"/>` +
        `<stop offset="${paint.bevel === "angle" ? "0.5" : "0.45"}" stop-color="#fff" stop-opacity="0"/>` +
        `<stop offset="${paint.bevel === "angle" ? "0.5" : "0.55"}" stop-color="#000" stop-opacity="0"/>` +
        `<stop offset="1" stop-color="#000" stop-opacity="${f(strength * 0.5)}"/></linearGradient>`,
    );
    for (const piece of pieces.filter((each) => each.role === "body" || each.role === "panel")) {
      shapes.push(`<path d="${piece.d}"${piece.evenOdd ? ` fill-rule="evenodd"` : ""} fill="url(#${uid}-b)" stroke="none"/>`);
    }
  }

  const group = filters.length > 0 ? `<g filter="url(#${uid}-f)">${shapes.join("")}</g>` : shapes.join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}" overflow="visible">` +
    (defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "") +
    group +
    `</svg>`
  );
}
