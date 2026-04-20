"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  CloudUpload,
  FileImage,
  Flag,
  Image as ImageIcon,
  Loader2,
  Mountain,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
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
const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/jpg"];
const ACCEPT_ATTR = ACCEPTED_MIME.join(",");
const EXT_RE = /\.(png|jpe?g)$/i;

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
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset form state whenever the modal closes so reopening is a fresh session.
  useEffect(() => {
    if (!open) {
      setDescription("");
      setSignature("");
      setImages([]);
      setError("");
      setState("idle");
      setIsDragging(false);
      dragDepth.current = 0;
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
          setError(`Maximálně ${MAX_IMAGES} snímků obrazovky.`);
          break;
        }
        const typeOk =
          ACCEPTED_MIME.includes(f.type.toLowerCase()) || EXT_RE.test(f.name);
        if (!typeOk) {
          setError("Povolené formáty: PNG, JPEG.");
          continue;
        }
        if (f.size > MAX_IMAGE_BYTES) {
          setError(`Snímek "${f.name}" přesahuje 5 MB.`);
          continue;
        }
        if (runningTotal + f.size > MAX_TOTAL_IMAGE_BYTES) {
          setError("Celková velikost snímků obrazovky přesahuje 10 MB.");
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

  // Drag state tracked with a depth counter so nested children don't flicker
  // dragleave/dragenter as the pointer moves over inner elements.
  const isSubmitting = state === "submitting";
  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (isSubmitting) return;
      e.preventDefault();
      dragDepth.current += 1;
      if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
    },
    [isSubmitting],
  );
  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (isSubmitting) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [isSubmitting],
  );
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (isSubmitting) return;
      e.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      handleFilesSelected(e.dataTransfer.files);
    },
    [isSubmitting, handleFilesSelected],
  );

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

  const submitting = isSubmitting;
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
                aria-describedby={error ? "reportProblemFormError" : undefined}
                className={cn(
                  "w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground md:text-sm dark:bg-input/30",
                  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              />
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
              <Label htmlFor="reportProblemImages">Snímky obrazovky (volitelné)</Label>
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
              <div
                role="button"
                tabIndex={submitting || images.length >= MAX_IMAGES ? -1 : 0}
                aria-label="Přetáhněte snímky obrazovky nebo klikněte pro výběr"
                onClick={() => {
                  if (submitting || images.length >= MAX_IMAGES) return;
                  fileInputRef.current?.click();
                }}
                onKeyDown={(e) => {
                  if (submitting || images.length >= MAX_IMAGES) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragEnter={onDragEnter}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                data-testid="report-problem-dropzone"
                className={cn(
                  "relative flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-5 py-4 text-center transition-all duration-200 outline-none",
                  "focus-visible:ring-2 focus-visible:ring-primary/40",
                  isDragging
                    ? "border-primary bg-primary/10 scale-[1.01]"
                    : "border-primary/30 bg-primary/5 hover:border-primary/60 hover:bg-primary/10",
                  (submitting || images.length >= MAX_IMAGES) &&
                    "cursor-not-allowed opacity-60 pointer-events-none",
                )}
              >
                {/* Icon cluster */}
                <div className="relative">
                  {/* Decorative sparkles/pluses */}
                  <Sparkles
                    className="absolute -left-6 -top-1 h-2.5 w-2.5 text-primary/50"
                    aria-hidden
                  />
                  <Plus
                    className="absolute -right-6 top-0 h-2.5 w-2.5 text-primary/50"
                    aria-hidden
                  />
                  <Sparkles
                    className="absolute -right-5 -bottom-0.5 h-2 w-2 text-primary/40"
                    aria-hidden
                  />
                  <Plus
                    className="absolute -left-5 bottom-0 h-2 w-2 text-primary/40"
                    aria-hidden
                  />

                  <div className="relative flex items-end gap-1.5">
                    <FileImage
                      className="h-5 w-5 -rotate-6 text-primary/60"
                      strokeWidth={1.6}
                      aria-hidden
                    />
                    <ImageIcon
                      className="h-6 w-6 text-primary/70"
                      strokeWidth={1.6}
                      aria-hidden
                    />
                    {/* Center: cloud with upward arrow */}
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-background shadow-sm ring-2 ring-primary/20">
                      <CloudUpload
                        className="h-5 w-5 text-primary"
                        strokeWidth={1.8}
                        aria-hidden
                      />
                    </div>
                    <Mountain
                      className="h-6 w-6 text-primary/70"
                      strokeWidth={1.6}
                      aria-hidden
                    />
                    <Camera
                      className="h-5 w-5 rotate-6 text-primary/60"
                      strokeWidth={1.6}
                      aria-hidden
                    />
                  </div>
                </div>

                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {isDragging
                      ? "Pusťte snímky obrazovky sem"
                      : "Přetáhněte snímky obrazovky sem"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPEG · max 5 MB/snímek · {images.length}/{MAX_IMAGES}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  tabIndex={-1}
                  disabled={submitting || images.length >= MAX_IMAGES}
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  data-testid="report-problem-images-button"
                  className="h-7 px-3 text-xs"
                >
                  Vybrat snímky
                </Button>
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

            {error && (
              <div
                id="reportProblemFormError"
                role="alert"
                data-testid="report-problem-error"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                <span>{error}</span>
              </div>
            )}

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
