"use client";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { cx, Panel, Select } from "@/components/ui";

type Step = { type: "tool"; label: string } | { type: "answer"; text: string } | { type: "error"; message: string };
type Turn = { question: string; steps: Step[]; done: boolean };

const EXAMPLES = ["What should I reorder this week?", "Which items expire next month?", "How did paracetamol sell after the price change?", "What hasn't sold in 90 days?"];

/** Minimal Markdown: paragraphs, bullet lists, **bold** and simple pipe tables. Text only (no HTML injection). */
function Answer({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="font-semibold text-fg">{p.slice(2, -2)}</strong> : p));
  return (
    <div className="space-y-3 text-sm leading-relaxed text-fg">
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter(Boolean);
        if (lines.length > 1 && lines.every((l) => l.trim().startsWith("|"))) {
          const rows = lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
          return (
            <div key={i} className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-line">{rows[0].map((c, j) => <th key={j} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-subtle">{c}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">{rows.slice(1).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="px-3 py-2 tabular-nums">{inline(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ""))}</li>)}</ul>;
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l.replace(/^#+\s*/, ""))}</span>)}</p>;
      })}
    </div>
  );
}

export function AskBox({ branches, defaultBranch }: { branches: { id: string; name: string }[]; defaultBranch: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState(defaultBranch);
  const busy = turns.some((t) => !t.done);
  const input = useRef<HTMLTextAreaElement>(null);

  async function submit(question: string) {
    question = question.trim();
    if (question.length < 3 || busy) return;
    setQ("");
    const idx = turns.length;
    const push = (s: Step, done = false) => setTurns((all) => all.map((t, i) => (i === idx ? { ...t, steps: [...t.steps, s], done: done || t.done } : t)));
    setTurns((all) => [...all, { question, steps: [], done: false }]);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, branch }) });
      if (!res.ok || !res.body) { push({ type: "error", message: (await res.json().catch(() => null))?.error ?? "Something went wrong." }, true); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) if (l.trim()) push(JSON.parse(l) as Step);
      }
    } catch {
      push({ type: "error", message: "Couldn't reach the server. Check your connection and try again." });
    }
    push({ type: "tool", label: "" }, true);
    input.current?.focus();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {turns.length === 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => submit(e)} className="glass min-h-12 p-4 text-left text-sm text-muted transition hover:-translate-y-0.5 hover:border-line-strong hover:text-fg">
              <Sparkles className="mb-2 h-4 w-4 text-accent" aria-hidden />{e}
            </button>
          ))}
        </div>
      )}
      {turns.map((t, i) => {
        const answer = t.steps.find((s) => s.type === "answer");
        const error = t.steps.find((s) => s.type === "error");
        const tools = t.steps.filter((s): s is Extract<Step, { type: "tool" }> => s.type === "tool" && !!s.label);
        return (
          <div key={i} className="space-y-3">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-accent/15 px-4 py-2.5 text-sm text-fg">{t.question}</div>
            <Panel glow={!t.done}>
              {tools.length > 0 && (
                <ul className="mb-3 space-y-1 text-xs text-subtle" aria-live="polite">
                  {[...new Set(tools.map((s) => s.label))].map((l) => <li key={l} className="flex items-center gap-2">{!t.done && !answer ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <span aria-hidden>·</span>}{l}</li>)}
                </ul>
              )}
              {answer?.type === "answer" ? <Answer text={answer.text} />
                : error?.type === "error" ? <p className="text-sm text-bad">{error.message}</p>
                : <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Thinking…</p>}
            </Panel>
          </div>
        );
      })}
      <form onSubmit={(e) => { e.preventDefault(); submit(q); }} className="glass sticky bottom-4 flex items-end gap-2 p-2">
        {branches.length > 0 && (
          <Select aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} className="w-40 shrink-0">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        <textarea ref={input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} rows={1} placeholder="Ask about sales, stock, expiry or reordering…" aria-label="Your question"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(q); } }}
          className="min-h-10 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-fg outline-none placeholder:text-subtle" />
        <button type="submit" disabled={busy || q.trim().length < 3} aria-label="Ask"
          className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-aurora text-on-accent shadow-glow transition", (busy || q.trim().length < 3) && "opacity-40")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowUp className="h-4 w-4" aria-hidden />}
        </button>
      </form>
    </div>
  );
}
