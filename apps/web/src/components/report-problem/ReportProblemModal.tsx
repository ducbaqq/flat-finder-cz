"use client";

import { useCallback, useState } from "react";
import { Flag, Send } from "lucide-react";
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

export default function ReportProblemModal() {
  const open = useUiStore((s) => s.reportProblemModalOpen);
  const close = useUiStore((s) => s.closeReportProblemModal);

  const [description, setDescription] = useState("");
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmed = description.trim();
    if (!trimmed) {
      setError("Popište prosím problém.");
      return;
    }
    setError("");
    // TODO: wire submit action — currently a no-op stub.
  }, [description]);

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
              rows={6}
              placeholder="Co se stalo? Na které stránce? Co jste zkoušeli?"
              aria-invalid={!!error}
              aria-describedby={error ? "reportProblemDescriptionError" : undefined}
              className={cn(
                "w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground md:text-sm dark:bg-input/30",
                "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
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
              placeholder="Jméno nebo e-mail, abychom vás mohli kontaktovat"
              autoComplete="name"
            />
          </div>

          <Button
            className="w-full"
            onClick={handleSubmit}
            data-testid="report-problem-submit"
          >
            <Send className="mr-2 h-4 w-4" />
            Odeslat
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
