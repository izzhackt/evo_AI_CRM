export default function NotificationsLoading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="h-16 animate-pulse rounded-card bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-card bg-surface-2" />
        ))}
      </div>
      <div className="h-20 animate-pulse rounded-card bg-surface-2" />
      <div className="grid gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-card bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
