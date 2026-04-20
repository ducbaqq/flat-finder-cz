"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Flag, ImagePlus, Loader2, Send, X } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type SubmitState = "idle" | "submitting" | "success";

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/heic",
  "image/heif",
];
const ACCEPT_ATTR = `${ACCEPTED_MIME.join(",")},.heic,.heif`;
const EXT_RE = /\.(png|jpe?g|heic|heif)$/i;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected reader result"));
        return;
      }
      // Strip "data:<mime>;base64," prefix.
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export default function ReportProblemModal() {
  const open = useUiStore((s) => s.reportProblemModalOpen);
  const close = useUiStore((s) => s.closeReportProblemModal);

  const [description, setDescription] = useState("");
  const [signature, setSignature] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset form state whenever the modal closes so reopening is a fresh session.
  useEffect(() => {
    if (!open) {
      setDescription("");
      setSignature("");
      setImages([]);
      setError("");
      setState("idle");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open]);

  // Auto-close 1.8s after a successful submit.
  useEffect(() => {
    if (state !== "success") return;
    const t = setTimeout(close, 1800);
    return () => clearTimeout(t);
  }, [state, close]);

  const handleFilesSelected = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const incoming = Array.from(fileList);

      const accepted: File[] = [];
      let runningTotal = images.reduce((sum, f) => sum + f.size, 0);

      for (const f of incoming) {
        if (images.length + accepted.length >= MAX_IMAGES) {
          setError(`Maximálně ${MAX_IMAGES} obrázků.`);
          break;
        }
        const typeOk =
          ACCEPTED_MIME.includes(f.type.toLowerCase()) || EXT_RE.test(f.name);
        if (!typeOk) {
          setError("Povolené formáty: PNG, JPEG, JPG, HEIC.");
          continue;
        }
        if (f.size > MAX_IMAGE_BYTES) {
          setError(`Obrázek "${f.name}" přesahuje 5 MB.`);
          continue;
        }
        if (runningTotal + f.size > MAX_TOTAL_IMAGE_BYTES) {
          setError("Celková velikost obrázků přesahuje 10 MB.");
          break;
        }
        runningTotal += f.size;
        accepted.push(f);
      }

      if (accepted.length > 0) {
        setImages((prev) => [...prev, ...accepted]);
        if (error && accepted.length === incoming.length) setError("");
      }
      // Reset the input so selecting the same file again fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [images, error],
  );

  const removeImage = useCallback((idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = description.trim();
    if (!trimmed) {
      setError("Popište prosím problém.");
      return;
    }
    setError("");
    setState("submitting");

    try {
      const encoded = await Promise.all(
        images.map(async (f) => ({
          name: f.name,
          type: f.type || "image/jpeg",
          data_base64: await fileToBase64(f),
        })),
      );

      const res = await fetch("/api/report-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: trimmed,
          signature: signature.trim() || undefined,
          page_url:
            typeof window !== "undefined" ? window.location.href : undefined,
          images: encoded.length > 0 ? encoded : undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Nepodařilo se odeslat. Zkuste to prosím znovu.");
        setState("idle");
        return;
      }

      setState("success");
    } catch {
      setError("Nepodařilo se odeslat. Zkontrolujte připojení a zkuste to znovu.");
      setState("idle");
    }
  }, [description, signature, images]);

  const submitting = state === "submitting";
  const success = state === "success";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-lg" data-testid="report-problem-modal">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-primary" />
            <DialogTitle>Nahlásit problém</DialogTitle>
          </div>
          <DialogDescription>
            Našli jste chybu nebo máte návrh? Popište problém a my se na to
            podíváme.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div
            className="flex flex-col items-center gap-3 py-8 text-center"
            data-testid="report-problem-success"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="h-6 w-6" />
            </div>
            <p className="text-base font-medium">Děkujeme, nahlášeno.</p>
            <p className="text-sm text-muted-foreground">
              Ozveme se, pokud budeme potřebovat víc informací.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reportProblemDescription">
                Popis problému <span className="text-destructive">*</span>
              </Label>
              <textarea
                id="reportProblemDescription"
                data-testid="report-problem-description"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (error) setError("");
                }}
                disabled={submitting}
                rows={6}
                maxLength={5000}
                placeholder="Co se stalo? Na které stránce? Co jste zkoušeli?"
                aria-invalid={!!error}
                aria-describedby={error ? "reportProblemDescriptionError" : undefined}
                className={cn(
                  "w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground md:text-sm dark:bg-input/30",
                  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              />
              {error && (
                <p
                  id="reportProblemDescriptionError"
                  className="text-sm text-destructive"
                  data-testid="report-problem-description-error"
                >
                  {error}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="reportProblemSignature">
                Podpis (volitelný)
              </Label>
              <Input
                type="text"
                id="reportProblemSignature"
                data-testid="report-problem-signature"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                disabled={submitting}
                maxLength={200}
                placeholder="Jméno nebo e-mail, abychom vás mohli kontaktovat"
                autoComplete="name"
              />
            </div>

            <div className="space-y-2">
              <Label>Obrázky (volitelné)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_ATTR}
                multiple
                onChange={(e) => handleFilesSelected(e.target.files)}
                disabled={submitting || images.length >= MAX_IMAGES}
                className="sr-only"
                id="reportProblemImages"
                data-testid="report-problem-images-input"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting || images.length >= MAX_IMAGES}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="report-problem-images-button"
                >
                  <ImagePlus className="mr-2 h-4 w-4" />
                  Přidat obrázky
                </Button>
                <span className="text-xs text-muted-foreground">
                  {images.length}/{MAX_IMAGES} · PNG, JPEG, HEIC · max 5 MB/obrázek
                </span>
              </div>
              {images.length > 0 && (
                <ul
                  className="space-y-1"
                  data-testid="report-problem-images-list"
                >
                  {images.map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/30 px-3 py-1.5 text-xs"
                    >
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatBytes(f.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        disabled={submitting}
                        aria-label={`Odstranit ${f.name}`}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={submitting}
              data-testid="report-problem-submit"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Odesílám…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Odeslat
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
