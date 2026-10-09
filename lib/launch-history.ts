export type StoredLaunch = {
  wallet: string;
  mint: string;
  signature: string;
  quoteMint: string;
  name: string;
  symbol: string;
  quoteName: string;
  quoteSymbol: string;
  createdAt: number;
};

const STORAGE_KEY = "vamppair:launches:v1";
const MAX_LAUNCHES = 50;

function isStoredLaunch(value: unknown): value is StoredLaunch {
  if (!value || typeof value !== "object") return false;
  const launch = value as Partial<StoredLaunch>;
  return (
    typeof launch.wallet === "string" &&
    typeof launch.mint === "string" &&
    typeof launch.signature === "string" &&
    typeof launch.quoteMint === "string" &&
    typeof launch.name === "string" &&
    typeof launch.symbol === "string" &&
    typeof launch.quoteName === "string" &&
    typeof launch.quoteSymbol === "string" &&
    typeof launch.createdAt === "number"
  );
}

export function loadLaunches(wallet?: string) {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const launches = parsed.filter(isStoredLaunch).slice(0, MAX_LAUNCHES);
    return wallet ? launches.filter((launch) => launch.wallet === wallet) : launches;
  } catch {
    return [];
  }
}

export function rememberLaunch(launch: StoredLaunch) {
  if (typeof window === "undefined") return;
  const previous = loadLaunches();
  const next = [launch, ...previous.filter((item) => item.mint !== launch.mint)].slice(
    0,
    MAX_LAUNCHES,
  );
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
