"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
} from "@solana/wallet-standard-features";
import bs58 from "bs58";
import { VersionedTransaction } from "@solana/web3.js";

const MAINNET = "solana:mainnet";

type SupportedWallet = Wallet &
  StandardConnectFeature &
  SolanaSignAndSendTransactionFeature;

type WalletContextValue = {
  account: WalletAccount | null;
  connected: boolean;
  openPicker: () => void;
  sendTransaction: (transaction: VersionedTransaction) => Promise<string>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

function supportsMainnet(wallet: Wallet): wallet is SupportedWallet {
  return (
    wallet.chains.includes(MAINNET) &&
    StandardConnect in wallet.features &&
    SolanaSignAndSendTransaction in wallet.features
  );
}

function short(value: string) {
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

export function VampWalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<readonly SupportedWallet[]>([]);
  const [wallet, setWallet] = useState<SupportedWallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const changeSubscription = useRef<(() => void) | null>(null);

  useEffect(() => {
    const registry = getWallets();
    const refresh = () => setWallets(registry.get().filter(supportsMainnet));
    refresh();
    const unregisterAdd = registry.on("register", refresh);
    const unregisterRemove = registry.on("unregister", refresh);
    return () => {
      unregisterAdd();
      unregisterRemove();
      changeSubscription.current?.();
    };
  }, []);

  const connect = useCallback(async (nextWallet: SupportedWallet) => {
    setError("");
    try {
      const feature = nextWallet.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect];
      const output = await feature.connect();
      const nextAccount = output.accounts.find((item) => item.chains.includes(MAINNET));
      if (!nextAccount) throw new Error("This wallet did not provide a Solana mainnet account.");

      changeSubscription.current?.();
      const eventFeature = nextWallet.features[StandardEvents] as
        | StandardEventsFeature[typeof StandardEvents]
        | undefined;
      changeSubscription.current = eventFeature?.on("change", (change) => {
        if (!change.accounts) return;
        const changed = change.accounts.find((item) => item.chains.includes(MAINNET)) || null;
        setAccount(changed);
        if (!changed) setWallet(null);
      }) || null;

      setWallet(nextWallet);
      setAccount(nextAccount);
      setOpen(false);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Wallet connection failed.");
    }
  }, []);

  const disconnect = useCallback(async () => {
    changeSubscription.current?.();
    changeSubscription.current = null;
    if (wallet && StandardDisconnect in wallet.features) {
      const feature = wallet.features[StandardDisconnect] as StandardDisconnectFeature[typeof StandardDisconnect];
      await feature.disconnect().catch(() => undefined);
    }
    setWallet(null);
    setAccount(null);
    setOpen(false);
  }, [wallet]);

  const sendTransaction = useCallback(
    async (transaction: VersionedTransaction) => {
      if (!wallet || !account) throw new Error("Connect a wallet before launching.");
      const feature = wallet.features[SolanaSignAndSendTransaction] as SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction];
      if (!feature.supportedTransactionVersions.includes(0)) {
        throw new Error("This wallet cannot send the transaction version Pump requires.");
      }
      const [output] = await feature.signAndSendTransaction({
        account,
        transaction: transaction.serialize(),
        chain: MAINNET,
        options: {
          preflightCommitment: "confirmed",
          commitment: "confirmed",
          skipPreflight: false,
          maxRetries: 8,
        },
      });
      return bs58.encode(output.signature);
    },
    [account, wallet],
  );

  const value = useMemo<WalletContextValue>(
    () => ({ account, connected: Boolean(account), openPicker: () => setOpen(true), sendTransaction }),
    [account, sendTransaction],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {open && (
        <div className="walletOverlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="walletDialog" role="dialog" aria-modal="true" aria-labelledby="wallet-title">
            <button className="walletClose" type="button" aria-label="Close wallet picker" onClick={() => setOpen(false)}>×</button>
            <p className="kicker">Sign with your own keys</p>
            <h2 id="wallet-title">Choose a Solana wallet</h2>
            {wallets.length ? (
              <div className="walletList">
                {wallets.map((item) => (
                  <button key={item.name} type="button" onClick={() => connect(item)}>
                    <img src={item.icon} alt="" />
                    <span>{item.name}<small>Detected · Solana mainnet</small></span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="walletEmpty">No compatible wallet was detected. Install Phantom, Solflare, Backpack, or another Wallet Standard wallet, then reload this page.</p>
            )}
            {account && <button className="disconnect" type="button" onClick={disconnect}>Disconnect {short(account.address)}</button>}
            {error && <p className="error" role="alert">{error}</p>}
            <p className="walletSafety">VampPair can request a transaction signature. It can never read or export your private key.</p>
          </section>
        </div>
      )}
    </WalletContext.Provider>
  );
}

export function useVampWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useVampWallet must be used inside VampWalletProvider.");
  return value;
}

export function WalletButton() {
  const { account, openPicker } = useVampWallet();
  return (
    <button className="walletButton" type="button" onClick={openPicker}>
      {account ? short(account.address) : "Connect wallet"}
    </button>
  );
}
