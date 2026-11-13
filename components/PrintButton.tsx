"use client";

export default function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="btn small secondary"
      onClick={() => {
        document.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
        window.print();
      }}
    >
      {label}
    </button>
  );
}
