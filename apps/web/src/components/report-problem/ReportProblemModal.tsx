"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Flag, Loader2, Send } from "lucide-react";
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

export default function ReportProblemModal() {
  const open = useUiStore((s) => s.reportProblemModalOpen);
  const close = useUiStore((s) => s.closeReportProblemModal);

  const [description, setDescription] = useState("");
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState<SubmitState>("idle");

  // Reset form state whenever the modal closes so reopening is a fresh session.
  useEffect(() => {
    if (!open) {
      setDescription("");
      setSignature("");
      setError("");
      setState("idle");
    }
  }, [open]);

  // Auto-close 1.8s after a successful submit.
  useEffect(() => {
    if (state !== "success") return;
    const t = setTimeout(close, 1800);
    return () => clearTimeout(t);
  }, [state, close]);

  const handleSubmit = useCallback(async () => {
    const trimmed = description.trim();
    if (!trimmed) {
      setError("Popište prosím problém.");
      return;
    }
    setError("");
    setState("submitting");

    try {
      const res = await fetch("/api/report-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: trimmed,
          signature: signature.trim() || undefined,
          page_url:
            typeof window !== "undefined" ? window.location.href : undefined,
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
  }, [description, signature]);

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
