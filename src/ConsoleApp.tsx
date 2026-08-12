"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClientId } from "@/lib/client-id";
import type {
  ChannelDefinition,
  ConsoleSnapshot,
  FixtureMode,
  FixtureProfile,
  PatchedFixture,
} from "@/lib/console-types";

type View = "universe" | "presets" | "guide";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed.");
  return data as T;
}

function modeFor(profiles: FixtureProfile[], fixture: PatchedFixture) {
  return profiles
    .find((profile) => profile.id === fixture.profileId)
    ?.modes.find((mode) => mode.id === fixture.modeId);
}

function displayValue(channel: ChannelDefinition, value: number) {
  if (channel.displayMin === undefined || channel.displayMax === undefined) return `${value}`;
  const scaled = Math.round(channel.displayMin + (value / 255) * (channel.displayMax - channel.displayMin));
  return `${scaled}${channel.unit ?? ""}`;
}

function clampDmxValue(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function fixtureRange(profiles: FixtureProfile[], fixture: PatchedFixture) {
  const mode = modeFor(profiles, fixture);
  return `${fixture.address}–${fixture.address + (mode?.footprint ?? 1) - 1}`;
}

function findNextAddress(profiles: FixtureProfile[], fixtures: PatchedFixture[]) {
  return fixtures.reduce((last, fixture) => {
    const footprint = modeFor(profiles, fixture)?.footprint ?? 1;
    return Math.max(last, fixture.address + footprint);
  }, 1);
}

function countUsedChannels(profiles: FixtureProfile[], fixtures: PatchedFixture[]) {
  const occupied = new Set<number>();
  for (const fixture of fixtures) {
    const footprint = modeFor(profiles, fixture)?.footprint ?? 1;
    for (let offset = 0; offset < footprint; offset += 1) {
      const channel = fixture.address + offset;
      if (channel >= 1 && channel <= 512) occupied.add(channel);
    }
  }
  return occupied.size;
}

export function ConsoleApp() {
  const [view, setView] = useState<View>("universe");
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(null);
  const [error, setError] = useState("");
  const [presetName, setPresetName] = useState("");
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(0);
  const [origin, setOrigin] = useState("");
  const [networkUrls, setNetworkUrls] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const next = await api<ConsoleSnapshot & { ok: boolean }>("/api/console/state");
      setSnapshot(next);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }, []);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      setOrigin(window.location.origin);
      void refresh();
      void api<{ addresses: string[] }>("/api/console/network")
        .then((result) => setNetworkUrls(result.addresses))
        .catch(() => setNetworkUrls([]));
    }, 0);
    const poll = window.setInterval(refresh, 900);
    const clock = window.setInterval(() => setNow(Date.now()), 100);
    return () => {
      window.clearTimeout(initialize);
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [refresh]);

  const updatePatch = async (fixtures: PatchedFixture[]) => {
    if (!snapshot) return;
    setSnapshot({ ...snapshot, fixtures });
    setSaving(true);
    try {
      const next = await api<ConsoleSnapshot & { ok: boolean }>("/api/console/fixtures", {
        method: "POST",
        body: JSON.stringify({ fixtures }),
      });
      setSnapshot(next);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const addFixture = (profile: FixtureProfile) => {
    if (!snapshot || !profile.dmxCapable || profile.modes.length === 0) return;
    const nextNumber = snapshot.fixtures.filter((fixture) => fixture.profileId === profile.id).length + 1;
    const fixture: PatchedFixture = {
      id: createClientId(),
      name: `${profile.model} ${nextNumber}`,
      profileId: profile.id,
      modeId: profile.modes[0].id,
      address: findNextAddress(snapshot.profiles, snapshot.fixtures),
    };
    void updatePatch([...snapshot.fixtures, fixture]);
  };

  const changeFixture = (id: string, update: Partial<PatchedFixture>) => {
    if (!snapshot) return;
    void updatePatch(snapshot.fixtures.map((fixture) => (fixture.id === id ? { ...fixture, ...update } : fixture)));
  };

  const setChannel = (channel: number, value: number) => {
    if (!snapshot) return;
    const liveValues = [...snapshot.liveValues];
    liveValues[channel - 1] = value;
    setSnapshot({ ...snapshot, liveValues, transition: { active: false } });
    void api("/api/console/live", {
      method: "POST",
      body: JSON.stringify({ values: { [channel]: value } }),
    }).catch((requestError) => setError(String(requestError)));
  };

  const capturePreset = async () => {
    setSaving(true);
    try {
      await api("/api/console/presets", {
        method: "POST",
        body: JSON.stringify({ name: presetName }),
      });
      setPresetName("");
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSaving(false);
    }
  };

  const recallPreset = async (presetId: string) => {
    if (!snapshot) return;
    try {
      const next = await api<ConsoleSnapshot & { ok: boolean }>(`/api/console/presets/${presetId}/recall`, {
        method: "POST",
        body: JSON.stringify({ transitionMs: snapshot.transitionMs }),
      });
      setSnapshot(next);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  };

  const deletePreset = async (presetId: string) => {
    try {
      const next = await api<ConsoleSnapshot & { ok: boolean }>(`/api/console/presets/${presetId}`, {
        method: "DELETE",
      });
      setSnapshot(next);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  };

  const setTransition = async (seconds: number) => {
    if (!snapshot) return;
    const transitionMs = Math.max(0, seconds * 1000);
    setSnapshot({ ...snapshot, transitionMs });
    try {
      await api("/api/console/transition", {
        method: "POST",
        body: JSON.stringify({ transitionMs }),
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  };

  const blackout = () => {
    if (!snapshot) return;
    const values = Object.fromEntries(Array.from({ length: 512 }, (_, index) => [index + 1, 0]));
    setSnapshot({ ...snapshot, liveValues: Array.from({ length: 512 }, () => 0) });
    void api("/api/console/live", { method: "POST", body: JSON.stringify({ values }) });
  };

  const importBackup = async (file: File) => {
    if (!window.confirm("Import this backup and replace the current patch, presets, live values, and transition time?")) return;
    setSaving(true);
    try {
      const backup = JSON.parse(await file.text());
      const next = await api<ConsoleSnapshot & { ok: boolean }>("/api/console/import", {
        method: "POST",
        body: JSON.stringify(backup),
      });
      setSnapshot(next);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSaving(false);
    }
  };

  const progress = useMemo(() => {
    if (!snapshot?.transition.active || !snapshot.transition.startedAt || !snapshot.transition.durationMs) return 0;
    return Math.min(100, ((now - snapshot.transition.startedAt) / snapshot.transition.durationMs) * 100);
  }, [now, snapshot?.transition]);

  if (!snapshot) {
    return (
      <main className="loading-screen">
        <div className="loading-mark">01</div>
        <p>{error || "Starting the console…"}</p>
      </main>
    );
  }

  const dmxClass = `device-pill device-${snapshot.dmx.state}`;

  return (
    <main className="console-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("universe")} aria-label="Open DMX Console home">
          <span className="brand-mark">U1</span>
          <span><strong>OPEN DMX</strong><small>OUTPUT CONSOLE</small></span>
        </button>
        <nav className="view-tabs" aria-label="Console sections">
          <button className={view === "universe" ? "active" : ""} aria-current={view === "universe" ? "page" : undefined} onClick={() => setView("universe")}>
            <span>01</span> Patch
          </button>
          <button className={view === "presets" ? "active" : ""} aria-current={view === "presets" ? "page" : undefined} onClick={() => setView("presets")}>
            <span>02</span> Live / presets
          </button>
          <button className={view === "guide" ? "active" : ""} aria-current={view === "guide" ? "page" : undefined} onClick={() => setView("guide")}>
            <span>03</span> Companion
          </button>
        </nav>
        <div className="topbar-actions">
          <button
            className={dmxClass}
            aria-label={`DMX ${snapshot.dmx.state}: ${snapshot.dmx.port ?? "Open USB"}. Reconnect.`}
            onClick={() => void api("/api/console/dmx/reconnect", { method: "POST" }).then(refresh)}
          >
            <i />
            <span>{snapshot.dmx.state === "connected" ? "DMX live" : snapshot.dmx.state}</span>
            <small>{snapshot.dmx.port ?? "Open USB"}</small>
          </button>
          <button className="blackout" onClick={blackout}>All out</button>
        </div>
      </header>

      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}

      {view === "universe" ? (
        <UniverseEditor
          snapshot={snapshot}
          saving={saving}
          addFixture={addFixture}
          changeFixture={changeFixture}
          removeFixture={(id) => void updatePatch(snapshot.fixtures.filter((fixture) => fixture.id !== id))}
        />
      ) : view === "presets" ? (
        <PresetManager
          snapshot={snapshot}
          presetName={presetName}
          setPresetName={setPresetName}
          saving={saving}
          progress={progress}
          origin={origin}
          setChannel={setChannel}
          setTransition={setTransition}
          capturePreset={capturePreset}
          recallPreset={recallPreset}
          deletePreset={deletePreset}
        />
      ) : (
        <CompanionGuide snapshot={snapshot} origin={origin} networkUrls={networkUrls} saving={saving} importBackup={importBackup} />
      )}
      <footer>
        <span>Universe 1 · 512 channels</span>
        <span>{snapshot.fixtures.length} fixtures · {snapshot.presets.length} {snapshot.presets.length === 1 ? "preset" : "presets"}</span>
        <span>{snapshot.dmx.message}</span>
      </footer>
    </main>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const field = document.createElement("textarea");
      field.value = value;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return <button className="copy-button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>;
}

function CompanionGuide({
  snapshot,
  origin,
  networkUrls,
  saving,
  importBackup,
}: {
  snapshot: ConsoleSnapshot;
  origin: string;
  networkUrls: string[];
  saving: boolean;
  importBackup: (file: File) => Promise<void>;
}) {
  const baseUrl = networkUrls[0] ?? origin;
  const discoveryUrl = `${baseUrl}/api/companion/presets`;
  return (
    <section className="workspace guide-workspace">
      <div className="section-heading guide-heading">
        <div><span className="eyebrow">Network control</span><h1>Companion HTTP</h1></div>
        <div className="guide-status"><i className={snapshot.dmx.state === "connected" ? "online" : ""} /><span><strong>{snapshot.dmx.state === "connected" ? "DMX connected" : "HTTP server ready"}</strong><small>{baseUrl || "Detecting LAN address…"}</small></span></div>
      </div>

      <div className="signal-flow" aria-label="Companion control flow">
        <div><span>01</span><strong>Companion</strong><small>HTTP GET</small></div>
        <b>→</b>
        <div><span>02</span><strong>Console</strong><small>Recall + fade</small></div>
        <b>→</b>
        <div><span>03</span><strong>Open DMX USB</strong><small>512-channel output</small></div>
      </div>

      <div className="guide-grid">
        <section className="panel setup-steps">
          <div className="panel-title"><span>One-time setup</span><small>About 2 minutes</small></div>
          <ol>
            <li><span>1</span><div><h2>Install Generic HTTP Requests</h2><p>In Companion, open <strong>Modules</strong>, search for <strong>Generic HTTP Requests</strong>, choose the latest stable version, and install it.</p></div></li>
            <li><span>2</span><div><h2>Add the connection</h2><p>Open <strong>Connections</strong>, add Generic HTTP Requests, then paste this Base URL.</p><div className="copy-field"><code>{baseUrl || "http://COMPUTER-IP:3000"}</code><CopyButton value={baseUrl} /></div></div></li>
            <li><span>3</span><div><h2>Create a button action</h2><p>Select a Companion button, add an action from the Generic HTTP connection, and choose <strong>GET</strong>. Paste a preset URI from the list on this page.</p></div></li>
            <li><span>4</span><div><h2>Press to recall</h2><p>The response should be HTTP 200. The console fades from the live state to the preset using the chosen transition time.</p></div></li>
          </ol>
        </section>

        <aside className="guide-side">
          <section className="panel endpoint-panel">
            <div className="panel-title"><span>Preset discovery</span><small>GET</small></div>
            <p>Open this endpoint to see every saved preset and its recall path.</p>
            <div className="copy-field stacked"><code>{discoveryUrl}</code><CopyButton value={discoveryUrl} /></div>
            <a href="/api/companion/presets" target="_blank">View JSON response</a>
          </section>

          <section className="panel endpoint-panel preset-endpoints">
            <div className="panel-title"><span>Ready-to-use actions</span><small>{snapshot.presets.length} {snapshot.presets.length === 1 ? "preset" : "presets"}</small></div>
            {snapshot.presets.length === 0 ? <div className="guide-empty"><strong>No presets yet</strong><p>Capture a look in Preset Manager, then return here for its Companion URL.</p></div> : snapshot.presets.map((preset, index) => {
              const uri = `/api/companion/recall/${preset.id}?seconds=${snapshot.transitionMs / 1000}`;
              return <div className="guide-preset" key={preset.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{preset.name}</strong><code>{uri}</code></div><CopyButton value={uri} /></div>;
            })}
          </section>

          <section className="panel backup-panel">
            <div className="panel-title"><span>Console backup</span><small>JSON</small></div>
            <p>Move or archive the complete fixture patch, presets, live universe, and transition setting.</p>
            <div className="backup-actions">
              <a className="backup-button export" href="/api/console/export" download>Export everything</a>
              <label className={`backup-button import${saving ? " busy" : ""}`}>
                {saving ? "Importing…" : "Import backup"}
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={saving}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void importBackup(file);
                  }}
                />
              </label>
            </div>
            <small className="backup-warning">Import replaces the current console state after confirmation.</small>
          </section>

          <section className="panel endpoint-panel">
            <div className="panel-title"><span>Installed app</span><small>macOS + Windows</small></div>
            <p>The desktop build runs this server in the system tray. Use its tray menu to open the console, reveal the data folder, toggle <strong>Start at login</strong>, or quit and release the DMX interface.</p>
          </section>

          <section className="guide-tip"><strong>Transition override</strong><p>Use <code>?seconds=2.5</code> at the end of any recall URI. Leave it off to use the transition time currently set in Preset Manager.</p></section>
        </aside>
      </div>
    </section>
  );
}

function UniverseEditor({
  snapshot,
  saving,
  addFixture,
  changeFixture,
  removeFixture,
}: {
  snapshot: ConsoleSnapshot;
  saving: boolean;
  addFixture: (profile: FixtureProfile) => void;
  changeFixture: (id: string, update: Partial<PatchedFixture>) => void;
  removeFixture: (id: string) => void;
}) {
  const usedChannels = countUsedChannels(snapshot.profiles, snapshot.fixtures);
  return (
    <section className="workspace">
      <div className="section-heading">
        <div><span className="eyebrow">Universe 01</span><h1>Patch</h1></div>
        <div className="universe-meter"><strong>{usedChannels}</strong><span>/ 512 channels used</span><div><i style={{ width: `${(usedChannels / 512) * 100}%` }} /></div></div>
      </div>

      <div className="editor-grid">
        <section className="panel fixture-library">
          <div className="panel-title"><span>Fixture library</span><small>{snapshot.profiles.length} profiles</small></div>
          <div className="profile-list">
            {snapshot.profiles.map((profile) => (
              <article className={`profile-card ${!profile.dmxCapable ? "unsupported" : ""}`} key={profile.id}>
                <div className="profile-accent" style={{ background: profile.accent }} />
                <div className="profile-copy">
                  <small>{profile.manufacturer}</small>
                  <strong>{profile.model}</strong>
                  <span>{profile.dmxCapable ? `${profile.modes.length} DMX ${profile.modes.length === 1 ? "mode" : "modes"}` : "No wired DMX"}</span>
                  {!profile.dmxCapable && <p>{profile.warning}</p>}
                </div>
                <button disabled={!profile.dmxCapable} onClick={() => addFixture(profile)} aria-label={`Add ${profile.model}`}>
                  {profile.dmxCapable ? "+" : "—"}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="panel patch-panel">
          <div className="panel-title"><span>Patched fixtures</span><small>{saving ? "Saving…" : "Saved locally"}</small></div>
          {snapshot.fixtures.length === 0 ? (
            <div className="empty-state"><h2>No fixtures patched</h2><p>Choose a DMX fixture from the library.</p></div>
          ) : (
            <div className="patch-list">
              <div className="patch-head"><span>Custom name</span><span>Mode</span><span>Address</span><span>Range</span><span /></div>
              {snapshot.fixtures.map((fixture, index) => {
                const profile = snapshot.profiles.find((candidate) => candidate.id === fixture.profileId)!;
                return (
                  <div className="patch-row" key={fixture.id}>
                    <span className="fixture-number" style={{ borderColor: profile.accent }}>{String(index + 1).padStart(2, "0")}</span>
                    <label className="fixture-name">
                      <span className="name-label">Custom name</span>
                      <input
                        defaultValue={fixture.name}
                        maxLength={80}
                        placeholder={`${profile.model} ${index + 1}`}
                        onBlur={(event) => changeFixture(fixture.id, { name: event.target.value })}
                        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                        aria-label={`Custom name for ${profile.model}`}
                      />
                      <small>{profile.manufacturer} {profile.model} · saves when you leave the field</small>
                    </label>
                    <label><span className="mobile-label">Mode</span><select value={fixture.modeId} onChange={(event) => changeFixture(fixture.id, { modeId: event.target.value })}>{profile.modes.map((mode) => <option value={mode.id} key={mode.id}>{mode.name} ({mode.footprint}ch)</option>)}</select></label>
                    <label className="address-field"><span className="mobile-label">Address</span><input type="number" min="1" max="512" value={fixture.address} onChange={(event) => changeFixture(fixture.id, { address: Number(event.target.value) })} /></label>
                    <span className="range">{fixtureRange(snapshot.profiles, fixture)}</span>
                    <button className="remove" onClick={() => removeFixture(fixture.id)} aria-label={`Remove ${fixture.name}`}>×</button>
                  </div>
                );
              })}
            </div>
          )}
          <UniverseStrip snapshot={snapshot} />
          {snapshot.fixtures.length > 0 && <PatchChannelGrid snapshot={snapshot} />}
        </section>
      </div>
    </section>
  );
}

function UniverseStrip({ snapshot }: { snapshot: ConsoleSnapshot }) {
  return (
    <div className="universe-strip-wrap">
      <div className="strip-labels"><span>1</span><span>128</span><span>256</span><span>384</span><span>512</span></div>
      <div className="universe-strip">
        {snapshot.fixtures.map((fixture) => {
          const profile = snapshot.profiles.find((candidate) => candidate.id === fixture.profileId)!;
          const footprint = modeFor(snapshot.profiles, fixture)?.footprint ?? 1;
          return <i key={fixture.id} title={`${fixture.name}: ${fixtureRange(snapshot.profiles, fixture)}`} style={{ left: `${((fixture.address - 1) / 512) * 100}%`, width: `${Math.max((footprint / 512) * 100, 0.7)}%`, background: profile.accent }} />;
        })}
      </div>
    </div>
  );
}

function PatchChannelGrid({ snapshot }: { snapshot: ConsoleSnapshot }) {
  const assignmentCount = new Map<number, number>();

  for (const fixture of snapshot.fixtures) {
    const mode = modeFor(snapshot.profiles, fixture);
    for (const channel of mode?.channels ?? []) {
      const universeChannel = fixture.address + channel.offset - 1;
      if (universeChannel >= 1 && universeChannel <= 512) {
        assignmentCount.set(universeChannel, (assignmentCount.get(universeChannel) ?? 0) + 1);
      }
    }
  }

  return (
    <section className="patch-channel-map" aria-labelledby="patch-channel-map-title">
      <div className="channel-map-heading">
        <div>
          <span className="eyebrow">Channel map</span>
          <h2 id="patch-channel-map-title">Patched channels</h2>
        </div>
        <small>Grouped by fixture · live DMX values</small>
      </div>
      <div className="patch-channel-masonry">
        {snapshot.fixtures.map((fixture, fixtureIndex) => {
          const profile = snapshot.profiles.find((candidate) => candidate.id === fixture.profileId)!;
          const mode = modeFor(snapshot.profiles, fixture) as FixtureMode;
          const visibleChannels = mode.channels.filter(
            (channel) => fixture.address + channel.offset - 1 <= 512,
          );

          return (
            <article className="patch-channel-group" style={{ borderTopColor: profile.accent }} key={fixture.id}>
              <header>
                <span style={{ background: profile.accent }}>{String(fixtureIndex + 1).padStart(2, "0")}</span>
                <div><strong>{fixture.name}</strong><small>{profile.model} · {mode.name}</small></div>
                <b>{visibleChannels.length}/{mode.footprint} CH</b>
              </header>
              <div className="patch-channel-tiles">
                {visibleChannels.map((channel) => {
                  const universeChannel = fixture.address + channel.offset - 1;
                  const value = snapshot.liveValues[universeChannel - 1] ?? 0;
                  const shared = (assignmentCount.get(universeChannel) ?? 0) > 1;
                  return (
                    <div
                      className={`patch-channel-tile channel-tile-${channel.kind}${shared ? " shared" : ""}`}
                      key={channel.offset}
                      title={`${fixture.name} · ${channel.name} · DMX channel ${universeChannel}`}
                    >
                      <div className="channel-tile-top">
                        <span>CH {String(universeChannel).padStart(3, "0")}</span>
                        {shared && <em>Shared</em>}
                      </div>
                      <strong>{channel.name}</strong>
                      <small>{channel.shortName}</small>
                      <div className="channel-tile-value"><b>{value}</b><span>DMX</span></div>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PresetManager({
  snapshot,
  presetName,
  setPresetName,
  saving,
  progress,
  origin,
  setChannel,
  setTransition,
  capturePreset,
  recallPreset,
  deletePreset,
}: {
  snapshot: ConsoleSnapshot;
  presetName: string;
  setPresetName: (name: string) => void;
  saving: boolean;
  progress: number;
  origin: string;
  setChannel: (channel: number, value: number) => void;
  setTransition: (seconds: number) => void;
  capturePreset: () => void;
  recallPreset: (id: string) => void;
  deletePreset: (id: string) => void;
}) {
  return (
    <section className="workspace preset-workspace">
      <div className="section-heading compact">
        <div><span className="eyebrow">Universe 01 · output</span><h1>Live / presets</h1></div>
        <label className="time-control"><span>Transition</span><div><input type="number" min="0" max="3600" step="0.1" value={snapshot.transitionMs / 1000} onChange={(event) => void setTransition(Number(event.target.value))} /><b>sec</b></div></label>
      </div>

      {snapshot.transition.active && <div className="transition-banner"><span>Running <strong>{snapshot.transition.presetName}</strong></span><div><i style={{ width: `${progress}%` }} /></div><b>{Math.round(progress)}%</b></div>}

      <div className="preset-layout">
        <section className="live-fixtures">
          {snapshot.fixtures.length === 0 ? (
            <div className="panel empty-state"><h2>No live controls</h2><p>Add a DMX fixture in Patch.</p></div>
          ) : snapshot.fixtures.map((fixture, index) => (
            <FixtureControls key={fixture.id} fixture={fixture} fixtureIndex={index} snapshot={snapshot} setChannel={setChannel} />
          ))}
        </section>

        <aside className="preset-sidebar panel">
          <div className="panel-title"><span>Preset stack</span><small>{snapshot.presets.length} saved</small></div>
          <div className="capture-row">
            <input value={presetName} onChange={(event) => setPresetName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void capturePreset(); }} placeholder={`Look ${snapshot.presets.length + 1}`} aria-label="New preset name" />
            <button onClick={() => void capturePreset()} disabled={saving}>Capture</button>
          </div>
          <p className="capture-note">Captures all 512 channel values exactly as they are now.</p>
          <div className="preset-list">
            {snapshot.presets.length === 0 ? <div className="preset-empty">No presets captured.</div> : snapshot.presets.map((preset, index) => (
              <article className="preset-card" key={preset.id}>
                <button className="preset-recall" onClick={() => recallPreset(preset.id)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{preset.name}</strong>
                  <small>Recall</small>
                </button>
                <div className="preset-meta">
                  <code title="Companion HTTP URL">{origin}/api/companion/recall/{preset.id}?seconds={snapshot.transitionMs / 1000}</code>
                  <button onClick={() => deletePreset(preset.id)} aria-label={`Delete ${preset.name}`}>Delete</button>
                </div>
              </article>
            ))}
          </div>
          <div className="companion-note"><strong>Companion GET endpoint</strong><a href="/api/companion/presets" target="_blank">/api/companion/presets</a></div>
        </aside>
      </div>
    </section>
  );
}

function FixtureControls({ fixture, fixtureIndex, snapshot, setChannel }: { fixture: PatchedFixture; fixtureIndex: number; snapshot: ConsoleSnapshot; setChannel: (channel: number, value: number) => void }) {
  const profile = snapshot.profiles.find((candidate) => candidate.id === fixture.profileId)!;
  const mode = modeFor(snapshot.profiles, fixture) as FixtureMode;
  return (
    <article className="fixture-console panel">
      <header><div className="fixture-index" style={{ background: profile.accent }}>{String(fixtureIndex + 1).padStart(2, "0")}</div><div><span>{profile.manufacturer} {profile.model}</span><h2>{fixture.name}</h2></div><div className="fixture-mode"><small>{mode.name}</small><strong>CH {fixtureRange(snapshot.profiles, fixture)}</strong></div></header>
      <div className="channel-controls">
        {mode.channels.map((channel) => {
          const universeChannel = fixture.address + channel.offset - 1;
          const value = snapshot.liveValues[universeChannel - 1] ?? 0;
          return (
            <div className={`channel channel-${channel.kind}`} key={channel.offset}>
              <div className="channel-label"><span>{channel.name}</span><small>CH {universeChannel} · {channel.shortName}</small></div>
              <input type="range" min="0" max="255" value={value} onChange={(event) => setChannel(universeChannel, Number(event.target.value))} aria-label={`${fixture.name} ${channel.name}`} />
              <div className="channel-readout">
                {channel.displayMin !== undefined && <output>{displayValue(channel, value)}<small>Display</small></output>}
                <DmxValueInput
                  channelName={channel.name}
                  fixtureName={fixture.name}
                  universeChannel={universeChannel}
                  value={value}
                  setChannel={setChannel}
                />
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function DmxValueInput({
  channelName,
  fixtureName,
  universeChannel,
  value,
  setChannel,
}: {
  channelName: string;
  fixtureName: string;
  universeChannel: number;
  value: number;
  setChannel: (channel: number, value: number) => void;
}) {
  return (
    <label className="dmx-value-input">
      <span>DMX</span>
      <input
        type="number"
        min="0"
        max="255"
        step="1"
        inputMode="numeric"
        value={value}
        aria-label={`${fixtureName} ${channelName} DMX value`}
        onBlur={(event) => {
          event.currentTarget.value = `${value}`;
        }}
        onChange={(event) => {
          const nextValue = event.currentTarget.valueAsNumber;
          if (Number.isFinite(nextValue)) setChannel(universeChannel, clampDmxValue(nextValue));
        }}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}
