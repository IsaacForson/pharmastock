"use client";
import { Printer } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { receiptEscpos, type ReceiptData } from "@/lib/receipt";
import { printBytes, reconnectPrinter, savedPrinter } from "../pos/printer";

/** Reprints on the till's thermal printer when one was connected on this device; otherwise opens the print dialog. */
export function ThermalPrintButton({ data }: { data: ReceiptData }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button onClick={async () => {
        const p = savedPrinter();
        try {
          if (p.kind !== "browser" && (await reconnectPrinter(p.kind)) && (await printBytes(receiptEscpos(data, p.width)))) { setMsg("Sent to the printer"); return; }
        } catch { /* fall back to the dialog */ }
        window.print();
      }}><Printer className="h-4 w-4" aria-hidden /> Print</Button>
      {msg && <span role="status" className="text-xs text-muted">{msg}</span>}
    </span>
  );
}
