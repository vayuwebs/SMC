/**
 * A window in the middle of the screen, over everything else: for a step the
 * user must see at once (choosing a cloud backup, confirming a delete). It
 * opens where the eye already is, never further down a long page.
 *
 * Escape or a click outside closes it - unless `busy`, while its work runs.
 */
import { useEffect, useRef } from "react";
import type { JSX, ReactNode } from "react";
import { createPortal } from "react-dom";

export function Modal({
  title,
  onClose,
  busy = false,
  wide = false,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  busy?: boolean;
  /** Room for a table (the list of backups). */
  wide?: boolean;
  children: ReactNode;
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const blocked = useRef(busy);
  blocked.current = busy;

  useEffect(() => {
    // Into the window, so the keyboard starts there.
    const first = box.current?.querySelector<HTMLElement>("[autofocus], input, button.primary, button");
    (first ?? box.current)?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || blocked.current) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return createPortal(
    <div className="modal-backdrop" onClick={() => !blocked.current && close.current()}>
      <div
        ref={box}
        className={`modal-box${wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="modal-close" aria-label="×" disabled={busy} onClick={() => close.current()}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
