/**
 * The nine cards, drawn once.
 *
 * ## Why there is exactly one renderer
 *
 * A share sheet normally has two: a DOM preview and a server-rendered image.
 * They drift, and when they drift the user shares something they never saw.
 * KIVO's sheet avoids that by not having a second renderer at all — the
 * preview in `ShareSheet` is an `<img>` pointed at this module's own output
 * through `/api/share-card`. What is on screen *is* the file that gets saved,
 * byte for byte, including the background.
 *
 * ## What this file may and may not use
 *
 * Everything here is rasterised by `next/og` (satori + resvg), which
 * implements a deliberate subset of CSS. The rules that actually bite:
 *
 *   - Inline styles only. No classes, no CSS variables, no Tailwind.
 *   - Any element with more than one child needs an explicit `display`.
 *     Everything below sets it.
 *   - `<img>` sources must be data URIs of PNG or JPEG bytes. **Not WEBP** —
 *     resvg throws "u2 is not iterable" on one, which is a real bug this
 *     codebase hit on the match card. Callers resolve every image through
 *     `img()`, which returns `null` for anything that isn't decodable, and
 *     every image site below has a real fallback for that null.
 *   - No `backdrop-filter`. KIVO's glass is a translucent fill plus a
 *     hairline here, which is what it visually reduces to anyway.
 *
 * ## Layout
 *
 * One 1080x1080 canvas, one frame (background, scrim, eyebrow, footer) and a
 * per-kind body. The frame is shared so the nine cards read as one family;
 * they are, together, the thing people will recognise as "a KIVO card".
 */

import type { ReactElement, ReactNode } from "react";
import { predictionPointsChipLabel } from "./build";
import { SHARE_BACKGROUND_LAYERS } from "./backgrounds";
import { SHARE_CARD_CANVAS, type ShareCardData, type ShareStat, type ShareTeamRef } from "./types";

/** Resolves a remote image URL to a renderer-safe data URI, or null. Supplied
 * by the route, which does the fetching and the format sniffing. */
export type ImageResolver = (url: string | null | undefined) => string | null;

/**
 * The card palette is fixed dark, and does NOT follow the viewer's theme.
 *
 * That is a decision, not an omission. A card is a file that leaves KIVO — it
 * lands in someone's WhatsApp, and that person has no theme preference in this
 * product to honour. Rendering a pale card for a light-theme sender and a dark
 * one for everybody else would mean the same fixture produced two different
 * artefacts, and the light one would have to be redesigned from scratch
 * against artwork (the KIVO backgrounds) that is dark in every variant.
 *
 * The *sheet* around the card is a different question and does follow the
 * theme: `share-sheet.tsx` is built entirely from KIVO's theme tokens, with no
 * hardcoded colour anywhere in it, so the controls, the picker and the status
 * line all swap with the rest of the app while the artefact stays constant.
 */
const C = {
  text: "#f8faff",
  muted: "#cbd5e1",
  subtle: "#8592a8",
  cyan: "#00d9ff",
  blue: "#2563ff",
  violet: "#7c3fff",
  live: "#22c55e",
  critical: "#ff3b4a",
  gold: "#f5c451",
  panel: "rgba(9,13,26,0.74)",
  panelStrong: "rgba(5,7,14,0.86)",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.20)",
} as const;

const PAD = 72;
const INNER_WIDTH = SHARE_CARD_CANVAS.width - PAD * 2;

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function Text({
  children,
  size = 26,
  weight = 500,
  color = C.text,
  letterSpacing,
  align,
  maxWidth,
  lineClamp,
}: {
  children: string;
  size?: number;
  weight?: number;
  color?: string;
  letterSpacing?: number;
  align?: "left" | "center" | "right";
  maxWidth?: number;
  /** Satori honours `lineClamp` and adds its own ellipsis. Without it a long
   * name silently overflows the canvas edge. */
  lineClamp?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: size,
        fontWeight: weight,
        color,
        ...(letterSpacing != null ? { letterSpacing } : {}),
        ...(align ? { textAlign: align } : {}),
        ...(maxWidth != null ? { maxWidth } : {}),
        ...(lineClamp != null
          ? { lineClamp }
          : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }),
      }}
    >
      {children}
    </div>
  );
}

function Panel({
  children,
  padding = 32,
  gap = 20,
  direction = "column",
  align,
  justify,
  width,
  grow,
  tone = "default",
}: {
  children: ReactNode;
  padding?: number;
  gap?: number;
  direction?: "row" | "column";
  align?: string;
  justify?: string;
  width?: number | string;
  grow?: number;
  tone?: "default" | "strong" | "accent";
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: direction,
        gap,
        padding,
        borderRadius: 32,
        backgroundColor: tone === "strong" ? C.panelStrong : C.panel,
        border: `1px solid ${tone === "accent" ? "rgba(0,217,255,0.38)" : C.border}`,
        ...(align ? { alignItems: align } : {}),
        ...(justify ? { justifyContent: justify } : {}),
        ...(width != null ? { width } : {}),
        ...(grow != null ? { flexGrow: grow } : {}),
      }}
    >
      {children}
    </div>
  );
}

function Chip({ label, color = C.muted, dot }: { label: string; color?: string; dot?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        paddingLeft: 22,
        paddingRight: 22,
        paddingTop: 10,
        paddingBottom: 10,
        borderRadius: 999,
        backgroundColor: "rgba(5,7,14,0.72)",
        border: `1px solid ${C.border}`,
      }}
    >
      {dot ? <div style={{ display: "flex", width: 12, height: 12, borderRadius: 999, backgroundColor: dot }} /> : <div style={{ display: "none" }} />}
      <Text size={22} weight={700} color={color} letterSpacing={2}>
        {label}
      </Text>
    </div>
  );
}

/** A crest, or the club's initial in a KIVO badge. Never a broken image and
 * never an empty hole — a lot of synced clubs have no crest URL at all. */
function Crest({ team, img, size }: { team: ShareTeamRef; img: ImageResolver; size: number }) {
  const src = img(team.crestUrl);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- satori requires a plain <img>, not next/image.
    return <img src={src} width={size} height={size} alt="" style={{ objectFit: "contain" }} />;
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
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.06)",
        border: `1px solid ${C.borderStrong}`,
        fontSize: size * 0.42,
        fontWeight: 700,
        color: C.text,
      }}
    >
      {initial}
    </div>
  );
}

/** A person: player photo or profile avatar, circular, with an initial
 * fallback for the very common case of no synced photo. */
function Portrait({ src, name, size, ring = C.borderStrong }: { src: string | null; name: string; size: number; ring?: string }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- satori requires a plain <img>.
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        style={{ objectFit: "cover", borderRadius: 999, border: `3px solid ${ring}` }}
      />
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.07)",
        border: `3px solid ${ring}`,
        fontSize: size * 0.36,
        fontWeight: 700,
        color: C.text,
      }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function StatBlock({ item, size = 62 }: { item: ShareStat; size?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 130 }}>
      <Text size={size} weight={800} color={item.emphasis ? C.cyan : C.text}>
        {item.value}
      </Text>
      <Text size={21} weight={600} color={C.subtle} letterSpacing={2}>
        {item.label.toUpperCase()}
      </Text>
    </div>
  );
}

/**
 * The shell every card shares: background, scrim, an eyebrow line at the top
 * and a caption/wordmark line at the bottom, with the card's own body between
 * them. `backgroundDataUri` is null for KIVO's signature gradient and for any
 * background that failed to decode — in both cases the gradient underneath is
 * what shows, so a card is never rendered on nothing.
 */
function Frame({
  backgroundDataUri,
  eyebrow,
  eyebrowAccent,
  caption,
  children,
}: {
  backgroundDataUri: string | null;
  eyebrow: string;
  eyebrowAccent?: ReactElement | null;
  caption: string | null;
  children: ReactElement;
}) {
  return (
    <div
      style={{
        width: SHARE_CARD_CANVAS.width,
        height: SHARE_CARD_CANVAS.height,
        display: "flex",
        position: "relative",
        backgroundImage: SHARE_BACKGROUND_LAYERS.base,
        fontFamily: "sans-serif",
      }}
    >
      {backgroundDataUri ? (
        // eslint-disable-next-line @next/next/no-img-element -- satori requires a plain <img>.
        <img
          src={backgroundDataUri}
          alt=""
          width={SHARE_CARD_CANVAS.width}
          height={SHARE_CARD_CANVAS.height}
          style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }}
        />
      ) : (
        <div style={{ display: "none" }} />
      )}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: SHARE_CARD_CANVAS.width,
          height: SHARE_CARD_CANVAS.height,
          display: "flex",
          // The scrim only exists to make an image background safe to read on.
          // KIVO's own gradient is already dark enough, and darkening it twice
          // is what made the signature card look like an unfinished black
          // square rather than a designed one.
          backgroundImage: backgroundDataUri ? SHARE_BACKGROUND_LAYERS.scrim : SHARE_BACKGROUND_LAYERS.signatureGlow,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: SHARE_CARD_CANVAS.width,
          height: SHARE_CARD_CANVAS.height,
          display: "flex",
          flexDirection: "column",
          padding: PAD,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: INNER_WIDTH }}>
          <Text size={23} weight={700} color={C.muted} letterSpacing={4} maxWidth={640}>
            {eyebrow.toUpperCase()}
          </Text>
          {eyebrowAccent ?? <div style={{ display: "none" }} />}
        </div>

        {/* The body is centred in whatever space the eyebrow and footer leave.
            Without this a short card (a transfer, a prediction) sits high and
            reads as a screenshot with something missing underneath it. */}
        <div
          style={{
            display: "flex",
            flexGrow: 1,
            alignItems: "center",
            justifyContent: "center",
            width: INNER_WIDTH,
            paddingTop: 28,
            paddingBottom: 28,
          }}
        >
          {children}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", width: INNER_WIDTH }}>
          <Text size={22} weight={500} color={C.subtle} maxWidth={720}>
            {caption ?? ""}
          </Text>
          <Text size={28} weight={800} color={C.cyan} letterSpacing={7}>
            KIVO
          </Text>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The nine bodies                                                     */
/* ------------------------------------------------------------------ */

function TeamColumn({ team, img }: { team: ShareTeamRef; img: ImageResolver }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: 320 }}>
      <Crest team={team} img={img} size={186} />
      {/* Wrapped rather than ellipsised: "Manchester Unite…" on a card people
          screenshot is worse than two lines. */}
      <Text size={team.name.length > 16 ? 32 : 42} weight={700} align="center" maxWidth={320} lineClamp={2}>
        {team.name}
      </Text>
    </div>
  );
}

function liveScoreBody(data: Extract<ShareCardData, { kind: "live-score" }>, img: ImageResolver): ReactElement {
  const home = data.scorers.filter((s) => s.side === "home");
  const away = data.scorers.filter((s) => s.side === "away");

  const scorerLine = (s: (typeof data.scorers)[number]) =>
    `${s.minute}${s.addedTime ? `+${s.addedTime}` : ""}' ${s.playerName}${s.isOwnGoal ? " (OG)" : ""}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 30, width: INNER_WIDTH }}>
      <Panel padding={48} gap={30} direction="row" align="center" justify="space-between">
        <TeamColumn team={data.home} img={img} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          {data.homeScore == null || data.awayScore == null ? (
            <Text size={72} weight={800} letterSpacing={6}>
              VS
            </Text>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              <Text size={150} weight={800}>
                {String(data.homeScore)}
              </Text>
              <Text size={64} weight={600} color={C.subtle}>
                -
              </Text>
              <Text size={150} weight={800}>
                {String(data.awayScore)}
              </Text>
            </div>
          )}
          {data.minuteLabel ? (
            <Text size={30} weight={700} color={C.live}>
              {data.minuteLabel}
            </Text>
          ) : (
            <div style={{ display: "none" }} />
          )}
        </div>
        <TeamColumn team={data.away} img={img} />
      </Panel>

      {data.scorers.length > 0 ? (
        <Panel padding={38} gap={24} direction="row" justify="space-between">
          <div style={{ display: "flex", flexDirection: "column", gap: 14, width: 420 }}>
            {home.map((s, i) => (
              <Text key={i} size={29} color={C.muted} maxWidth={420}>
                {scorerLine(s)}
              </Text>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, width: 420, alignItems: "flex-end" }}>
            {away.map((s, i) => (
              <Text key={i} size={29} color={C.muted} maxWidth={420}>
                {scorerLine(s)}
              </Text>
            ))}
          </div>
        </Panel>
      ) : (
        <div style={{ display: "none" }} />
      )}
    </div>
  );
}

function playerPerformanceBody(
  data: Extract<ShareCardData, { kind: "player-performance" }>,
  img: ImageResolver,
): ReactElement {
  const meta = [data.player.position, data.player.teamName].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 34, width: INNER_WIDTH }}>
      <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
        <Portrait src={img(data.player.photoUrl)} name={data.player.name} size={188} ring="rgba(0,217,255,0.45)" />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
          <Text size={data.player.name.length > 20 ? 52 : 64} weight={800} maxWidth={640}>
            {data.player.name}
          </Text>
          {meta ? (
            <Text size={28} color={C.muted} maxWidth={640}>
              {meta}
            </Text>
          ) : (
            <div style={{ display: "none" }} />
          )}
        </div>
      </div>

      <Panel padding={36} gap={34} direction="row" justify="space-around" align="center">
        {data.stats.slice(0, 3).map((s, i) => (
          <StatBlock key={i} item={s} />
        ))}
      </Panel>
      {data.stats.length > 3 ? (
        <Panel padding={30} gap={30} direction="row" justify="space-around" align="center">
          {data.stats.slice(3, 6).map((s, i) => (
            <StatBlock key={i} item={s} size={46} />
          ))}
        </Panel>
      ) : (
        <div style={{ display: "none" }} />
      )}
    </div>
  );
}

function playerComparisonBody(
  data: Extract<ShareCardData, { kind: "player-comparison" }>,
  img: ImageResolver,
): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, width: INNER_WIDTH }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: 380 }}>
          <Portrait src={img(data.left.photoUrl)} name={data.left.name} size={132} ring="rgba(0,217,255,0.45)" />
          <Text size={data.left.name.length > 18 ? 30 : 36} weight={700} align="center" maxWidth={380}>
            {data.left.name}
          </Text>
          <Text size={22} color={C.subtle} align="center" maxWidth={380}>
            {data.left.teamName ?? ""}
          </Text>
        </div>
        {/* Sits level with the two portraits rather than with the centre of
            the whole column, which includes the names below them. */}
        <div style={{ display: "flex", paddingBottom: 74 }}>
          <Text size={34} weight={800} color={C.violet} letterSpacing={4}>
            VS
          </Text>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: 380 }}>
          <Portrait src={img(data.right.photoUrl)} name={data.right.name} size={132} ring="rgba(124,63,255,0.55)" />
          <Text size={data.right.name.length > 18 ? 30 : 36} weight={700} align="center" maxWidth={380}>
            {data.right.name}
          </Text>
          <Text size={22} color={C.subtle} align="center" maxWidth={380}>
            {data.right.teamName ?? ""}
          </Text>
        </div>
      </div>

      <Panel padding={30} gap={18}>
        {data.rows.slice(0, 6).map((row, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Text size={40} weight={800} color={row.leader === "left" ? C.cyan : C.text}>
              {row.leftValue}
            </Text>
            <Text size={24} weight={600} color={C.subtle} letterSpacing={2}>
              {row.label.toUpperCase()}
            </Text>
            <Text size={40} weight={800} color={row.leader === "right" ? C.violet : C.text}>
              {row.rightValue}
            </Text>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function predictionBody(data: Extract<ShareCardData, { kind: "prediction" }>, img: ImageResolver): ReactElement {
  const outcomeColor = data.outcome === "correct" ? C.live : data.outcome === "missed" ? C.critical : C.subtle;
  const outcomeLabel = data.outcome === "correct" ? "Called it" : data.outcome === "missed" ? "Missed" : "Awaiting kickoff";
  const pointsChipLabel = predictionPointsChipLabel(data.pointsAwarded);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, width: INNER_WIDTH }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <Portrait src={img(data.avatarUrl)} name={data.displayName} size={110} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 700 }}>
          <Text size={40} weight={700} maxWidth={700}>
            {data.displayName}
          </Text>
          <Text size={24} color={C.subtle} maxWidth={700}>
            {`@${data.username}`}
          </Text>
        </div>
      </div>

      <Panel padding={46} gap={28} direction="row" align="center" justify="space-between">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: 280 }}>
          <Crest team={data.home} img={img} size={124} />
          <Text size={26} weight={600} align="center" maxWidth={280}>
            {data.home.shortName ?? data.home.name}
          </Text>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          {data.actualLabel ? (
            <Text size={72} weight={800}>
              {data.actualLabel}
            </Text>
          ) : (
            <Text size={48} weight={800} color={C.subtle} letterSpacing={4}>
              VS
            </Text>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: 280 }}>
          <Crest team={data.away} img={img} size={124} />
          <Text size={26} weight={600} align="center" maxWidth={280}>
            {data.away.shortName ?? data.away.name}
          </Text>
        </div>
      </Panel>

      <Panel padding={44} gap={14} tone="accent" align="center">
        <Text size={22} weight={600} color={C.subtle} letterSpacing={3}>
          CALLED
        </Text>
        <Text size={56} weight={800} color={C.cyan} align="center" maxWidth={INNER_WIDTH - 80}>
          {data.predictedLabel}
        </Text>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Chip label={outcomeLabel.toUpperCase()} color={outcomeColor} dot={outcomeColor} />
          {/* Two corrections found by rendering this card against a real
              scored prediction and looking at it.
              1. The unit was wrong. `predictions.points_awarded` is prediction
                 POINTS, not XP — XP is five times it
                 (XP_PER_PREDICTION_POINT in src/lib/predictions.ts). A card
                 saying "+3 XP" for a real 3-point win put a real number under
                 the wrong name, on the one artefact nobody can check against
                 the app.
              2. A scored zero was rendering as "+0 XP" next to "MISSED",
                 which reads as an award for getting it wrong. The zero is
                 still real and still told — that is what MISSED says. Only a
                 gain gets a chip, which is also how resultBadge() states it
                 everywhere else in the product. */}
          {pointsChipLabel ? <Chip label={pointsChipLabel} color={C.gold} /> : <div style={{ display: "none" }} />}
        </div>
      </Panel>
    </div>
  );
}

function fantasyBody(data: Extract<ShareCardData, { kind: "fantasy-performance" }>): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 30, width: INNER_WIDTH }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Text size={58} weight={800} maxWidth={INNER_WIDTH}>
          {data.teamName}
        </Text>
        <Text size={28} color={C.muted} maxWidth={INNER_WIDTH}>
          {data.managerName}
        </Text>
      </div>

      <Panel padding={44} gap={8} align="center" tone="accent">
        <Text size={190} weight={800} color={C.cyan}>
          {String(data.points)}
        </Text>
        <Text size={26} weight={600} color={C.subtle} letterSpacing={4}>
          {`${data.gameweekLabel.toUpperCase()} POINTS`}
        </Text>
      </Panel>

      {data.rankLabel || data.stats.length > 0 ? (
        <Panel padding={30} gap={26} direction="row" align="center" justify="space-around">
          {data.rankLabel ? <StatBlock item={{ label: "Season standing", value: data.rankLabel }} size={34} /> : <div style={{ display: "none" }} />}
          {data.stats.map((s, i) => (
            <StatBlock key={i} item={s} size={44} />
          ))}
        </Panel>
      ) : (
        <div style={{ display: "none" }} />
      )}
    </div>
  );
}

function leagueTableBody(data: Extract<ShareCardData, { kind: "league-table" }>, img: ImageResolver): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, width: INNER_WIDTH }}>
      <Text size={48} weight={800} maxWidth={INNER_WIDTH}>
        {data.competitionName}
      </Text>

      <Panel padding={26} gap={0}>
        <div style={{ display: "flex", alignItems: "center", paddingBottom: 12, paddingLeft: 8, paddingRight: 8 }}>
          <div style={{ display: "flex", width: 62 }}>
            <Text size={19} weight={700} color={C.subtle} letterSpacing={2}>
              #
            </Text>
          </div>
          <div style={{ display: "flex", flexGrow: 1 }}>
            <Text size={19} weight={700} color={C.subtle} letterSpacing={2}>
              CLUB
            </Text>
          </div>
          <div style={{ display: "flex", width: 78, justifyContent: "flex-end" }}>
            <Text size={19} weight={700} color={C.subtle} letterSpacing={2}>
              P
            </Text>
          </div>
          <div style={{ display: "flex", width: 96, justifyContent: "flex-end" }}>
            <Text size={19} weight={700} color={C.subtle} letterSpacing={2}>
              GD
            </Text>
          </div>
          <div style={{ display: "flex", width: 96, justifyContent: "flex-end" }}>
            <Text size={19} weight={700} color={C.subtle} letterSpacing={2}>
              PTS
            </Text>
          </div>
        </div>

        {data.rows.map((row) => {
          const highlighted = data.highlightTeamName != null && row.team.name === data.highlightTeamName;
          return (
            <div
              key={row.position}
              style={{
                display: "flex",
                alignItems: "center",
                paddingTop: 11,
                paddingBottom: 11,
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: 14,
                backgroundColor: highlighted ? "rgba(0,217,255,0.14)" : "transparent",
              }}
            >
              <div style={{ display: "flex", width: 62 }}>
                <Text size={28} weight={700} color={highlighted ? C.cyan : C.subtle}>
                  {String(row.position)}
                </Text>
              </div>
              <div style={{ display: "flex", flexGrow: 1, alignItems: "center", gap: 16 }}>
                <Crest team={row.team} img={img} size={38} />
                <Text size={28} weight={highlighted ? 800 : 600} maxWidth={340}>
                  {row.team.name}
                </Text>
              </div>
              <div style={{ display: "flex", width: 78, justifyContent: "flex-end" }}>
                <Text size={26} color={C.muted}>
                  {String(row.played)}
                </Text>
              </div>
              <div style={{ display: "flex", width: 96, justifyContent: "flex-end" }}>
                <Text size={26} color={C.muted}>
                  {row.goalDifference > 0 ? `+${row.goalDifference}` : String(row.goalDifference)}
                </Text>
              </div>
              <div style={{ display: "flex", width: 96, justifyContent: "flex-end" }}>
                <Text size={28} weight={800} color={highlighted ? C.cyan : C.text}>
                  {String(row.points)}
                </Text>
              </div>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}

function transferBody(data: Extract<ShareCardData, { kind: "transfer" }>, img: ImageResolver): ReactElement {
  const side = (t: ShareTeamRef | null, label: string) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: 300 }}>
      <Text size={20} weight={700} color={C.subtle} letterSpacing={3}>
        {label}
      </Text>
      {t ? <Crest team={t} img={img} size={132} /> : <div style={{ display: "flex", width: 112, height: 112, borderRadius: 999, border: `1px dashed ${C.border}` }} />}
      <Text size={28} weight={600} align="center" maxWidth={300} color={t ? C.text : C.subtle}>
        {t ? t.name : "Not recorded"}
      </Text>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 30, width: INNER_WIDTH }}>
      <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
        <Portrait src={img(data.playerPhotoUrl)} name={data.playerName} size={150} ring="rgba(0,217,255,0.45)" />
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 660 }}>
          <Text size={data.playerName.length > 20 ? 50 : 62} weight={800} maxWidth={660}>
            {data.playerName}
          </Text>
          <div style={{ display: "flex", gap: 14 }}>
            <Chip label={data.statusLabel.toUpperCase()} color={C.live} dot={C.live} />
            <Chip label={data.typeLabel.toUpperCase()} color={C.muted} />
          </div>
        </div>
      </div>

      <Panel padding={44} gap={20} direction="row" align="center" justify="space-between">
        {side(data.fromTeam, "FROM")}
        <Text size={54} weight={800} color={C.cyan}>
          →
        </Text>
        {side(data.toTeam, "TO")}
      </Panel>

      {data.feeText ? (
        <Panel padding={34} gap={12} align="center">
          <Text size={20} weight={700} color={C.subtle} letterSpacing={3}>
            FEE
          </Text>
          <Text size={40} weight={800} color={C.gold} maxWidth={INNER_WIDTH - 80}>
            {data.feeText}
          </Text>
        </Panel>
      ) : (
        <div style={{ display: "none" }} />
      )}
    </div>
  );
}

function aiInsightBody(data: Extract<ShareCardData, { kind: "ai-insight" }>): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, width: INNER_WIDTH }}>
      <Panel padding={30} gap={12} align="flex-start">
        <Text size={20} weight={700} color={C.violet} letterSpacing={3}>
          ASKED
        </Text>
        <Text size={34} weight={600} color={C.muted} maxWidth={INNER_WIDTH - 60} lineClamp={2}>
          {data.question}
        </Text>
      </Panel>

      <Panel padding={38} gap={16} tone="strong" align="flex-start">
        <Text size={20} weight={700} color={C.cyan} letterSpacing={3}>
          KIVO COPILOT
        </Text>
        <Text size={38} weight={600} color={C.text} maxWidth={INNER_WIDTH - 76} lineClamp={7}>
          {data.answer}
        </Text>
      </Panel>

      <div style={{ display: "flex", gap: 14 }}>
        <Chip label="GROUNDED IN KIVO DATA" color={C.violet} dot={C.violet} />
        {data.contextLabel ? <Chip label={data.contextLabel.toUpperCase()} color={C.muted} /> : <div style={{ display: "none" }} />}
      </div>
    </div>
  );
}

function profileBody(data: Extract<ShareCardData, { kind: "profile-achievement" }>, img: ImageResolver): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, width: INNER_WIDTH }}>
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <Portrait src={img(data.avatarUrl)} name={data.displayName} size={176} ring="rgba(0,217,255,0.45)" />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640 }}>
          <Text size={data.displayName.length > 18 ? 50 : 60} weight={800} maxWidth={640}>
            {data.displayName}
          </Text>
          <Text size={28} color={C.muted} maxWidth={640}>
            {`@${data.username}`}
          </Text>
          <Text size={22} color={C.subtle} maxWidth={640}>
            {data.joinedLabel}
          </Text>
        </div>
      </div>

      {data.stats.length > 0 ? (
        <Panel padding={34} gap={24} direction="row" align="center" justify="space-around">
          {data.stats.slice(0, 4).map((s, i) => (
            <StatBlock key={i} item={s} size={52} />
          ))}
        </Panel>
      ) : (
        <div style={{ display: "none" }} />
      )}

      {data.badges.length > 0 ? (
        <Panel padding={30} gap={16} align="flex-start">
          <Text size={20} weight={700} color={C.gold} letterSpacing={3}>
            EARNED
          </Text>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {data.badges.slice(0, 6).map((badge, i) => (
              <Chip key={i} label={badge.name.toUpperCase()} color={C.gold} />
            ))}
          </div>
        </Panel>
      ) : (
        <div style={{ display: "none" }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/** The eyebrow/caption pair for a card — the only two lines of chrome that
 * differ per kind, kept next to the bodies so a new card can't forget them. */
function chrome(data: ShareCardData): { eyebrow: string; caption: string | null; accent: ReactElement | null } {
  switch (data.kind) {
    case "live-score":
      return {
        eyebrow: data.competitionName,
        caption: [data.venueLabel, data.kickoffLabel].filter(Boolean).join(" · ") || null,
        accent: (
          <Chip
            label={data.statusLabel}
            color={data.state === "live" ? C.live : data.state === "finished" ? C.cyan : C.muted}
            dot={data.state === "live" ? C.live : undefined}
          />
        ),
      };
    case "player-performance":
      return { eyebrow: "Player performance", caption: data.windowLabel, accent: null };
    case "player-comparison":
      return { eyebrow: "Head to head", caption: data.windowLabel, accent: null };
    case "prediction":
      return {
        eyebrow: `${data.competitionName} · prediction`,
        caption: data.kickoffLabel,
        accent: null,
      };
    case "fantasy-performance":
      return { eyebrow: "KIVO Fantasy", caption: data.gameweekLabel, accent: null };
    case "league-table":
      return {
        eyebrow: data.seasonLabel,
        caption: data.truncatedNote,
        accent: null,
      };
    case "transfer":
      return { eyebrow: "Transfer", caption: `${data.dateLabel} · ${data.sourceLabel}`, accent: null };
    case "ai-insight":
      return { eyebrow: "AI Copilot", caption: data.askedAtLabel, accent: null };
    case "profile-achievement":
      return { eyebrow: "KIVO profile", caption: null, accent: null };
  }
}

export function renderShareCard(
  data: ShareCardData,
  options: { backgroundDataUri: string | null; img: ImageResolver },
): ReactElement {
  const { img, backgroundDataUri } = options;
  const { eyebrow, caption, accent } = chrome(data);

  const body =
    data.kind === "live-score"
      ? liveScoreBody(data, img)
      : data.kind === "player-performance"
        ? playerPerformanceBody(data, img)
        : data.kind === "player-comparison"
          ? playerComparisonBody(data, img)
          : data.kind === "prediction"
            ? predictionBody(data, img)
            : data.kind === "fantasy-performance"
              ? fantasyBody(data)
              : data.kind === "league-table"
                ? leagueTableBody(data, img)
                : data.kind === "transfer"
                  ? transferBody(data, img)
                  : data.kind === "ai-insight"
                    ? aiInsightBody(data)
                    : profileBody(data, img);

  return (
    <Frame backgroundDataUri={backgroundDataUri} eyebrow={eyebrow} eyebrowAccent={accent} caption={caption}>
      {body}
    </Frame>
  );
}

/**
 * Every remote image URL a card wants, so the route can fetch them all in one
 * parallel pass and hand back a resolver. Keeping this next to the renderer
 * means a card that starts drawing a new image can't forget to have it
 * fetched — the two lists are three lines apart.
 */
export function shareCardImageUrls(data: ShareCardData): string[] {
  const urls: (string | null | undefined)[] = [];
  switch (data.kind) {
    case "live-score":
      urls.push(data.home.crestUrl, data.away.crestUrl);
      break;
    case "player-performance":
      urls.push(data.player.photoUrl, data.teamCrestUrl);
      break;
    case "player-comparison":
      urls.push(data.left.photoUrl, data.right.photoUrl);
      break;
    case "prediction":
      urls.push(data.avatarUrl, data.home.crestUrl, data.away.crestUrl);
      break;
    case "league-table":
      urls.push(...data.rows.map((r) => r.team.crestUrl));
      break;
    case "transfer":
      urls.push(data.playerPhotoUrl, data.fromTeam?.crestUrl, data.toTeam?.crestUrl);
      break;
    case "profile-achievement":
      urls.push(data.avatarUrl);
      break;
    case "fantasy-performance":
    case "ai-insight":
      break;
  }
  return [...new Set(urls.filter((u): u is string => typeof u === "string" && u.length > 0))];
}
