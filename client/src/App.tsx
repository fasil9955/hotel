import { useEffect, useState, type ReactNode } from "react";
import { getSession, type Session } from "./api";
import { publishLocal, watchChanges } from "./live";
import { Admin } from "./screens/Admin";
import { Attendance } from "./screens/Attendance";
import { Cashier } from "./screens/Cashier";
import { Day } from "./screens/Day";
import { Expenses } from "./screens/Expenses";
import { Lock } from "./screens/Lock";
import { Menu } from "./screens/Menu";
import { Orders } from "./screens/Orders";
import { Setup } from "./screens/Setup";

type Screen = "orders" | "cashier" | "menu" | "day" | "expenses" | "attendance" | "setup";

function isCashierScreen(): boolean {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function PhoneShell({ children }: { children: ReactNode }) {
  const [landscape, setLandscape] = useState(() => window.matchMedia("(orientation: landscape)").matches);
  const [hint, setHint] = useState("");

  useEffect(() => {
    const media = window.matchMedia("(orientation: landscape)");
    const update = () => setLandscape(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  async function toggle() {
    setHint("");
    const orientation = screen.orientation as ScreenOrientation & {
      lock: (orientation: "landscape" | "portrait") => Promise<void>;
    };
    try {
      if (!landscape) {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        await orientation.lock("landscape");
      } else {
        orientation.unlock();
        await orientation.lock("portrait");
      }
    } catch {
      setHint(landscape ? "Turn the phone upright." : "Turn the phone sideways.");
    }
  }

  return (
    <div className="phone-stage">
      {hint ? <p className="rotate-hint">{hint}</p> : null}
      <button type="button" className="rotate" aria-pressed={landscape} onClick={() => void toggle()}>
        {landscape ? "Upright" : "Rotate"}
      </button>
      {children}
    </div>
  );
}

function show(node: ReactNode): ReactNode {
  return isCashierScreen() ? node : <PhoneShell>{node}</PhoneShell>;
}

const SCREENS: Array<{ id: Screen; label: string }> = [
  { id: "orders", label: "Orders" },
  { id: "cashier", label: "Cashier" },
  { id: "menu", label: "Menu" },
  { id: "day", label: "Day" },
  { id: "expenses", label: "Expenses" },
  { id: "attendance", label: "Attendance" },
  { id: "setup", label: "Setup" },
];

export function App() {
  const [screen, setScreen] = useState<Screen>("orders");
  const [adminOpen, setAdminOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getSession()
      .then((next) => {
        if (active) setSession(next);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Could not reach the server.");
      });
    const onLock = () => setSession({ required: true, unlocked: false });
    window.addEventListener("hotel-locked", onLock);
    return () => {
      active = false;
      window.removeEventListener("hotel-locked", onLock);
    };
  }, []);

  useEffect(() => {
    if (!session || (session.required && !session.unlocked)) return;
    return watchChanges(publishLocal);
  }, [session]);

  if (error) {
    return show(
      <div className="page">
        {isCashierScreen() ? (
          <header className="top">
            <div>
              <p className="wordmark">Hotel</p>
              <p className="eyebrow">Billing</p>
            </div>
          </header>
        ) : null}
        <section className="panel">
          <h1>The server is not responding</h1>
          <p className="lede">{error}</p>
        </section>
      </div>,
    );
  }

  if (!session) {
    return show(
      <div className="page">
        {isCashierScreen() ? (
          <header className="top">
            <div>
              <p className="wordmark">Hotel</p>
              <p className="eyebrow">Billing</p>
            </div>
          </header>
        ) : null}
        <section className="panel">
          <p className="lede">Loading…</p>
        </section>
      </div>,
    );
  }

  if (session.required && !session.unlocked) {
    return show(<Lock onUnlock={() => setSession({ required: true, unlocked: true })} />);
  }

  if (!isCashierScreen()) {
    return show(
      <div className="page">
        <Orders tablet />
      </div>,
    );
  }

  if (adminOpen) {
    return (
      <div className="page">
        <Admin onBack={() => setAdminOpen(false)} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <p className="wordmark">Hotel</p>
          <p className="eyebrow">Billing</p>
        </div>
        <nav className="nav">
          {SCREENS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={screen === item.id}
              onClick={() => setScreen(item.id)}
            >
              {item.label}
            </button>
          ))}
          <button type="button" onClick={() => setAdminOpen(true)}>
            Admin
          </button>
        </nav>
      </header>
      {screen === "orders" ? <Orders /> : null}
      {screen === "cashier" ? <Cashier /> : null}
      {screen === "menu" ? <Menu /> : null}
      {screen === "day" ? <Day /> : null}
      {screen === "expenses" ? <Expenses /> : null}
      {screen === "attendance" ? <Attendance /> : null}
      {screen === "setup" ? <Setup /> : null}
    </div>
  );
}
