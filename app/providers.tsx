"use client";

import { VampWalletProvider } from "./wallet";

export function Providers({ children }: { children: React.ReactNode }) {
  return <VampWalletProvider>{children}</VampWalletProvider>;
}
