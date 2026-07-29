// Root route. Once auth exists this redirects: no session -> /login (T3.2),
// pending account -> /pending (T3.8), otherwise -> the user's default clan (T3.6).

export default function HomePage() {
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">ClanBridge</h1>
      <p className="mt-2 text-sm opacity-60">
        Skeleton only. Start at T0.1 in IMPLEMENTATION.md.
      </p>
    </main>
  );
}
