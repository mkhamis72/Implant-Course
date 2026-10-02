'use client';

export function PrintButton() {
  return (
    <button className="btn-secondary btn print:hidden" onClick={() => window.print()}>
      Print
    </button>
  );
}
