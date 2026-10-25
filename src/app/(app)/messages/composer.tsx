"use client";
import { useRef, useState } from "react";
import { Field, Select, Textarea } from "@/components/ui";

/** Fills {{placeholders}} with sample values for the preview only. */
const fill = (body: string, sample: Record<string, string>) => body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => sample[k] ?? `[${k.replace(/_/g, " ")}]`);

function Bubble({ text, label }: { text: string; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-canvas-2 p-4">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-subtle">{label}</div>
      <div className="ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-aurora px-4 py-2.5 text-sm leading-relaxed text-on-accent shadow-glow">
        <p className="whitespace-pre-wrap break-words">{text || "Your message preview appears here."}</p>
      </div>
      <div className="mt-1.5 text-right text-[10px] tabular-nums text-subtle">{text.length} characters</div>
    </div>
  );
}

/** Template body editor: textarea (submitted as `body`), clickable placeholder chips and a live preview bubble. */
export function TemplateEditor({ defaultValue, disabled, placeholders, sample, hint }: {
  defaultValue: string; disabled?: boolean; placeholders: string[]; sample: Record<string, string>; hint: string;
}) {
  const [body, setBody] = useState(defaultValue);
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (p: string) => {
    const el = ref.current;
    const tag = `{{${p}}}`;
    const at = el?.selectionStart ?? body.length;
    const next = body.slice(0, at) + tag + body.slice(el?.selectionEnd ?? at);
    setBody(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + tag.length, at + tag.length); });
  };
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-2">
        <Field label="Message" hint={hint}>
          <Textarea ref={ref} name="body" rows={7} value={body} onChange={(e) => setBody(e.target.value)} required disabled={disabled} className="font-mono text-[13px]" />
        </Field>
        {!disabled && (
          <div className="flex flex-wrap gap-1.5">
            {placeholders.map((p) => (
              <button key={p} type="button" onClick={() => insert(p)} className="rounded-lg border border-accent/30 bg-accent/10 px-2 py-1 font-mono text-[11px] text-accent transition hover:bg-accent/20">{`{{${p}}}`}</button>
            ))}
          </div>
        )}
      </div>
      <Bubble text={fill(body, sample)} label="Live preview" />
    </div>
  );
}

/** Template picker + custom body (submitted as `templateKey` / `body`) with a preview of what the customer will get. */
export function SendFields({ templates, sample }: { templates: Record<string, string>; sample: Record<string, string> }) {
  const [key, setKey] = useState("custom");
  const [body, setBody] = useState("");
  const text = key === "custom" ? body : templates[key] ?? "";
  return (
    <div className="space-y-4">
      <Field label="Template">
        <Select name="templateKey" defaultValue="custom" onChange={(e) => setKey(e.target.value)}>
          <option value="custom">Custom message</option>
          {Object.keys(templates).map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
        </Select>
      </Field>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Message (for a custom message)" hint="Outside the 24-hour WhatsApp window, free text is delivered by SMS.">
          <Textarea name="body" rows={6} maxLength={1000} defaultValue="" onChange={(e) => setBody(e.target.value)} disabled={key !== "custom"} placeholder={`Hello ${sample.name ?? ""}, …`} />
        </Field>
        <Bubble text={fill(text, sample)} label="Customer will see" />
      </div>
    </div>
  );
}
