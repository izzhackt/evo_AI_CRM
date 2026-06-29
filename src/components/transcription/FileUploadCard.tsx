"use client";

import { useRef, useState } from "react";

type FileUploadCardProps = {
  file: File | null;
  disabled?: boolean;
  onFile: (file: File) => void;
};

export function FileUploadCard({ file, disabled, onFile }: FileUploadCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function accept(files: FileList | null) {
    const next = files?.[0];
    if (next) onFile(next);
  }

  return (
    <div
      className={[
        "group relative overflow-hidden rounded-[18px] border border-blue-100 bg-white p-4 shadow-[0_22px_70px_-44px_rgba(29,78,216,0.55)] transition-transform duration-200",
        dragging ? "scale-[1.01] border-blue-400" : "hover:-translate-y-0.5",
        disabled ? "pointer-events-none opacity-70" : "",
      ].join(" ")}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        accept(event.dataTransfer.files);
      }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(rgba(37,99,235,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(37,99,235,0.06)_1px,transparent_1px)] bg-[size:28px_28px]" />
      <div className="absolute inset-x-8 top-8 h-24 rounded-full bg-blue-300/20 blur-3xl" />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="relative flex min-h-[270px] w-full flex-col items-center justify-center rounded-[14px] border border-dashed border-blue-200 bg-white/80 px-6 py-7 text-center outline-none backdrop-blur transition-[border-color,box-shadow,transform] duration-200 hover:border-blue-400 hover:shadow-[0_18px_50px_-38px_rgba(37,99,235,0.7)] focus-visible:border-blue-500 focus-visible:ring-4 focus-visible:ring-blue-100"
      >
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-blue-600 text-white shadow-[0_14px_34px_-18px_rgba(37,99,235,0.9)]">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <span className="mt-5 text-[17px] font-bold text-slate-950">Drop MP3 call here</span>
        <span className="mt-2 max-w-[260px] text-[13px] leading-6 text-slate-500">
          Select one Evo admissions call. The transcript will stream while the file is processed.
        </span>
        <span className="mt-5 inline-flex h-9 items-center rounded-full border border-blue-100 bg-blue-50 px-3 text-[12px] font-semibold text-blue-700">
          {file ? file.name : "MP3 only"}
        </span>
      </button>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept=".mp3,audio/mpeg,audio/mp3"
        disabled={disabled}
        onChange={(event) => accept(event.target.files)}
      />
    </div>
  );
}
