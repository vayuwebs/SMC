import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider, useStrings } from "../i18n/index.js";

/**
 * "Are you sure?" - asked inside the page, never with window.confirm().
 *
 * Electron on Windows leaves the page without keyboard focus once a native
 * window.confirm() / alert() box closes: keys still reach the page, but no
 * text goes into any box until the window is switched away from and back. To
 * the school it looks like a grey box that cannot be typed in - typically the
 * next dialog opened on the same screen (reopen a year, then rename or delete
 * one). A box drawn by the page itself never takes focus away from it.
 *
 * Callable from anywhere, like window.confirm: `if (!(await askConfirm(text))) return;`
 */
export function askConfirm(message: string): Promise<boolean> {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  return new Promise((resolve) => {
    const answer = (yes: boolean): void => {
      root.unmount();
      host.remove();
      previous?.focus();
      resolve(yes);
    };
    root.render(
      <LanguageProvider>
        <ConfirmBox message={message} onAnswer={answer} />
      </LanguageProvider>,
    );
  });
}

function ConfirmBox({ message, onAnswer }: { message: string; onAnswer: (yes: boolean) => void }): JSX.Element {
  const t = useStrings();
  const ok = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ok.current?.focus();
    // Captured on the window, before the screen underneath sees the key: its own
    // Escape (close the print dialog) must not fire while this asks.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" && event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      onAnswer(event.key === "Enter");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onAnswer]);

  return (
    <div className="confirm-backdrop" onClick={() => onAnswer(false)}>
      <div className="confirm-box" role="alertdialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <p>{message}</p>
        <div className="confirm-actions">
          <button type="button" className="ghost small" onClick={() => onAnswer(false)}>
            {t.cancel}
          </button>
          <button type="button" className="primary small" ref={ok} onClick={() => onAnswer(true)}>
            {t.confirmOk}
          </button>
        </div>
      </div>
    </div>
  );
}
