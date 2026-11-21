import { useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import { APP_MODES, type AppMode } from "../../shared/api.js";
import { modeLabel } from "../format.js";
import { useStrings } from "../i18n/index.js";
import { Popover } from "./Popover.js";

/** Each mode's mark on its tile: a short code inside a coloured orb. */
const MODE_MARK: Record<AppMode, string> = {
  "smc-e": "E",
  "smc-e-old": "1",
  smc: "2",
};

/**
 * The current mode as a pill; pressing it drops a small panel of the three
 * modes, each a coloured tile with its name and what it does. Picking one
 * switches to it; the current one is ticked and cannot be picked again.
 */
export function ModeSwitcher({
  active,
  disabled,
  onSelect,
}: {
  active: AppMode;
  disabled?: boolean;
  /** Switch to this mode. The menu shows it as working until this settles. */
  onSelect: (mode: AppMode) => Promise<void>;
}): JSX.Element {
  const t = useStrings();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<AppMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hint: Record<AppMode, string> = {
    "smc-e": t.modeSmcEHint,
    "smc-e-old": t.modeSmcEOldHint,
    smc: t.modeSmcHint,
  };

  async function pick(mode: AppMode): Promise<void> {
    if (mode === active || busy) return;
    setBusy(mode);
    setError(null);
    try {
      await onSelect(mode);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  // Up and down move between the tiles, as in any menu.
  function onKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const tiles = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".mode-tile")];
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    tiles[(at + step + tiles.length) % tiles.length]?.focus();
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`mode-badge mode-trigger ${active}${open ? " open" : ""}`}
        title={t.modeChange}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setError(null);
          setOpen((now) => !now);
        }}
      >
        <span className="mode-trigger-dot" aria-hidden="true" />
        <span>{modeLabel(active, t)}</span>
        <span className="mode-trigger-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => !busy && setOpen(false)} className="mode-menu" role="menu">
          <div onKeyDown={onKey}>
            <div className="mode-menu-head">
              <strong>{t.modeChange}</strong>
              <span>{t.modeSwitchSubtitle}</span>
            </div>
            <div className="mode-menu-list">
              {APP_MODES.map((mode, index) => {
                const current = mode === active;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current}
                    className={`mode-tile ${mode}${current ? " current" : ""}`}
                    style={{ animationDelay: `${index * 45}ms` }}
                    disabled={busy !== null}
                    autoFocus={current}
                    onClick={() => void pick(mode)}
                  >
                    <span className="mode-tile-orb" aria-hidden="true">
                      {MODE_MARK[mode]}
                    </span>
                    <span className="mode-tile-text">
                      <span className="mode-tile-name">{modeLabel(mode, t)}</span>
                      <span className="mode-tile-hint">{hint[mode]}</span>
                    </span>
                    <span className="mode-tile-end" aria-hidden="true">
                      {busy === mode ? (
                        <span className="mode-tile-spinner" />
                      ) : current ? (
                        <span className="mode-tile-current">✓ {t.modeCurrent}</span>
                      ) : (
                        <span className="mode-tile-arrow">→</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {error !== null && <div className="mode-menu-error">{error}</div>}
          </div>
        </Popover>
      )}
    </>
  );
}
