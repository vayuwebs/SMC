import { useRef, useState } from "react";
import type { JSX } from "react";
import { Popover } from "./Popover.js";
import { SHAPES, SHAPE_GROUPS, shapeSvg, type ShapeId, type ShapePaint } from "../../shared/shapes.js";

/**
 * A shape drawn small, for the galleries: the same drawing the report gets,
 * at thumbnail size. The markup is our own (shapes.ts), never user text.
 */
export function ShapeThumb({
  shape,
  paint,
  width = 46,
  height = 22,
  adjust,
}: {
  shape: ShapeId;
  paint: ShapePaint;
  width?: number;
  height?: number;
  adjust?: number;
}): JSX.Element {
  const markup = shapeSvg(shape, width, height, { ...paint, shadow: undefined, glow: undefined, softEdgePt: undefined }, adjust, `t-${shape}`);
  return <span className="shape-thumb" style={{ width, height }} dangerouslySetInnerHTML={{ __html: markup }} />;
}

/**
 * Excel's Shapes gallery: every shape, by group, each drawn as it will look.
 * Picking one inserts it - or, on a heading that has one, changes it and
 * keeps its formatting (Excel's Change Shape).
 */
export function ShapeGallery({
  value,
  paint,
  label,
  groupLabels,
  shapeLabel,
  noneLabel,
  onPick,
  disabled,
  disabledNote,
}: {
  value: ShapeId | undefined;
  paint: ShapePaint;
  label: string;
  groupLabels: Record<(typeof SHAPE_GROUPS)[number], string>;
  shapeLabel: (id: ShapeId) => string;
  noneLabel: string;
  onPick: (shape: ShapeId | undefined) => void;
  /** Shapes that cannot be picked here, and why (shown as their tooltip). */
  disabled?: ReadonlySet<ShapeId>;
  disabledNote?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="ribbon-button big shape-gallery-button"
        aria-haspopup="true"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen(!open)}
      >
        <ShapeThumb shape={value ?? "rect"} paint={paint} width={40} height={20} />
        <span className="ribbon-label">{label} ▾</span>
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} className="shape-gallery-popover" role="menu">
          <button
            type="button"
            className={`shape-tile wide${value === undefined ? " chosen" : ""}`}
            onClick={() => {
              onPick(undefined);
              setOpen(false);
            }}
          >
            {noneLabel}
          </button>
          {SHAPE_GROUPS.map((group) => (
            <div key={group} className="shape-group">
              <div className="palette-heading">{groupLabels[group]}</div>
              <div className="shape-grid">
                {SHAPES.filter((shape) => shape.group === group).map((shape) => (
                  <button
                    key={shape.id}
                    type="button"
                    role="menuitem"
                    className={`shape-tile${value === shape.id ? " chosen" : ""}`}
                    disabled={disabled?.has(shape.id)}
                    title={disabled?.has(shape.id) && disabledNote ? `${shapeLabel(shape.id)} – ${disabledNote}` : shapeLabel(shape.id)}
                    aria-label={shapeLabel(shape.id)}
                    onClick={() => {
                      onPick(shape.id);
                      setOpen(false);
                    }}
                  >
                    <ShapeThumb shape={shape.id} paint={paint} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Popover>
      )}
    </>
  );
}

/** Excel's Shape Styles: ready-made looks, each shown on the heading's own shape. */
export function ShapeStyleGallery<P>({
  shape,
  presets,
  label,
  paintOf,
  onPick,
}: {
  shape: ShapeId;
  presets: { id: string; label: string; patch: P }[];
  label: string;
  paintOf: (patch: P) => ShapePaint;
  onPick: (patch: P) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <div className="shape-style-strip">
        {presets.slice(0, 6).map((preset) => (
          <button key={preset.id} type="button" className="shape-style-tile" title={preset.label} onClick={() => onPick(preset.patch)}>
            <ShapeThumb shape={shape} paint={paintOf(preset.patch)} width={40} height={20} />
          </button>
        ))}
        <button ref={ref} type="button" className="shape-style-more" title={label} aria-label={label} onClick={() => setOpen(!open)}>
          ▾
        </button>
      </div>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} className="shape-gallery-popover" role="menu">
          <div className="palette-heading">{label}</div>
          <div className="shape-grid styles">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="menuitem"
                className="shape-tile"
                title={preset.label}
                aria-label={preset.label}
                onClick={() => {
                  onPick(preset.patch);
                  setOpen(false);
                }}
              >
                <ShapeThumb shape={shape} paint={paintOf(preset.patch)} />
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
