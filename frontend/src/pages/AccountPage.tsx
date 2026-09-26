import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useBalance, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { api, getToken, setToken } from "../lib/api";
import { useAppConfig, useMe, useWalletConnect } from "../lib/hooks";
import { chainLabel, friendlyError, mon, shortAddress } from "../lib/format";
import { ArrowUpRightIcon, CheckIcon, InfoIcon, MailIcon, UserIcon, WalletIcon } from "../components/Icons";

type Step = "email" | "code" | "nickname" | "wallet" | "done";
const ORDER: Step[] = ["email", "code", "nickname", "wallet"];
const RESEND_SECONDS = 45;

function StepList({ current, details }: { current: Step; details: Record<string, string | undefined> }) {
  const idx = current === "done" ? 4 : ORDER.indexOf(current);
  const items: [Step, string][] = [["email", "Email"], ["code", "Verify code"], ["nickname", "Nickname"], ["wallet", "Wallet"]];
  return (
    <ol className="mt-10 space-y-3">
      {items.map(([s, label], i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s} className={`flex items-center gap-4 rounded-2xl px-4 py-3 ${active ? "border border-line bg-raised" : ""}`}>
            <span
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full font-display text-sm font-bold ${
                done ? "bg-mint-soft text-mint" : active ? "border-2 border-sun text-sun" : "border border-line text-muted"
              }`}
            >
              {done ? <CheckIcon className="h-5 w-5" /> : i + 1}
            </span>
            <span className="leading-tight">
              <span className={`block font-bold ${done || active ? "text-cream" : "text-cream/70"}`}>{label}</span>
              <span className={`block text-sm ${done && s === "email" ? "font-mono text-[13px] text-muted" : "text-muted"}`}>
                {done ? details[s] ?? "Done" : active ? "In progress" : "Up next"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
  useEffect(() => refs.current[0]?.focus(), []);
  function set(i: number, d: string) {
    const next = digits.map((x, k) => (k === i ? d : x)).join("").slice(0, 6);
    onChange(next);
  }
  return (
    <div className="flex gap-2 sm:gap-3" onPaste={(e) => {
      const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
      if (text) { e.preventDefault(); onChange(text); refs.current[Math.min(text.length, 5)]?.focus(); }
    }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          maxLength={1}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(-1);
            set(i, v);
            if (v && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
          className="h-14 w-11 rounded-xl border border-line bg-ink text-center font-mono text-2xl text-cream focus:border-violet-light focus:outline-none focus:ring-2 focus:ring-violet/40 sm:h-[72px] sm:w-[60px] sm:text-3xl"
        />
      ))}
    </div>
  );
}

function PanelHead({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <>
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-soft text-violet-light">{icon}</span>
      <h2 className="font-display mt-7 text-[32px] font-extrabold leading-tight sm:text-[38px]">{title}</h2>
      {children && <p className="mt-3 text-[16px] text-cream/75">{children}</p>}
    </>
  );
}

function WalletRow({ n, title, sub, state, action, error }: {
  n: number; title: string; sub: React.ReactNode; state: "done" | "active" | "todo"; action?: React.ReactNode; error?: string | null;
}) {
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${state === "active" ? "border-sun/70 bg-raised" : "border-line"}`}>
      <div className="flex items-center gap-4">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-sm font-bold ${
          state === "done" ? "bg-mint-soft text-mint" : state === "active" ? "border-2 border-sun text-sun" : "border border-line text-muted"
        }`}>
          {state === "done" ? <CheckIcon className="h-5 w-5" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-bold ${state === "todo" ? "text-cream/60" : ""}`}>{title}</p>
          <p className="truncate text-sm text-muted">{sub}</p>
        </div>
        {action}
      </div>
      {error && <p className="mt-3 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{error}</p>}
    </div>
  );
}

export function AccountPage() {
  const cfg = useAppConfig();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me, isLoading: meLoading, refetch } = useMe();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletErr, setWalletErr] = useState<{ row: number; msg: string } | null>(null);
  const [tick, setTick] = useState(0);

  const { address, isConnected, chainId } = useAccount();
  const wallet = useWalletConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { data: balance } = useBalance({ address, chainId: cfg.chainId, query: { enabled: !!address, refetchInterval: 10_000 } });

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const signedIn = !!getToken() && !!me;
  const step: Step = !signedIn ? (codeSent ? "code" : "email") : !me!.nickname ? "nickname" : !me!.walletAddress ? "wallet" : "done";
  const resendIn = Math.max(0, RESEND_SECONDS - Math.floor((Date.now() - sentAt) / 1000));
  void tick;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  const sendCode = () =>
    run("send", async () => {
      const res = await api<{ devCode?: string }>("/auth/register", { body: { email } });
      setDevCode(res.devCode ?? null);
      setCode("");
      setCodeSent(true);
      setSentAt(Date.now());
    });

  const verify = () =>
    run("verify", async () => {
      const { token } = await api<{ token: string }>("/auth/verify", { body: { email, code } });
      setToken(token);
      await queryClient.invalidateQueries();
      await refetch();
    });

  const saveNickname = () =>
    run("nick", async () => {
      await api("/auth/nickname", { body: { nickname } });
      await refetch();
    });

  async function walletStep(row: number, fn: () => Promise<void>) {
    setBusy(`w${row}`);
    setWalletErr(null);
    try {
      await fn();
    } catch (e) {
      setWalletErr({ row, msg: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  const connect = () => walletStep(1, async () => { await wallet.connect(); });
  const change = () => walletStep(1, async () => { await disconnectAsync(); await wallet.connect(); });
  const switchNet = () => walletStep(2, async () => { await switchChainAsync({ chainId: cfg.chainId }); });
  const sign = () =>
    walletStep(3, async () => {
      const { message } = await api<{ message: string }>("/auth/wallet/nonce", { body: {} });
      const signature = await signMessageAsync({ message });
      await api("/auth/wallet/link", { body: { address, signature } });
      await queryClient.invalidateQueries();
      await refetch();
    });

  const signOut = async () => {
    setToken(null);
    await disconnectAsync().catch(() => {});
    queryClient.clear();
    setCodeSent(false);
    setCode("");
    setEmail("");
    navigate("/account");
  };

  if (getToken() && meLoading) return <p className="text-muted">Loading your player…</p>;

  const onRightChain = isConnected && chainId === cfg.chainId;
  const row1 = isConnected ? "done" : "active";
  const row2 = !isConnected ? "todo" : onRightChain ? "done" : "active";
  const row3 = !isConnected || !onRightChain ? "todo" : "active";

  return (
    <div className="grid gap-10 lg:grid-cols-[400px_1fr] lg:gap-16">
      <div>
        <p className="caps">Player setup</p>
        <h1 className="font-display mt-3 text-[44px] font-extrabold leading-[0.98] sm:text-[52px]">{step === "done" ? "Your player" : "Create your player"}</h1>
        <p className="mt-4 text-[16px] text-cream/75">Four quick steps. Your email stays private: other players only ever see your nickname.</p>
        <StepList
          current={step}
          details={{ email: me?.email ?? email, code: "Verified", nickname: me?.nickname ?? undefined, wallet: shortAddress(me?.walletAddress) }}
        />
      </div>

      <div className="panel p-7 sm:p-11">
        {step === "email" && (
          <form onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
            <PanelHead icon={<MailIcon className="h-6 w-6" />} title="What's your email?">
              We'll send you a 6-digit code. Returning players sign in the same way.
            </PanelHead>
            <label className="field-label mt-8" htmlFor="email">Email address</label>
            <input id="email" className="input text-lg" type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <p className="mt-3 text-sm text-rose">{error}</p>}
            <button className="btn-violet mt-6 min-w-[200px] py-3.5" disabled={!!busy || !email}>{busy ? "Sending…" : "Send code"}</button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <PanelHead icon={<MailIcon className="h-6 w-6" />} title="Check your inbox">
              We sent a 6-digit code to <b className="text-cream">{email}</b>. It expires in 15 minutes.
            </PanelHead>
            <p className="field-label mt-8">Verification code</p>
            <CodeInput value={code} onChange={setCode} />
            {error && <p className="mt-3 text-sm text-rose">{error}</p>}
            <div className="mt-7 flex flex-wrap items-center gap-5">
              <button className="btn-violet min-w-[200px] py-3.5" disabled={!!busy || code.length !== 6}>{busy === "verify" ? "Checking…" : "Verify"}</button>
              <span className="text-muted">
                Didn't get it?{" "}
                {resendIn > 0 ? (
                  <span className="font-bold text-cream/80 underline decoration-muted">Resend in 0:{String(resendIn).padStart(2, "0")}</span>
                ) : (
                  <button type="button" className="font-bold text-cream underline" onClick={sendCode} disabled={!!busy}>Resend code</button>
                )}
                {" · "}
                <button type="button" className="underline" onClick={() => { setCodeSent(false); setError(null); }}>Change email</button>
              </span>
            </div>
            <div className="mt-7 flex gap-3 rounded-2xl border border-dashed border-line bg-raised/40 p-4 text-sm text-cream/75">
              <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-sun" />
              {devCode ? (
                <span>Running locally without an email server? Your code is <b className="font-mono text-base tracking-widest text-sun">{devCode}</b> (also printed in the backend log).</span>
              ) : (
                <span>Can't find it? Check your spam folder, or resend in a moment.</span>
              )}
            </div>
          </form>
        )}

        {step === "nickname" && (
          <form onSubmit={(e) => { e.preventDefault(); saveNickname(); }}>
            <PanelHead icon={<UserIcon className="h-6 w-6" />} title="Pick a nickname">
              This is the name other players see on the lobby and leaderboard.
            </PanelHead>
            <label className="field-label mt-8" htmlFor="nick">Nickname</label>
            <input id="nick" className="input text-lg" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" placeholder="neo_plays" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            <p className="help">3–20 characters: letters, numbers and underscores.</p>
            {error && <p className="mt-3 text-sm text-rose">{error}</p>}
            <button className="btn-violet mt-6 min-w-[200px] py-3.5" disabled={!!busy || nickname.length < 3}>{busy ? "Saving…" : "Continue"}</button>
          </form>
        )}

        {step === "wallet" && (
          <div>
            <PanelHead icon={<WalletIcon className="h-6 w-6" />} title="Link your wallet">
              Prizes are paid to this wallet. Signing proves it's yours. It's free and never moves funds.
            </PanelHead>
            <div className="mt-8 space-y-3">
              <WalletRow
                n={1}
                title={`Connect ${wallet.walletName === "MetaMask" ? "MetaMask" : "your wallet"}`}
                sub={isConnected ? <span className="font-mono">{shortAddress(address)}</span> : wallet.available ? "Opens MetaMask to pick an account." : "MetaMask isn't installed in this browser."}
                state={row1}
                error={walletErr?.row === 1 ? walletErr.msg : null}
                action={
                  isConnected ? (
                    <button className="btn-ghost px-4 py-2 text-sm" onClick={change} disabled={!!busy}>Change</button>
                  ) : wallet.available ? (
                    <button className="btn-violet px-5 py-2.5" onClick={connect} disabled={!!busy}>{busy === "w1" ? "Check MetaMask…" : "Connect"}</button>
                  ) : (
                    <a className="btn-sun px-4 py-2.5 text-sm" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install MetaMask</a>
                  )
                }
              />
              <WalletRow
                n={2}
                title={`Switch to ${cfg.chainName}`}
                sub={!isConnected ? "Up next" : onRightChain ? `Connected to ${cfg.chainName}.` : `MetaMask is on ${chainLabel(chainId)}.`}
                state={row2}
                error={walletErr?.row === 2 ? walletErr.msg : null}
                action={row2 === "active" && <button className="btn-sun px-5 py-2.5" onClick={switchNet} disabled={!!busy}>{busy === "w2" ? "Check MetaMask…" : "Switch network"}</button>}
              />
              <WalletRow
                n={3}
                title="Sign to link"
                sub="One signature, no gas."
                state={row3}
                error={walletErr?.row === 3 ? walletErr.msg : null}
                action={<button className={row3 === "active" ? "btn-violet px-5 py-2.5" : "btn-ghost px-5 py-2.5 opacity-50"} onClick={sign} disabled={row3 !== "active" || !!busy}>{busy === "w3" ? "Check MetaMask…" : "Sign message"}</button>}
              />
            </div>

            {isConnected && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#2A2221] p-5">
                <div>
                  <p className="font-bold">Wallet balance: <span className="font-mono">{balance ? mon(balance.value) : "—"} MON</span></p>
                  <p className="text-sm text-cream/70">
                    {cfg.chainId === 31337
                      ? "Local test chain: import the funded test account printed by start-local.sh into MetaMask."
                      : "You'll need a little MON to pay gas when you join a game."}
                  </p>
                </div>
                {cfg.faucetUrl && (
                  <a href={cfg.faucetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-bold text-sun hover:underline">
                    Get test MON <ArrowUpRightIcon className="h-4 w-4" />
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {step === "done" && me && (
          <div>
            <PanelHead icon={<CheckIcon className="h-6 w-6" />} title="You're all set">
              Join a game from the Games tab. Rewards are paid to your linked wallet.
            </PanelHead>
            <dl className="mt-8 divide-y divide-line rounded-2xl border border-line">
              {[
                ["Email", me.email],
                ["Nickname", me.nickname],
                ["Wallet", me.walletAddress]
              ].map(([k, v]) => (
                <div key={k} className="flex flex-wrap justify-between gap-2 px-5 py-4">
                  <dt className="text-muted">{k}</dt>
                  <dd className={`break-all ${k === "Wallet" ? "font-mono text-sm" : "font-bold"}`}>{v}</dd>
                </div>
              ))}
            </dl>
            {isConnected && address && address.toLowerCase() !== me.walletAddress!.toLowerCase() && (
              <p className="mt-4 rounded-xl bg-sun-soft px-4 py-3 text-sm text-sun">
                MetaMask is on {shortAddress(address)}. Switch to {shortAddress(me.walletAddress)} in MetaMask to play and claim.
              </p>
            )}
            <div className="mt-7 flex flex-wrap gap-3">
              <button className="btn-violet py-3.5" onClick={() => navigate("/")}>Browse games</button>
              <button className="btn-ghost py-3.5" onClick={signOut}>Sign out</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
