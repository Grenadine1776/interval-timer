import { useEffect, useMemo, useState } from "react";

type PhaseType = "warmup" | "work" | "rest" | "cooldown";

type PhaseConfig = {
  id: PhaseType;
  label: string;
  durationSec: number;
  color: string;
  enabled: boolean;
};

type WorkoutPhase = PhaseConfig & {
  round: number;
  totalRounds: number;
};

type WorkoutSession = {
  phases: WorkoutPhase[];
  currentIndex: number;
  phaseEndsAt: number;
  remainingMs: number;
  isPaused: boolean;
  totalPausedMs: number;
  pauseStartedAt: number | null;
  finished: boolean;
};

type StoredSettings = {
  phases: PhaseConfig[];
  rounds: number;
};

const STORAGE_KEY = "interval-timer-settings-v1";

const DEFAULT_PHASES: PhaseConfig[] = [
  {
    id: "warmup",
    label: "Warmup",
    durationSec: 60,
    color: "#f59e0b",
    enabled: false
  },
  {
    id: "rest",
    label: "Rest",
    durationSec: 120,
    color: "#38bdf8",
    enabled: true
  },
  {
    id: "work",
    label: "Work",
    durationSec: 60,
    color: "#dc2626",
    enabled: true
  },
  {
    id: "cooldown",
    label: "Cooldown",
    durationSec: 60,
    color: "#a855f7",
    enabled: false
  }
];

const DEFAULT_SETTINGS: StoredSettings = {
  phases: DEFAULT_PHASES,
  rounds: 7
};

function clampSeconds(value: number) {
  return Math.max(0, Math.min(35999, value));
}

function formatClock(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatMs(ms: number) {
  return formatClock(Math.floor(Math.max(0, ms) / 1000));
}

function loadSettings(): StoredSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    if (!Array.isArray(parsed.phases) || typeof parsed.rounds !== "number") {
      return DEFAULT_SETTINGS;
    }

    const savedOrder = parsed.phases
      .map((phase) => phase.id)
      .filter((phaseId): phaseId is PhaseType =>
        DEFAULT_PHASES.some((defaultPhase) => defaultPhase.id === phaseId)
      );

    const phases = DEFAULT_PHASES.map((defaultPhase) => {
      const saved = parsed.phases?.find((phase) => phase.id === defaultPhase.id);

      return {
        ...defaultPhase,
        durationSec: clampSeconds(saved?.durationSec ?? defaultPhase.durationSec),
        color: saved?.color ?? defaultPhase.color,
        enabled: saved?.enabled ?? defaultPhase.enabled
      };
    }).sort((a, b) => {
      const aIndex = savedOrder.indexOf(a.id);
      const bIndex = savedOrder.indexOf(b.id);

      if (aIndex === -1 && bIndex === -1) {
        return 0;
      }

      if (aIndex === -1) {
        return 1;
      }

      if (bIndex === -1) {
        return -1;
      }

      return aIndex - bIndex;
    });

    return {
      phases,
      rounds: Math.max(1, Math.min(999, Math.floor(parsed.rounds)))
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: StoredSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

function buildWorkout(phases: PhaseConfig[], rounds: number): WorkoutPhase[] {
  const activePhases = phases.filter((phase) => phase.enabled && phase.durationSec > 0);
  const workoutPhases: WorkoutPhase[] = [];

  for (let round = 1; round <= rounds; round += 1) {
    for (const phase of activePhases) {
      workoutPhases.push({
        ...phase,
        round,
        totalRounds: rounds
      });
    }
  }

  return workoutPhases;
}

function advanceSession(session: WorkoutSession, now: number): WorkoutSession {
  if (session.finished || session.isPaused) {
    return session;
  }

  let currentIndex = session.currentIndex;
  let phaseEndsAt = session.phaseEndsAt;

  while (now >= phaseEndsAt) {
    if (currentIndex >= session.phases.length - 1) {
      return {
        ...session,
        currentIndex,
        phaseEndsAt,
        remainingMs: 0,
        finished: true
      };
    }

    currentIndex += 1;
    phaseEndsAt += session.phases[currentIndex].durationSec * 1000;
  }

  return {
    ...session,
    currentIndex,
    phaseEndsAt,
    remainingMs: Math.max(0, phaseEndsAt - now)
  };
}

function skipPhase(session: WorkoutSession, now: number): WorkoutSession {
  const currentPauseDelay =
    session.pauseStartedAt === null ? 0 : Math.max(0, now - session.pauseStartedAt);
  const totalPausedMs = session.totalPausedMs + currentPauseDelay;

  if (session.currentIndex >= session.phases.length - 1) {
    return {
      ...session,
      remainingMs: 0,
      totalPausedMs,
      pauseStartedAt: null,
      isPaused: false,
      finished: true
    };
  }

  const nextIndex = session.currentIndex + 1;
  const nextPhase = session.phases[nextIndex];

  return {
    ...session,
    currentIndex: nextIndex,
    phaseEndsAt: now + nextPhase.durationSec * 1000,
    remainingMs: nextPhase.durationSec * 1000,
    isPaused: false,
    totalPausedMs,
    pauseStartedAt: null,
    finished: false
  };
}

function DurationEditor({
  value,
  onChange
}: {
  value: number;
  onChange: (nextValue: number) => void;
}) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;

  return (
    <div className="duration-editor">
      <label>
        <span>Min</span>
        <input
          type="number"
          min={0}
          max={599}
          value={minutes}
          onChange={(event) => {
            const nextMinutes = Number(event.target.value || 0);
            onChange(clampSeconds(nextMinutes * 60 + seconds));
          }}
        />
      </label>
      <label>
        <span>Sec</span>
        <input
          type="number"
          min={0}
          max={59}
          value={seconds}
          onChange={(event) => {
            const nextSeconds = Math.max(0, Math.min(59, Number(event.target.value || 0)));
            onChange(clampSeconds(minutes * 60 + nextSeconds));
          }}
        />
      </label>
    </div>
  );
}

export default function App() {
  const initialSettings = useMemo(() => loadSettings(), []);
  const [phases, setPhases] = useState<PhaseConfig[]>(initialSettings.phases);
  const [rounds, setRounds] = useState<number>(initialSettings.rounds);
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    saveSettings({ phases, rounds });
  }, [phases, rounds]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockNow(Date.now());
    }, 200);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!session || session.isPaused || session.finished) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setSession((currentSession) => {
        if (!currentSession) {
          return currentSession;
        }

        return advanceSession(currentSession, Date.now());
      });
    }, 100);

    return () => window.clearInterval(intervalId);
  }, [session]);

  const activePhaseCount = phases.filter((phase) => phase.enabled && phase.durationSec > 0).length;
  const canStart = activePhaseCount > 0 && rounds > 0;
  const currentPhase = session?.phases[session.currentIndex] ?? null;
  const currentDelayMs =
    session === null
      ? 0
      : session.totalPausedMs +
        (session.pauseStartedAt === null ? 0 : Math.max(0, clockNow - session.pauseStartedAt));

  const updatePhase = (phaseIndex: number, nextPhase: PhaseConfig) => {
    setPhases((currentPhases) =>
      currentPhases.map((phase, index) => (index === phaseIndex ? nextPhase : phase))
    );
  };

  const movePhase = (phaseIndex: number, direction: -1 | 1) => {
    setPhases((currentPhases) => {
      const nextIndex = phaseIndex + direction;
      if (nextIndex < 0 || nextIndex >= currentPhases.length) {
        return currentPhases;
      }

      const nextPhases = [...currentPhases];
      [nextPhases[phaseIndex], nextPhases[nextIndex]] = [
        nextPhases[nextIndex],
        nextPhases[phaseIndex]
      ];

      return nextPhases;
    });
  };

  const startWorkout = () => {
    const workout = buildWorkout(phases, rounds);
    if (workout.length === 0) {
      return;
    }

    const now = Date.now();
    const firstPhase = workout[0];

    setSession({
      phases: workout,
      currentIndex: 0,
      phaseEndsAt: now + firstPhase.durationSec * 1000,
      remainingMs: firstPhase.durationSec * 1000,
      isPaused: false,
      totalPausedMs: 0,
      pauseStartedAt: null,
      finished: false
    });
  };

  const togglePause = () => {
    setSession((currentSession) => {
      if (!currentSession || currentSession.finished) {
        return currentSession;
      }

      const now = Date.now();

      if (currentSession.isPaused) {
        const pausedFor = currentSession.pauseStartedAt
          ? Math.max(0, now - currentSession.pauseStartedAt)
          : 0;

        return {
          ...currentSession,
          isPaused: false,
          phaseEndsAt: now + currentSession.remainingMs,
          totalPausedMs: currentSession.totalPausedMs + pausedFor,
          pauseStartedAt: null
        };
      }

      return {
        ...currentSession,
        isPaused: true,
        remainingMs: Math.max(0, currentSession.phaseEndsAt - now),
        pauseStartedAt: now
      };
    });
  };

  const goToNextPhase = () => {
    setSession((currentSession) => {
      if (!currentSession || currentSession.finished) {
        return currentSession;
      }

      return skipPhase(currentSession, Date.now());
    });
  };

  const backgroundStyle = currentPhase
    ? {
        backgroundColor: currentPhase.color
      }
    : undefined;

  if (session && currentPhase) {
    return (
      <main className="app-shell active-workout" style={backgroundStyle}>
        <section className="workout-screen">
          <button className="ghost-button exit-button" onClick={() => setSession(null)}>
            Exit
          </button>

          {session.finished ? (
            <div className="finish-state">
              <p className="phase-kicker">Workout complete</p>
              <h1>{currentPhase.label}</h1>
              <p className="timer-value">00:00</p>
              <p className="round-copy">
                Round {currentPhase.totalRounds} / {currentPhase.totalRounds}
              </p>
              <p className="round-copy">Total delay {formatMs(currentDelayMs)}</p>
              <div className="control-row">
                <button className="primary-button" onClick={startWorkout}>
                  Restart
                </button>
                <button className="secondary-button" onClick={() => setSession(null)}>
                  Back to setup
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1>{currentPhase.label}</h1>
              <p className="timer-value">{formatMs(session.remainingMs)}</p>
              <div className="status-grid">
                <div className="status-card">
                  <span>Round</span>
                  <strong>
                    {currentPhase.round} / {currentPhase.totalRounds}
                  </strong>
                </div>
                <div className="status-card">
                  <span>Total delay</span>
                  <strong>{formatMs(currentDelayMs)}</strong>
                </div>
              </div>
              <div className="control-row">
                <button className="primary-button" onClick={togglePause}>
                  {session.isPaused ? "Resume" : "Pause"}
                </button>
                <button className="secondary-button" onClick={goToNextPhase}>
                  Next
                </button>
              </div>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="setup-screen">
        <div className="hero-copy">
          <h1>Interval Timer</h1>
          <blockquote className="hero-quote">
            <em>I'm not paying $3.99 per month for a goddamn timer in the App Store. - Grenadine</em>
          </blockquote>
        </div>

        <section className="phase-list">
          {phases.map((phase, index) => (
            <article
              key={phase.id}
              className={`phase-card ${phase.enabled ? "" : "phase-card-disabled"}`}
            >
              <div className="phase-card-top">
                <div>
                  <p className="phase-name">{phase.label}</p>
                </div>
                <div className="phase-actions">
                  <button
                    className="mini-button"
                    onClick={() => movePhase(index, -1)}
                    disabled={index === 0}
                  >
                    Up
                  </button>
                  <button
                    className="mini-button"
                    onClick={() => movePhase(index, 1)}
                    disabled={index === phases.length - 1}
                  >
                    Down
                  </button>
                  <button
                    className="mini-button"
                    onClick={() => updatePhase(index, { ...phase, enabled: !phase.enabled })}
                  >
                    {phase.enabled ? "Remove" : "Add"}
                  </button>
                </div>
              </div>

              <div className="phase-card-body">
                <DurationEditor
                  value={phase.durationSec}
                  onChange={(nextValue) =>
                    updatePhase(index, {
                      ...phase,
                      durationSec: nextValue
                    })
                  }
                />

                <label className="color-picker">
                  <span>Background color</span>
                  <input
                    type="color"
                    value={phase.color}
                    onChange={(event) =>
                      updatePhase(index, {
                        ...phase,
                        color: event.target.value
                      })
                    }
                  />
                </label>
              </div>
            </article>
          ))}
        </section>

        <section className="rounds-panel">
          <div>
            <p className="section-label">Rounds</p>
            <p className="section-help">The full stage list repeats this many times.</p>
          </div>
          <input
            className="round-input"
            type="number"
            min={1}
            max={999}
            value={rounds}
            onChange={(event) => {
              const nextRounds = Number(event.target.value || 1);
              setRounds(Math.max(1, Math.min(999, nextRounds)));
            }}
          />
        </section>

        <section className="summary-panel">
          <div>
            <p className="section-label">Ready to start</p>
            <p className="section-help">
              {activePhaseCount} active stage{activePhaseCount === 1 ? "" : "s"} per round
            </p>
          </div>
          <button className="start-button" onClick={startWorkout} disabled={!canStart}>
            Start workout
          </button>
        </section>
      </section>
    </main>
  );
}
