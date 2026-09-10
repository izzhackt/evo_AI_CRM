export default function StudentPortalPreviewLoading() {
  return (
    <div className="v3-world min-h-dvh">
      <main className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6" aria-busy="true">
        <p role="status" className="text-sm text-fg-2">Загружаем предпросмотр кабинета…</p>
      </main>
    </div>
  );
}
