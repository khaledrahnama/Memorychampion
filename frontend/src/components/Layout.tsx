import { Link, NavLink, Outlet } from "react-router-dom";
import { useAccount, useBalance, useSwitchChain } from "wagmi";
import { getToken } from "../lib/api";
import { useAppConfig, useMe } from "../lib/hooks";
import { mon, shortAddress } from "../lib/format";
import { Avatar, LogoMark } from "./Brand";

function NetworkPill() {
  const cfg = useAppConfig();
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const wrong = isConnected && chainId !== cfg.chainId;
  if (wrong) {
    return (
      <button
        onClick={() => switchChain({ chainId: cfg.chainId })}
        disabled={isPending}
        className="hidden items-center gap-2 rounded-full border border-sun/50 bg-sun-soft px-4 py-2 text-sm font-bold text-sun md:inline-flex"
        title="Your wallet is on a different network"
      >
        <span className="h-2 w-2 rounded-full bg-sun" /> {isPending ? "Switching…" : `Switch to ${cfg.chainName}`}
      </button>
    );
  }
  return (
    <span className="hidden items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-bold text-cream/90 md:inline-flex">
      <span className="h-2 w-2 rounded-full bg-mint" /> {cfg.chainName}
    </span>
  );
}

function PlayerChip() {
  const cfg = useAppConfig();
  const { data: me } = useMe();
  const { address } = useAccount();
  const wallet = (me?.walletAddress ?? address) as `0x${string}` | undefined;
  const { data: balance } = useBalance({ address: wallet, chainId: cfg.chainId, query: { enabled: !!wallet, refetchInterval: 15_000 } });

  if (!getToken() || !me) {
    return (
      <Link to="/account" className="rounded-xl border border-line px-4 py-2 text-sm font-bold hover:bg-raised">
        Sign in
      </Link>
    );
  }
  const claimable = BigInt(me.claimableWei);
  return (
    <Link to="/account" className="flex items-center gap-3 rounded-2xl border border-line bg-panel/80 py-1.5 pl-1.5 pr-4 hover:border-violet/60">
      <Avatar name={me.nickname} />
      <span className="hidden flex-col leading-tight sm:flex">
        <span className="text-sm font-bold">{me.nickname ?? "set nickname"}</span>
        <span className="font-mono text-[11px] text-muted">{me.walletAddress ? shortAddress(me.walletAddress) : "no wallet"}</span>
      </span>
      <span className="hidden h-8 w-px bg-line md:block" />
      <span className="hidden flex-col leading-tight md:flex">
        <span className="caps !text-[10px]">Balance</span>
        <span className="font-mono text-sm">{balance ? `${mon(balance.value)} MON` : "—"}</span>
      </span>
      <span className="hidden h-8 w-px bg-line lg:block" />
      <span className="hidden flex-col leading-tight lg:flex">
        <span className="caps !text-[10px]">{claimable > 0n ? "To claim" : "Won"}</span>
        <span className={`font-mono text-sm ${claimable > 0n ? "text-mint" : "text-sun"}`}>{mon(claimable > 0n ? claimable : me.totalWonWei)} MON</span>
      </span>
    </Link>
  );
}

export function Header() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `rounded-xl px-4 py-2.5 text-[15px] font-bold transition ${isActive ? "bg-raised text-cream" : "text-muted hover:text-cream"}`;
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1260px] items-center gap-4 px-5 py-3.5 sm:px-8">
        <Link to="/" className="flex items-center gap-3">
          <LogoMark />
          <span className="hidden flex-col leading-none sm:flex">
            <span className="font-display text-[19px] font-extrabold">Memory Challenge</span>
            <span className="mt-1 text-[10px] font-extrabold tracking-[0.2em] text-muted">ON MONAD</span>
          </span>
        </Link>
        <nav className="ml-2 flex gap-1 sm:ml-6">
          <NavLink className={tab} to="/" end>Games</NavLink>
          <NavLink className={tab} to="/host">Host</NavLink>
          <NavLink className={tab} to="/account">Account</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <NetworkPill />
          <PlayerChip />
        </div>
      </div>
    </header>
  );
}

export function Layout() {
  const cfg = useAppConfig();
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-[1260px] flex-1 px-5 py-8 sm:px-8 sm:py-10">
        <Outlet />
      </main>
      <footer className="px-5 py-6 text-center text-xs text-muted">
        Prize pools and payouts are held by a smart contract on {cfg.chainName}
        {cfg.contractAddress && cfg.explorerUrl && (
          <>
            {" · "}
            <a className="underline hover:text-cream" href={`${cfg.explorerUrl}/address/${cfg.contractAddress}`} target="_blank" rel="noreferrer">view contract</a>
          </>
        )}
      </footer>
    </div>
  );
}
