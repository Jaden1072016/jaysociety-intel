"use client";
import { useEffect, useState } from "react";

function urlB64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushControls({ publicKey, devices }: { publicKey: string; devices: number }) {
  const [state, setState] = useState<"loading" | "unsupported" | "off" | "on" | "denied" | "ios-install">("loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState(ios && !standalone ? "ios-install" : "unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    try {
      if (!publicKey) return setMsg("Push isn't configured on the server yet (VAPID keys).");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
      if (!res.ok) throw new Error(await res.text());
      setState("on");
      setMsg("This device will get notifications.");
    } catch (e) {
      setMsg(`Couldn't enable: ${(e as Error).message}`);
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
  }

  return (
    <div className="stack">
      <div className="row between">
        <span>This device: {{ loading: "checking…", unsupported: "push not supported", off: "off", on: "on", denied: "blocked in browser settings", "ios-install": "add to Home Screen first" }[state]}</span>
        {state === "off" && <button className="primary" onClick={enable}>Enable push</button>}
        {state === "on" && <button className="ghost" onClick={disable}>Turn off here</button>}
      </div>
      {state === "ios-install" && <p className="notice">On iPhone, tap Share, then Add to Home Screen, and open the app from there to enable notifications.</p>}
      <span className="faint" style={{ fontSize: "0.78rem" }}>{devices} device(s) subscribed{msg ? ` · ${msg}` : ""}</span>
    </div>
  );
}
