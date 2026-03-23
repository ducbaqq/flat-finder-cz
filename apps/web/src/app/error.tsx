'use client';

export default function Error({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4" data-testid="error-page">
      <h2 className="text-xl font-semibold font-display" data-testid="error-title">
        Něco se pokazilo
      </h2>
      <p className="text-muted-foreground text-sm max-w-md text-center" data-testid="error-message">
        Omlouváme se za potíže. Zkuste obnovit stránku nebo se vraťte na
        hlavní stránku.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium transition-colors"
          data-testid="error-retry-button"
        >
          Zkusit znovu
        </button>
        <a
          href="/"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md hover:bg-muted/80 text-sm font-medium transition-colors"
          data-testid="error-home-link"
        >
          Hlavní stránka
        </a>
      </div>
    </div>
  );
}
