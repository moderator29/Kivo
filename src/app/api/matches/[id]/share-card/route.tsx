import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getMatchShareCardData } from "@/lib/football/match-share-card-data";
import {
  MATCH_CARD_CANVAS,
  MATCH_CARD_LAYOUT,
  type MatchShareCardData,
  type MatchShareCardGoalEvent,
  type MatchShareCardTeam,
} from "@/lib/football/match-share-card";
import { fetchImageDataUri } from "@/lib/football/fetch-image-data-uri";

export const runtime = "nodejs";

let backgroundDataUriPromise: Promise<string> | null = null;

/**
 * The template's own PNG derivative (see kivo-match-card-background.png's
 * sibling comment / RECOMMENDATIONS.md) — never the .webp, which next/og's
 * bundled resvg renderer can't decode as an <img> data URI (verified
 * directly: throws "u2 is not iterable"; the PNG copy of the exact same
 * pixels renders cleanly). Read once and cached in module scope: the asset
 * never changes at runtime, so there's no reason to re-read+re-encode it on
 * every share-card request this server instance serves.
 */
function getBackgroundDataUri(): Promise<string> {
  if (!backgroundDataUriPromise) {
    backgroundDataUriPromise = readFile(
      path.join(process.cwd(), "public/assets/kivo/match-card/kivo-match-card-background.png"),
    ).then((buf) => `data:image/png;base64,${buf.toString("base64")}`);
  }
  return backgroundDataUriPromise;
}

function teamNameFontSize(name: string): number {
  if (name.length > 20) return 18;
  if (name.length > 14) return 23;
  return 29;
}

function CrestNode({ team, dataUri, size }: { team: MatchShareCardTeam; dataUri: string | null; size: number }) {
  if (dataUri) {
    // eslint-disable-next-line @next/next/no-img-element -- next/og requires a plain <img>, not next/image.
    return <img src={dataUri} width={size} height={size} alt="" style={{ objectFit: "contain" }} />;
  }
  const initial = (team.shortName ?? team.name).trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 9999,
        backgroundColor: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.18)",
        fontSize: size * 0.4,
        fontWeight: 700,
        color: "#f8faff",
      }}
    >
      {initial}
    </div>
  );
}

function EventRow({ event, align }: { event: MatchShareCardGoalEvent; align: "left" | "right" }) {
  const minuteText = `${event.minute}${event.addedTime ? `+${event.addedTime}` : ""}'`;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexDirection: align === "left" ? "row" : "row-reverse",
      }}
    >
      <span style={{ display: "flex", fontSize: 19, fontWeight: 700, color: "#f8faff", minWidth: 46 }}>{minuteText}</span>
      <span style={{ display: "flex", width: 7, height: 7, borderRadius: 9999, backgroundColor: "#00d9ff" }} />
      <span
        style={{
          display: "flex",
          fontSize: 19,
          fontWeight: 500,
          color: "#cbd5e1",
          maxWidth: 230,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {event.playerName}
        {event.isOwnGoal ? " (OG)" : ""}
      </span>
    </div>
  );
}

/**
 * Covers the template's baked-in placeholder goal rows (RECOMMENDATIONS
 * items 231/232's sibling note on the match-card asset: real data can't be
 * drawn transparently over baked pixels without the placeholder showing
 * through) with a real KIVO glass panel, then draws this side's real goal
 * events inside it — or nothing, if this side hasn't scored. Sized to the
 * template's own two-row example when there's nothing to show, and grows
 * (capped at the layout box's own height) for up to MAX_EVENTS_PER_SIDE
 * real events.
 */
function EventsPanel({
  events,
  align,
  box,
}: {
  events: MatchShareCardGoalEvent[];
  align: "left" | "right";
  box: { top: number; left: number; width: number; height: number };
}) {
  const height = events.length > 0 ? Math.min(box.height, 62 + events.length * 56) : 132;
  return (
    <div
      style={{
        position: "absolute",
        top: box.top,
        left: box.left,
        width: box.width,
        height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 14,
        padding: "18px 22px",
        backgroundColor: "#0a1020",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 22,
      }}
    >
      {events.map((event, i) => (
        <EventRow key={i} event={event} align={align} />
      ))}
    </div>
  );
}

// Exported (alongside the route's own GET handler) so the exact production
// render path can be exercised directly by a local, never-committed test
// harness against realistic-but-fake fixture shapes — see this feature's own
// report for why: the live Supabase project had zero real fixtures at
// development time, so this is what "tested" means for this route today.
export async function buildCardElement(data: MatchShareCardData) {
  const [backgroundDataUri, homeCrestDataUri, awayCrestDataUri] = await Promise.all([
    getBackgroundDataUri(),
    data.homeTeam.crestUrl ? fetchImageDataUri(data.homeTeam.crestUrl) : Promise.resolve(null),
    data.awayTeam.crestUrl ? fetchImageDataUri(data.awayTeam.crestUrl) : Promise.resolve(null),
  ]);

  const statusColor = data.state === "live" ? "#22c55e" : data.state === "finished" ? "#00d9ff" : "#cbd5e1";
  const statusText = data.state === "upcoming" ? data.kickoffLabel : data.state === "live" && data.minuteLabel ? `${data.statusLabel} · ${data.minuteLabel}` : data.statusLabel;

  const L = MATCH_CARD_LAYOUT;

  return (
    <div
      style={{
        width: MATCH_CARD_CANVAS.width,
        height: MATCH_CARD_CANVAS.height,
        display: "flex",
        position: "relative",
        fontFamily: "sans-serif",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- next/og requires a plain <img>. */}
      <img
        src={backgroundDataUri}
        alt=""
        width={MATCH_CARD_CANVAS.width}
        height={MATCH_CARD_CANVAS.height}
        style={{ position: "absolute", top: 0, left: 0 }}
      />

      {/* Status pill: covers the template's baked "FULL TIME" placeholder. */}
      <div
        style={{
          position: "absolute",
          top: L.statusPill.top,
          left: L.statusPill.left,
          width: L.statusPill.width,
          height: L.statusPill.height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          backgroundColor: "#0a1020",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: 999,
        }}
      >
        {data.state === "live" && (
          <span style={{ display: "flex", width: 10, height: 10, borderRadius: 9999, backgroundColor: "#22c55e" }} />
        )}
        <span style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: 3, color: statusColor }}>
          {statusText.toUpperCase()}
        </span>
      </div>

      {/* Team names -- open canvas space above each shield, nothing baked to cover. */}
      <div
        style={{
          position: "absolute",
          top: L.teamNameLeft.top,
          left: L.teamNameLeft.left,
          width: L.teamNameLeft.width,
          height: L.teamNameLeft.height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            display: "flex",
            fontSize: teamNameFontSize(data.homeTeam.name),
            fontWeight: 700,
            color: "#f8faff",
            textAlign: "center",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.homeTeam.name}
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          top: L.teamNameRight.top,
          left: L.teamNameRight.left,
          width: L.teamNameRight.width,
          height: L.teamNameRight.height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            display: "flex",
            fontSize: teamNameFontSize(data.awayTeam.name),
            fontWeight: 700,
            color: "#f8faff",
            textAlign: "center",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.awayTeam.name}
        </span>
      </div>

      {/* Crests -- the shield interiors are already empty in the artwork. */}
      <div
        style={{
          position: "absolute",
          top: L.shieldLeft.top,
          left: L.shieldLeft.left,
          width: L.shieldLeft.width,
          height: L.shieldLeft.height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CrestNode team={data.homeTeam} dataUri={homeCrestDataUri} size={150} />
      </div>
      <div
        style={{
          position: "absolute",
          top: L.shieldRight.top,
          left: L.shieldRight.left,
          width: L.shieldRight.width,
          height: L.shieldRight.height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CrestNode team={data.awayTeam} dataUri={awayCrestDataUri} size={150} />
      </div>

      {/* Score / VS: covers the template's baked "2 - 1". */}
      <div
        style={{
          position: "absolute",
          top: L.scorePanel.top,
          left: L.scorePanel.left,
          width: L.scorePanel.width,
          height: L.scorePanel.height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a1020",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 28,
        }}
      >
        {data.state === "upcoming" ? (
          <span style={{ display: "flex", fontSize: 58, fontWeight: 800, letterSpacing: 4, color: "#f8faff" }}>VS</span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
            <span style={{ display: "flex", fontSize: 108, fontWeight: 800, color: "#f8faff" }}>{data.homeScore ?? 0}</span>
            <span style={{ display: "flex", fontSize: 54, fontWeight: 600, color: "#64748b" }}>-</span>
            <span style={{ display: "flex", fontSize: 108, fontWeight: 800, color: "#f8faff" }}>{data.awayScore ?? 0}</span>
          </div>
        )}
      </div>

      <EventsPanel events={data.homeGoalEvents} align="left" box={L.eventsLeft} />
      <EventsPanel events={data.awayGoalEvents} align="right" box={L.eventsRight} />

      {/* Competition / venue caption -- genuinely empty canvas area. */}
      <div
        style={{
          position: "absolute",
          top: L.caption.top,
          left: L.caption.left,
          width: L.caption.width,
          height: L.caption.height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            display: "flex",
            fontSize: 22,
            fontWeight: 600,
            color: "#8592a8",
            letterSpacing: 1,
            textAlign: "center",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.competitionName.toUpperCase()}
          {data.venueLabel ? ` · ${data.venueLabel}` : ""}
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          top: L.watermark.top,
          left: L.watermark.left,
          width: L.watermark.width,
          height: L.watermark.height,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <span style={{ display: "flex", fontSize: 24, fontWeight: 700, letterSpacing: 3, color: "#00d9ff" }}>KIVO</span>
      </div>
    </div>
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const data = await getMatchShareCardData(supabase, id);

  if (!data) {
    return new Response("Fixture not found", { status: 404 });
  }

  const element = await buildCardElement(data);

  return new ImageResponse(element, {
    width: MATCH_CARD_CANVAS.width,
    height: MATCH_CARD_CANVAS.height,
    headers: {
      // Fixtures update (score/status/events change) so this must never be
      // cached as if it were static — every request re-renders from the
      // live row, same "never stale" reasoning as the rest of Match Centre.
      "Cache-Control": "no-store",
    },
  });
}
