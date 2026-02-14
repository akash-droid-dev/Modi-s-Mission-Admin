import { useState, useEffect, useCallback } from "react";

const BASE = import.meta.env.BASE_URL;
const ADMIN_PASS = "admin123"; // v1 simple auth — change in production

interface Recording {
  id: string;
  created_at: string;
  duration: number;
  size: number;
  platform: string;
  public_url: string;
  blob_data?: string; // base64 for demo
}

// ── IndexedDB helpers (shared storage for github.io origin) ──
const DB_NAME = "modis_mission_db";
const STORE = "recordings";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllFromDB(): Promise<Recording[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const recs = (req.result as Recording[]).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      resolve(recs);
    };
    req.onerror = () => reject(req.error);
  });
}

async function deleteFromDB(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function fmtDuration(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

async function base64ToBlobUrl(b64: string, mime = "video/webm"): Promise<string | null> {
  try {
    const dataUrl = `data:${mime};base64,${b64}`;
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(false);
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});

  // ── Check saved session ──────────────────────────────────
  useEffect(() => {
    if (sessionStorage.getItem("mm_admin") === "1") setAuthed(true);
  }, []);

  // ── Login ────────────────────────────────────────────────
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr("");
    if (password === ADMIN_PASS) {
      setAuthed(true);
      sessionStorage.setItem("mm_admin", "1");
    } else {
      setLoginErr("Invalid password. Try again.");
    }
  };

  // ── Fetch recordings ─────────────────────────────────────
  const fetchRecordings = useCallback(async () => {
    setLoading(true);
    setBlobUrls((prev) => {
      Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
      return {};
    });
    try {
      const recs = await getAllFromDB();
      setRecordings(recs);

      // Create blob URLs for playback (fetch-based for large videos)
      const urls: Record<string, string> = {};
      await Promise.all(
        recs.map(async (rec) => {
          if (rec.blob_data) {
            const url = await base64ToBlobUrl(rec.blob_data);
            if (url) urls[rec.id] = url;
          } else if (rec.public_url) {
            urls[rec.id] = rec.public_url;
          }
        })
      );
      setBlobUrls(urls);
    } catch (err) {
      console.error("Failed to load recordings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) fetchRecordings();
  }, [authed, fetchRecordings]);

  // ── Delete ───────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this recording? This cannot be undone.")) return;
    await deleteFromDB(id);
    if (blobUrls[id]) URL.revokeObjectURL(blobUrls[id]);
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    setBlobUrls((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  // ── Logout ───────────────────────────────────────────────
  const handleLogout = () => {
    setAuthed(false);
    sessionStorage.removeItem("mm_admin");
    // Cleanup blob URLs
    Object.values(blobUrls).forEach((u) => URL.revokeObjectURL(u));
    setBlobUrls({});
  };

  // ── Login screen ─────────────────────────────────────────
  if (!authed) {
    return (
      <div className="login-page">
        <div className="login-card">
          <img src={`${BASE}cover.png`} alt="Modi's Mission" />
          <h1>Admin Access</h1>
          <p className="sub">Enter the admin password to view recordings.</p>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {loginErr && <div className="err">{loginErr}</div>}
            <button type="submit" className="btn">Login</button>
          </form>
        </div>
      </div>
    );
  }

  // ── Dashboard ────────────────────────────────────────────
  return (
    <div className="dash">
      <div className="dash-header">
        <h1>Modi's Mission — Recordings</h1>
        <div className="right">
          <span className="count">
            {recordings.length} recording{recordings.length !== 1 ? "s" : ""}
          </span>
          <button className="btn-logout" onClick={fetchRecordings}>↻ Refresh</button>
          <button className="btn-logout" onClick={handleLogout}>Logout</button>
        </div>
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p style={{ marginTop: 12, color: "var(--text-sec)" }}>Loading…</p>
        </div>
      )}

      {!loading && recordings.length === 0 && (
        <div className="empty">
          <p style={{ fontSize: "1.1rem", marginBottom: 12 }}>No recordings yet.</p>
          <p>Share the Interface app and start collecting visions!</p>
          <p style={{ marginTop: 16 }}>
            <a
              href="https://akash-droid-dev.github.io/Modi-s-Mission-Interface/"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--primary)", fontWeight: 600 }}
            >
              Open Interface App →
            </a>
          </p>
        </div>
      )}

      <div className="grid">
        {recordings.map((rec) => (
          <div key={rec.id} className="card">
            {blobUrls[rec.id] ? (
              <video src={blobUrls[rec.id]} controls preload="metadata" />
            ) : (
              <div style={{ aspectRatio: "16/9", background: "#111", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: ".85rem" }}>
                Video unavailable
              </div>
            )}
            <div className="card-info">
              <div className="card-meta">
                <span>{fmtDate(rec.created_at)}</span>
                <span>{fmtDuration(rec.duration)}</span>
                <span>{fmtSize(rec.size)}</span>
                <span className="platform">{rec.platform}</span>
              </div>
              <button className="btn-sm" onClick={() => handleDelete(rec.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
