"use client";

import { useCallback, useEffect, useState } from "react";
import { loadLaunches } from "@/lib/launch-history";

type PortfolioLaunch = {
  mint: string;
  signature: string;
  quoteMint: string;
  name: string;
  symbol: string;
  quoteName: string;
  quoteSymbol: string;
  createdAt: number;
  image: string | null;
  balance: string;
  status: "confirmed" | "pending" | "failed" | "unknown";
};

type Portfolio = {
  wallet: string;
  solBalance: string;
  refreshedAt: number;
  launches: PortfolioLaunch[];
};

async function json<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function short(value: string) {
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

function displayBalance(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (amount === 0) return "0";
  if (amount < 0.0001) return "<0.0001";
  return new Intl.NumberFormat("en-US", {
    notation: amount >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 4,
  }).format(amount);
}

export function MyVamps({
  wallet,
  launchRevision,
  onConnect,
}: {
  wallet: string | null;
  launchRevision: number;
  onConnect: () => void;
}) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    setError("");
    try {
      const launches = loadLaunches(wallet);
      const result = await json<Portfolio>(
        await fetch("/api/portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wallet,
            launches: launches.map(({ wallet: _wallet, ...launch }) => launch),
          }),
        }),
      );
      setPortfolio(result);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not load wallet balances.");
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    setPortfolio(null);
    if (wallet) void refresh();
  }, [wallet, launchRevision, refresh]);

  if (!wallet) {
    return (
      <section className="cryptEmpty">
        <span className="cryptMoon" aria-hidden="true">☾</span>
        <p className="kicker">Your private crypt</p>
        <h1>Meet your <em>vamps.</em></h1>
        <p>Connect the wallet you launch with to see its VampPair coins and live balances.</p>
        <button type="button" onClick={onConnect}>Connect wallet</button>
      </section>
    );
  }

  return (
    <section className="crypt">
      <div className="cryptHeading">
        <div>
          <p className="kicker">Your private crypt</p>
          <h1>My <em>Vamps.</em></h1>
          <p>Launches saved by VampPair on this device, checked live against Solana.</p>
        </div>
        <div className="cryptControls">
          <div><span>SOL balance</span><strong>{portfolio?.solBalance ?? "—"} SOL</strong></div>
          <button type="button" onClick={refresh} disabled={loading}>
            {loading ? "Reading chain…" : "Refresh balances"}
          </button>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {!portfolio && loading ? (
        <div className="cryptLoading">Waking the crypt…</div>
      ) : portfolio?.launches.length ? (
        <div className="vampGrid">
          {portfolio.launches.map((launch) => (
            <article className="vampCard" key={launch.mint}>
              <div className="vampCardTop">
                {launch.image ? (
                  <img src={launch.image} alt="" />
                ) : (
                  <span className="vampFallback">V</span>
                )}
                <div>
                  <span className={`status ${launch.status}`}>{launch.status}</span>
                  <h2>{launch.name}</h2>
                  <p>${launch.symbol}</p>
                </div>
              </div>
              <div className="vampBalance">
                <span>Your balance</span>
                <strong>{displayBalance(launch.balance)} <small>${launch.symbol}</small></strong>
              </div>
              <dl>
                <div><dt>Paired to</dt><dd>{launch.quoteName} · ${launch.quoteSymbol}</dd></div>
                <div><dt>Mint</dt><dd>{short(launch.mint)}</dd></div>
                <div><dt>Launched</dt><dd>{new Date(launch.createdAt).toLocaleDateString()}</dd></div>
              </dl>
              <div className="vampLinks">
                <a href={`https://pump.fun/coin/${launch.mint}`} target="_blank" rel="noreferrer">Open on Pump</a>
                <a href={`https://solscan.io/tx/${launch.signature}`} target="_blank" rel="noreferrer">Transaction</a>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="cryptNoCoins">
          <span>V</span>
          <h2>No vamps in this crypt yet.</h2>
          <p>Your next confirmed or pending VampPair launch will appear here automatically.</p>
        </div>
      )}

      <p className="cryptNote">Balances are public on-chain data. Refreshing does not request a signature or spend SOL.</p>
    </section>
  );
}
