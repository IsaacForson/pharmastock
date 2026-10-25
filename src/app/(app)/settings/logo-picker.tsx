"use client";
import { ImageUp } from "lucide-react";
import { useEffect, useState } from "react";

/** Logo file input with an instant local preview of the chosen image. */
export function LogoPicker({ current, initial }: { current: string | null; initial: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const src = preview ?? current;
  return (
    <label className="group flex cursor-pointer items-center gap-4 rounded-md border border-dashed border-line-strong bg-surface p-4 transition hover:border-accent/50 hover:bg-surface-2">
      <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-surface-2">
        {src
          ? <img src={src} alt="Pharmacy logo preview" className="h-full w-full object-contain p-1.5" />
          : <span className="text-brand text-2xl font-semibold">{initial}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium text-fg"><ImageUp className="h-4 w-4 text-accent" aria-hidden /> {preview ? "New logo selected" : current ? "Replace logo" : "Upload a logo"}</span>
        <span className="block text-xs text-subtle">PNG, JPG or WebP up to 2 MB · saved when you save the profile</span>
      </span>
      <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; setPreview(f ? URL.createObjectURL(f) : null); }} />
    </label>
  );
}
