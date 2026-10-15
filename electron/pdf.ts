/**
 * Turning a report into a PDF.
 *
 * Electron ships Chromium, so the PDF is produced by the same engine that
 * renders the preview: an offscreen window loads the `#print:<report>` route and
 * `printToPDF` captures it. Two consequences worth stating, because they are the
 * reason this project chose Electron over a Node PDF library:
 *
 *  1. **Gujarati shapes correctly.** Chromium lays out text with HarfBuzz, so
 *     conjuncts (ક્ષ, જ્ઞ, શ્રી), reph (ખર્ચ) and ્ર (પ્રવેશોત્સવ) come out right
 *     with no font surgery. Most Node PDF libraries render Indic text as
 *     disconnected glyphs.
 *  2. **The preview is the artefact.** The same DOM and the same stylesheet
 *     produce both, so proofreading on screen is meaningful.
 *
 * The offscreen window is a plain hidden BrowserWindow rather than `offscreen:
 * true`, because offscreen rendering skips some font and layout work that the
 * printed output depends on.
 */
import { BrowserWindow, type WebContentsPrintOptions } from "electron";
import path from "node:path";
import { writeFile } from "node:fs/promises";

import type { ResolvedPage } from "../src/shared/report-layout.js";

export interface PdfRequest {
  report: string;
  /** Where to write the file. */
  outputPath: string;
  /** The renderer to load: the dev server URL, or a file path when packaged. */
  rendererUrl: string | null;
  rendererFile: string | null;
  preloadPath: string;
  /** Paper, orientation and margins, from the report's page setup (resolvePage). */
  page: ResolvedPage;
}

/** How long to wait for the report to say it has rendered. */
const READY_TIMEOUT_MS = 15_000;

export async function exportReportPdf(request: PdfRequest): Promise<string> {
  const window = await renderReport(request);
  try {
    const { page } = request;
    const isLegal = page.paper === "legal-in" || page.paper === "legal-us";
    const pdf = await window.webContents.printToPDF({
      landscape: page.landscape,
      // The paper as it stands upright, in inches. preferCSSPageSize below
      // means the stylesheet's @page wins anyway (PrintRoot writes it from
      // the same page setup), but stating it here keeps the two from
      // disagreeing silently.
      pageSize: isLegal && page.paper === "legal-us" ? "Legal" : paperInches(page),
      printBackground: true,
      // The stylesheet owns the margins through @page, so Chromium must not
      // add its own on top.
      margins: { marginType: "none" },
      preferCSSPageSize: true,
    });

    await writeFile(request.outputPath, pdf);
    return request.outputPath;
  } finally {
    window.destroy();
  }
}

export type PrintRequest = Omit<PdfRequest, "outputPath">;

/**
 * Standard paper sizes supported directly by Chromium and printer drivers,
 * or custom micron dimensions for other sheets (e.g. folio).
 */
function printPageSize(page: ResolvedPage): WebContentsPrintOptions["pageSize"] {
  switch (page.paper) {
    case "a4":
      return "A4";
    case "a3":
      return "A3";
    case "letter":
      return "Letter";
    case "legal-in":
    case "legal-us":
      return "Legal";
    default:
      return {
        width: Math.round(Math.min(page.paperWidthMm, page.paperHeightMm) * 1000),
        height: Math.round(Math.max(page.paperWidthMm, page.paperHeightMm) * 1000),
      };
  }
}

/**
 * Print a report on a printer: loads the report, then presents the system
 * print dialog where the printer, copies, and options are chosen.
 * Resolves true when sent to printer, false when dialog was cancelled.
 */
export async function printReport(request: PrintRequest): Promise<boolean> {
  const window = await renderReport(request);
  try {
    const { page } = request;

    // On Linux/Wayland, Chromium crashes with SIGTRAP if webContents.print(silent: false)
    // is called on an unmapped (show: false) window because the compositor rejects the
    // unmapped surface (zxdg_exporter_v2 error).
    // The window must be mapped, parented, and displayed for the OS print dialog.
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => w !== window);
    if (parent && !parent.isDestroyed()) {
      window.setParentWindow(parent);
    }
    window.setMenuBarVisibility(false);
    window.setTitle(`છાપો — ${defaultPdfName(request.report, "")}`);
    window.show();

    return await new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const done = (value: boolean | Error) => {
        if (settled) return;
        settled = true;
        if (value instanceof Error) reject(value);
        else resolve(value);
      };

      window.once("closed", () => done(false));

      window.webContents.print(
        {
          silent: false,
          printBackground: true,
          landscape: page.landscape,
          pageSize: printPageSize(page),
          margins: { marginType: "none" },
        },
        (success, failureReason) => {
          // Cancelling the dialog is not a failure.
          if (success || !failureReason || /cancel/i.test(failureReason)) {
            done(success);
          } else {
            done(new Error(`printing failed: ${failureReason}`));
          }
        },
      );
    });
  } finally {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
}

/** The paper as it stands upright, in inches. */
function paperInches(page: ResolvedPage): { width: number; height: number } {
  return {
    width: Math.min(page.paperWidthMm, page.paperHeightMm) / 25.4,
    height: Math.max(page.paperWidthMm, page.paperHeightMm) / 25.4,
  };
}

/** Load the report's print route in a hidden window and wait until it has rendered. */
async function renderReport(request: PrintRequest): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    show: false,
    // Comfortably larger than the sheet, so the hidden window never reflows the
    // layout differently from the preview.
    width: request.page.landscape ? 1600 : 1100,
    height: request.page.landscape ? 1100 : 1600,
    webPreferences: {
      preload: request.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    const hash = `print:${request.report}`;

    if (request.rendererUrl) {
      await window.loadURL(`${request.rendererUrl}#${hash}`);
    } else if (request.rendererFile) {
      await window.loadFile(request.rendererFile, { hash });
    } else {
      throw new Error("no renderer location given for the PDF export");
    }

    await waitForPrintReady(window);
    return window;
  } catch (error) {
    window.destroy();
    throw error;
  }
}

/**
 * Wait for the print route to set window.__printReady.
 *
 * Polling a flag rather than sleeping a fixed time: a slow query would otherwise
 * produce a PDF of an empty page, which is exactly the sort of silent wrongness
 * this project is meant to remove.
 */
async function waitForPrintReady(window: BrowserWindow): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  for (;;) {
    const ready = await window.webContents.executeJavaScript("window.__printReady === true");
    if (ready === true) return;

    if (Date.now() > deadline) {
      throw new Error(
        "the report did not finish rendering within 15 seconds; nothing was written",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

/** A sensible default filename, e.g. "parishisht-10-2025-26.pdf". */
export function defaultPdfName(report: string, yearLabel: string): string {
  const names: Record<string, string> = {
    annexure10: "parishisht-10",
    rojmel: "rojmel",
    grantRegister: "grant-register",
    chequeRegister: "cheque-register",
    billRegister: "bill-register",
    vouchers: "vouchers",
    patrakD: "patrak-d",
    khatavahi: "khatavahi",
    annexure9: "parishisht-9",
  };
  return `${names[report] ?? report}-${yearLabel}.pdf`;
}

