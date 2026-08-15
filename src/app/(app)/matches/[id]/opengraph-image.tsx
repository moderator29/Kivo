import { ImageResponse } from "next/og";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { STATUS_LABEL, formatKickoff, type FixtureStatus } from "@/lib/football/fixture-status";

export const alt = "Match on KIVO";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Deliberately narrow: only the columns this card actually renders (real
// team names, the real score/status, real competition name) — no other
// fixture data, and nothing fabricated when a column is still null.
async function getFixtureCard(id: string) {
  const supabase = createServerSupabaseClient();
  const { data: fixture } = await supabase
    .from("fixtures")
    .select(
      `status, kickoff_at, home_score, away_score,
       competition:competitions(name, short_name),
       home_team:teams!fixtures_home_team_id_fkey(name),
       away_team:teams!fixtures_away_team_id_fkey(name)`,
    )
    .eq("id", id)
    .maybeSingle();
  return fixture;
}

function Crest({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 96,
        height: 96,
        borderRadius: 9999,
        backgroundColor: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        fontSize: 40,
        fontWeight: 700,
        color: "#f8faff",
      }}
    >
      {initial}
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fixture = await getFixtureCard(id);

  const homeName = fixture?.home_team?.name ?? "Home";
  const awayName = fixture?.away_team?.name ?? "Away";
  const status: FixtureStatus | null = fixture?.status ?? null;
  const hasScore = fixture?.home_score !== null && fixture?.away_score !== null && status !== null && status !== "scheduled";
  const scoreOrKickoff =
    hasScore && fixture
      ? `${fixture.home_score} - ${fixture.away_score}`
      : fixture && status === "scheduled"
        ? formatKickoff(fixture.kickoff_at)
        : "VS";
  const statusLabel = status ? STATUS_LABEL[status] : null;
  const competitionName = fixture?.competition?.short_name ?? fixture?.competition?.name ?? "KIVO";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#05060a",
          backgroundImage:
            "radial-gradient(circle at 15% 15%, rgba(0,217,255,0.18), transparent 55%), radial-gradient(circle at 88% 80%, rgba(217,70,239,0.16), transparent 55%)",
          padding: "56px 72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 28, fontWeight: 600, color: "#8592a8", letterSpacing: 1 }}>
            {competitionName.toUpperCase()}
          </span>
          <span style={{ fontSize: 28, fontWeight: 700, color: "#00d9ff", letterSpacing: 2 }}>KIVO</span>
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", gap: 56 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: 340 }}>
            <Crest name={homeName} />
            <span style={{ fontSize: 34, fontWeight: 600, color: "#f8faff", textAlign: "center" }}>{homeName}</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 64, fontWeight: 700, color: "#f8faff" }}>{scoreOrKickoff}</span>
            {statusLabel && (
              <span style={{ fontSize: 22, fontWeight: 600, color: "#22c55e", letterSpacing: 1 }}>
                {statusLabel.toUpperCase()}
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: 340 }}>
            <Crest name={awayName} />
            <span style={{ fontSize: 34, fontWeight: 600, color: "#f8faff", textAlign: "center" }}>{awayName}</span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <span style={{ fontSize: 20, color: "#64748b" }}>Football. Together. Live.</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
