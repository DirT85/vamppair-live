"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useVampWallet, WalletButton } from "./wallet";
import { MyVamps } from "./my-vamps";
import { rememberLaunch } from "@/lib/launch-history";

type Coin = {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  image: string | null;
  metadataUri: string | null;
  creator: string | null;
  migrated: boolean;
  eligible: true;
  newDepth: number;
  quoteDecimals: number;
};

type Stage = "pick" | "compose" | "uploading" | "preflight" | "signing" | "sending" | "buy-preflight" | "buy-signing" | "buy-sending" | "success";
type IdentityMode = "custom" | "copy";
type LaunchStatus = "confirmed" | "expired" | "pending";
type View = "launcher" | "portfolio";
type LaunchSendResult = {
  signature: string;
  explorerUrl: string;
  status: LaunchStatus;
  message?: string;
};

function mintFromInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) || "";
  } catch {
    return trimmed;
  }
}

function short(value: string) {
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

function symbolLabel(value: string) {
  return value.startsWith("$") ? value : `$${value}`;
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function json<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function confirmSubmitted(
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
): Promise<LaunchSendResult> {
  const explorerUrl = `https://solscan.io/tx/${signature}`;
  try {
    return await json<LaunchSendResult>(
      await fetch("/api/launch/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature, blockhash, lastValidBlockHeight }),
      }),
    );
  } catch {
    return {
      signature,
      explorerUrl,
      status: "pending",
      message: "Your wallet submitted the transaction. Confirmation is still pending; check the transaction before trying again.",
    };
  }
}

export default function Home() {
  const { account, sendTransaction, connected, openPicker } = useVampWallet();
  const publicKey = useMemo(() => account ? new PublicKey(account.address) : null, [account]);
  const [view, setView] = useState<View>("launcher");
  const [launchRevision, setLaunchRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [coin, setCoin] = useState<Coin | null>(null);
  const [identityMode, setIdentityMode] = useState<IdentityMode>("custom");
  const [newName, setNewName] = useState("");
  const [newSymbol, setNewSymbol] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [initialBuy, setInitialBuy] = useState("0");
  const [confirmed, setConfirmed] = useState(false);
  const [stage, setStage] = useState<Stage>("pick");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    mint: string;
    signature: string;
    explorerUrl: string;
    status: LaunchStatus;
    message?: string;
    buyExplorerUrl?: string;
  } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  useEffect(() => {
    if (!image) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const walletLabel = useMemo(
    () => (publicKey ? short(publicKey.toBase58()) : "Not connected"),
    [publicKey],
  );
  const launchName = identityMode === "copy" ? coin?.name || "" : newName.trim();
  const launchSymbol = identityMode === "copy" ? coin?.symbol || "" : newSymbol.trim().toUpperCase();
  const identityReady = Boolean(launchName && launchSymbol);
  const initialBuyValue = initialBuy.trim() || "0";
  const initialBuyReady = Boolean(
    coin &&
    /^\d{1,10}(?:\.\d{0,9})?$/.test(initialBuyValue) &&
    (initialBuyValue.split(".")[1]?.length || 0) <= coin.quoteDecimals
  );
  const hasInitialBuy = initialBuyReady && Number(initialBuyValue) > 0;

  async function inspect(event: FormEvent) {
    event.preventDefault();
    setError("");
    const mint = mintFromInput(query);
    if (!mint) return setError("Paste a Pump coin URL or mint address.");
    setStage("preflight");
    try {
      const loaded = await json<Coin>(await fetch(`/api/coin/${encodeURIComponent(mint)}`));
      setCoin(loaded);
      setIdentityMode("custom");
      setNewName("");
      setNewSymbol("");
      setImage(null);
      setInitialBuy("0");
      setConfirmed(false);
      setDescription(`A vamp paired directly against ${loaded.name}. Original mint: ${loaded.mint}`);
      setStage("compose");
    } catch (problem) {
      setStage("pick");
      setError(problem instanceof Error ? problem.message : "Coin lookup failed.");
    }
  }

  async function launch() {
    if (!coin || !publicKey || !sendTransaction || !image || !confirmed || !identityReady) return;
    setError("");
    setResult(null);

    try {
      const mintKeypair = Keypair.generate();
      setStage("uploading");
      const form = new FormData();
      form.set("name", launchName);
      form.set("symbol", launchSymbol);
      form.set("description", description);
      form.set("image", image);
      const metadata = await json<{ metadataUri: string }>(
        await fetch("/api/metadata", { method: "POST", body: form }),
      );

      setStage("preflight");
      const built = await json<{
        transaction: string;
        mint: string;
        blockhash: string;
        lastValidBlockHeight: number;
        networkFeeLamports: number;
        simulatedUnits: number | null;
      }>(
        await fetch("/api/launch/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user: publicKey.toBase58(),
            quoteMint: coin.mint,
            mint: mintKeypair.publicKey.toBase58(),
            name: launchName,
            symbol: launchSymbol,
            uri: metadata.metadataUri,
          }),
        }),
      );

      setStage("signing");
      const transaction = VersionedTransaction.deserialize(base64ToBytes(built.transaction));
      transaction.sign([mintKeypair]);
      const signature = await sendTransaction(transaction);

      setStage("sending");
      const sent = await confirmSubmitted(signature, built.blockhash, built.lastValidBlockHeight);

      let buyExplorerUrl: string | undefined;
      let launchMessage = sent.message;
      if (hasInitialBuy && sent.status === "confirmed") {
        try {
          setStage("buy-preflight");
          const buyBuilt = await json<{
            transaction: string;
            blockhash: string;
            lastValidBlockHeight: number;
          }>(
            await fetch("/api/launch/buy/build", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                user: publicKey.toBase58(),
                mint: built.mint,
                quoteMint: coin.mint,
                quoteAmount: initialBuyValue,
              }),
            }),
          );

          setStage("buy-signing");
          const buyTransaction = VersionedTransaction.deserialize(base64ToBytes(buyBuilt.transaction));
          const buySignature = await sendTransaction(buyTransaction);

          setStage("buy-sending");
          const bought = await confirmSubmitted(
            buySignature,
            buyBuilt.blockhash,
            buyBuilt.lastValidBlockHeight,
          );
          buyExplorerUrl = bought.explorerUrl;
          launchMessage = bought.status === "confirmed"
            ? `Initial buy of ${initialBuyValue} ${symbolLabel(coin.symbol)} confirmed.`
            : `Coin launched. The initial buy was submitted and is ${bought.status}. ${bought.message || "Check the buy transaction before retrying."}`;
        } catch (buyProblem) {
          launchMessage = `Coin launched, but the initial buy did not complete: ${buyProblem instanceof Error ? buyProblem.message : "Unknown error."}`;
        }
      } else if (hasInitialBuy && sent.status !== "confirmed") {
        launchMessage = `${sent.message || "Creation is still pending."} The initial buy was not submitted yet.`;
      }

      if (sent.status !== "expired") {
        rememberLaunch({
          wallet: publicKey.toBase58(),
          mint: built.mint,
          signature: sent.signature,
          quoteMint: coin.mint,
          name: launchName,
          symbol: launchSymbol,
          quoteName: coin.name,
          quoteSymbol: coin.symbol,
          createdAt: Date.now(),
        });
        setLaunchRevision((value) => value + 1);
      }

      setResult({ mint: built.mint, ...sent, message: launchMessage, buyExplorerUrl });
      setStage("success");
    } catch (problem) {
      setStage("compose");
      setError(problem instanceof Error ? problem.message : "Launch failed.");
    }
  }

  const busy = ["uploading", "preflight", "signing", "sending", "buy-preflight", "buy-signing", "buy-sending"].includes(stage);
  const actionLabel = !identityReady
    ? "Enter vamp name & ticker"
    : !initialBuyReady
      ? `Use up to ${coin?.quoteDecimals || 0} decimals for initial buy`
    : !connected
      ? "Connect wallet above"
    : !image
      ? "Choose vamp artwork"
      : !confirmed
        ? "Confirm mainnet launch"
        : stage === "uploading"
          ? "Pinning metadata…"
          : stage === "preflight"
            ? "Running on-chain preflight…"
            : stage === "signing"
              ? "Approve in wallet…"
              : stage === "sending"
                ? "Confirming on Solana…"
                : stage === "buy-preflight"
                  ? "Preparing initial buy…"
                  : stage === "buy-signing"
                    ? "Approve initial buy…"
                    : stage === "buy-sending"
                      ? "Confirming initial buy…"
                : "Launch vamp on mainnet";

  return (
    <>
      <div className="bloodbar" />
      <header className="topnav">
        <button className="brand" type="button" onClick={() => { setView("launcher"); setCoin(null); setStage("pick"); setError(""); }}>
          <span className="crest">V</span>
          <span>Vamp<span>Pair</span></span>
        </button>
        <span className="network"><i /> Solana mainnet</span>
        <div className="navActions">
          <button className="navTab" type="button" onClick={() => setView(view === "portfolio" ? "launcher" : "portfolio")}>
            {view === "portfolio" ? "Launch" : "My Vamps"}
          </button>
          <WalletButton />
        </div>
      </header>

      <main>
        {view === "portfolio" ? (
          <MyVamps
            wallet={publicKey?.toBase58() || null}
            launchRevision={launchRevision}
            onConnect={openPicker}
          />
        ) : !coin ? (
          <section className="picker">
            <div className="moon" aria-hidden="true">☾</div>
            <p className="kicker">The bloodline launcher</p>
            <h1>Choose the <em>original.</em></h1>
            <p className="lede">Paste any Pump coin. VampPair checks the real on-chain curve, rejects vamps of vamps, and prepares a wallet-signed mainnet launch.</p>
            <form className="search" onSubmit={inspect}>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pump URL or mint address" aria-label="Pump coin URL or mint address" />
              <button disabled={stage === "preflight"}>{stage === "preflight" ? "Reading chain…" : "Check bloodline"}</button>
            </form>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="rules">
              <span><b>01</b> On-chain eligibility</span>
              <span><b>02</b> Choose vamp identity</span>
              <span><b>03</b> Sign with your wallet</span>
            </div>
          </section>
        ) : (
          <section className="workspace">
            <button className="back" type="button" onClick={() => { setCoin(null); setStage("pick"); setError(""); }}>Choose another original</button>
            <div className="workspaceTitle">
              <div><p className="kicker">Eligible bloodline · mainnet verified</p><h1>Prepare the <em>bite.</em></h1></div>
              <div className="walletState"><span>Signing wallet</span><b>{walletLabel}</b></div>
            </div>

            <div className="pairGrid">
              <article className="coinPanel original">
                <span className="panelTag">Original · pair asset</span>
                <div className="identity">
                  {coin.image ? <img src={coin.image} alt="" /> : <div className="fallback">{coin.symbol.slice(0, 2)}</div>}
                  <div><h2>{coin.name}</h2><p>{symbolLabel(coin.symbol)}</p></div>
                </div>
                <code>{coin.mint}</code>
                <dl>
                  <div><dt>Eligibility</dt><dd>Verified on-chain</dd></div>
                  <div><dt>Curve</dt><dd>{coin.migrated ? "Migrated to PumpSwap" : "Active bonding curve"}</dd></div>
                  <div><dt>New curve depth</dt><dd>{coin.newDepth}</dd></div>
                </dl>
              </article>

              <div className="fang" aria-hidden="true"><span>BITES</span></div>

              <article className="coinPanel vamp">
                <span className="panelTag">New vamp · {identityMode === "copy" ? "copied identity" : "custom identity"}</span>
                <div className="identity">
                  <div className="vampArt">{imagePreview ? <img src={imagePreview} alt="Vamp artwork preview" /> : <span>+</span>}</div>
                  <div><h2>{launchName || "Name your vamp"}</h2><p>{launchSymbol ? symbolLabel(launchSymbol) : "$TICKER"}</p></div>
                </div>
                <div className="identityChoice" aria-label="Vamp coin identity">
                  <button type="button" className={identityMode === "custom" ? "active" : ""} aria-pressed={identityMode === "custom"} onClick={() => setIdentityMode("custom")}>
                    <b>Custom identity</b><span>Choose a new name and ticker</span>
                  </button>
                  <button type="button" className={identityMode === "copy" ? "active" : ""} aria-pressed={identityMode === "copy"} onClick={() => setIdentityMode("copy")}>
                    <b>Copy original</b><span>Reuse {coin.name} · {symbolLabel(coin.symbol)}</span>
                  </button>
                </div>
                {identityMode === "custom" && (
                  <div className="identityFields">
                    <label className="field">
                      <span>New coin name</span>
                      <input value={newName} maxLength={32} placeholder="e.g. Count Dripula" autoComplete="off" onChange={(event) => setNewName(event.target.value)} />
                    </label>
                    <label className="field">
                      <span>New ticker</span>
                      <input value={newSymbol} maxLength={13} placeholder="DRIP" autoCapitalize="characters" autoComplete="off" onChange={(event) => setNewSymbol(event.target.value.toUpperCase().replace(/\s/g, ""))} />
                    </label>
                  </div>
                )}
                <label className="upload">
                  <span>Vamp artwork <small>PNG, JPG, GIF or WEBP · 5 MB max</small></span>
                  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => setImage(event.target.files?.[0] || null)} />
                </label>
                <label className="field">
                  <span>Description</span>
                  <textarea value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} />
                </label>
              </article>
            </div>

            <section className="launchBox">
              <label className="field initialBuyField">
                <span>Initial buy <small>Optional · paid in {symbolLabel(coin.symbol)}</small></span>
                <div className="amountInput">
                  <input
                    value={initialBuy}
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={20}
                    aria-describedby="initial-buy-help"
                    onChange={(event) => setInitialBuy(event.target.value.replace(/[^0-9.]/g, ""))}
                  />
                  <b>{symbolLabel(coin.symbol)}</b>
                </div>
                <small id="initial-buy-help">Enter 0 for no buy. A buy spends the original paired coin, with up to 5% slippage—not SOL.</small>
              </label>
              <div className="launchFacts">
                <div><span>Network</span><strong>Mainnet-beta</strong></div>
                <div><span>Initial buy</span><strong>{hasInitialBuy ? `${initialBuyValue} ${symbolLabel(coin.symbol)}` : "None"}</strong></div>
                <div><span>New coin</span><strong>{launchName || "Not named yet"}</strong></div>
                <div><span>Quote asset</span><strong>{symbolLabel(coin.symbol)}</strong></div>
                <div><span>Authority</span><strong>Your wallet only</strong></div>
              </div>
              <label className="confirm">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                <span>I understand this creates a real, irreversible Pump coin and spends SOL{hasInitialBuy ? ` plus up to ${initialBuyValue} ${symbolLabel(coin.symbol)} (and slippage)` : ""} from my connected wallet after I approve the transaction.</span>
              </label>
              {error && <p className="error" role="alert">{error}</p>}
              <button className="launch" type="button" disabled={!identityReady || !initialBuyReady || !connected || !image || !confirmed || busy} onClick={launch}>{actionLabel}</button>
              <p className="fineprint">VampPair never receives your private key. Your wallet approves the creation first, then a second transaction if you choose an initial buy.</p>
            </section>
          </section>
        )}

        {view === "launcher" && stage === "success" && result && (
          <div className="success" role="dialog" aria-modal="true" aria-labelledby="success-title">
            <div className="successCard">
              <span className="successMark">V</span>
              <p className="kicker">
                {result.status === "confirmed" ? "The bite landed" : result.status === "expired" ? "The bite missed" : "The bite is pending"}
              </p>
              <h2 id="success-title">
                {result.status === "confirmed" ? "Vamp launched." : result.status === "expired" ? "Launch expired." : "Checking Solana."}
              </h2>
              <p>
                {result.status === "confirmed"
                  ? `The new mint is live on Solana and paired against ${coin?.name}.${result.message ? ` ${result.message}` : ""}`
                  : result.message}
              </p>
              <code>{result.mint}</code>
              <div className="successActions">
                <a href={result.explorerUrl} target="_blank" rel="noreferrer">View transaction</a>
                {result.buyExplorerUrl && <a href={result.buyExplorerUrl} target="_blank" rel="noreferrer">View initial buy</a>}
                {result.status === "confirmed" && <a href={`https://pump.fun/coin/${result.mint}`} target="_blank" rel="noreferrer">Open on Pump</a>}
              </div>
              <button type="button" onClick={() => {
                if (result.status !== "expired") setView("portfolio");
                setStage("compose");
              }}>
                {result.status === "expired" ? "Build a fresh transaction" : "View My Vamps"}
              </button>
            </div>
          </div>
        )}
      </main>

      {view === "launcher" && coin && error && (
        <div className="failureToast" role="alert" aria-live="assertive">
          <div>
            <strong>Launch stopped</strong>
            <p>{error}</p>
          </div>
          <button type="button" aria-label="Dismiss launch error" onClick={() => setError("")}>×</button>
        </div>
      )}
    </>
  );
}
