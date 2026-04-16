function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type PrintDocumentOptions = {
  title: string;
  bodyHtml: string;
  features?: string;
  onBlocked?: () => void;
  onAfterPrint?: () => void;
};

export function printHtmlDocument(options: PrintDocumentOptions) {
  const printWindow = window.open("", "_blank", options.features || "width=420,height=720");
  if (!printWindow) {
    options.onBlocked?.();
    return null;
  }

  let finished = false;
  const finalize = () => {
    if (finished) {
      return;
    }
    finished = true;
    options.onAfterPrint?.();
  };

  printWindow.onafterprint = finalize;
  printWindow.document.open();
  printWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(options.title)}</title>
        <meta charset="utf-8" />
      </head>
      <body>
        ${options.bodyHtml}
      </body>
    </html>
  `);
  printWindow.document.close();

  const triggerPrint = () => {
    printWindow.focus();
    window.setTimeout(() => {
      try {
        printWindow.print();
      } finally {
        window.setTimeout(finalize, 1000);
      }
    }, 150);
  };

  if (printWindow.document.readyState === "complete") {
    triggerPrint();
  } else {
    printWindow.onload = triggerPrint;
  }

  return printWindow;
}

export { escapeHtml };
