const POOL_SIZE = 4;

// Pool per sound type — created lazily on first play
const pools = new Map<string, HTMLAudioElement[]>();
const cursors = new Map<string, number>();

export function playSound(action: string): void {
  if (typeof window === "undefined") return;

  let pool = pools.get(action);
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(`/sounds/${action}/${action}.mp3`);
      a.preload = "auto";
      pool.push(a);
    }
    pools.set(action, pool);
    cursors.set(action, 0);
  }

  let cursor = cursors.get(action)!;

  // Allin interrupts all currently-playing allin sounds
  if (action === "allin") {
    for (const a of pool) {
      if (!a.paused && !a.ended) {
        a.pause();
        a.currentTime = 0;
      }
    }
    // Reset cursor so we always use the first allin slot after interrupt
    cursor = 0;
  }

  // Round-robin: find first idle element
  let audio: HTMLAudioElement | null = null;
  for (let i = 0; i < pool.length; i++) {
    const idx = (cursor + i) % pool.length;
    const a = pool[idx]!;
    if (a.paused || a.ended) {
      audio = a;
      cursor = (idx + 1) % pool.length;
      break;
    }
  }

  // All busy — skip
  if (!audio) return;

  cursors.set(action, cursor);
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function stopAllinSound(): void {
  if (typeof window === "undefined") return;
  const pool = pools.get("allin");
  if (!pool) return;
  for (const a of pool) {
    if (!a.paused && !a.ended) {
      a.pause();
      a.currentTime = 0;
    }
  }
}
