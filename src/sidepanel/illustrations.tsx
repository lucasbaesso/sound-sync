// Line illustrations for the setup and test instructions. They use currentColor plus the three
// signal colors (lips/camera violet, voice amber, instrument blue) so they work in both themes.

const VIOLET = 'var(--c-picture)';
const AMBER = 'var(--c-voice)';
const BLUE = 'var(--c-instrument)';
const RED = 'var(--c-bad)';
const GOOD = 'var(--c-good)';
const FILL = 'var(--ill-fill)';

function Frame({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <svg class="ill" viewBox="0 0 200 120" role="img" aria-label={label} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      {children}
    </svg>
  );
}

/** A front-facing person: head and shoulders. */
function Person({ x, headY, scale = 1 }: { x: number; headY: number; scale?: number }) {
  const r = 13 * scale;
  const w = 30 * scale;
  const top = headY + r + 6 * scale;
  const bottom = headY + 70 * scale;
  return (
    <g>
      <circle cx={x} cy={headY} r={r} fill={FILL} />
      <path d={`M${x - w} ${bottom} C${x - w} ${top}, ${x + w} ${top}, ${x + w} ${bottom}`} fill={FILL} />
    </g>
  );
}

function Hand({ x, y, angle = 0, color = 'currentColor' }: { x: number; y: number; angle?: number; color?: string }) {
  return <rect x={x - 6} y={y - 9} width="12" height="18" rx="5" fill={FILL} stroke={color} transform={`rotate(${angle} ${x} ${y})`} />;
}

function Burst({ x, y, color, r0 = 14, r1 = 22 }: { x: number; y: number; color: string; r0?: number; r1?: number }) {
  const rays = [-150, -110, -70, -30, 30, 70, 110, 150, 180, 0];
  return (
    <g stroke={color} stroke-width="2.4">
      {rays.map((deg) => {
        const a = (deg * Math.PI) / 180;
        return <line key={deg} x1={x + r0 * Math.cos(a)} y1={y + r0 * Math.sin(a)} x2={x + r1 * Math.cos(a)} y2={y + r1 * Math.sin(a)} />;
      })}
    </g>
  );
}

/** Guitar held across the body, body lower left, neck rising to the right. */
function Guitar({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <line x1={x + 14} y1={y - 4} x2={x + 92} y2={y - 34} stroke-width="9" stroke={BLUE} opacity="0.35" />
      <line x1={x + 14} y1={y - 4} x2={x + 92} y2={y - 34} stroke-width="1" stroke={BLUE} />
      <ellipse cx={x} cy={y} rx="24" ry="17" fill={FILL} stroke={BLUE} transform={`rotate(-20 ${x} ${y})`} />
      <circle cx={x + 4} cy={y - 2} r="5" stroke={BLUE} />
      <rect x={x + 90} y={y - 42} width="12" height="14" rx="3" fill={FILL} stroke={BLUE} transform={`rotate(-21 ${x + 96} ${y - 35})`} />
    </g>
  );
}

function Speaker({ x, y, muted, color }: { x: number; y: number; muted: boolean; color: string }) {
  return (
    <g stroke={color}>
      <path d={`M${x - 10} ${y - 4} h5 l7 -6 v20 l-7 -6 h-5 z`} fill={FILL} />
      {muted ? (
        <line x1={x + 6} y1={y - 8} x2={x + 16} y2={y + 12} stroke={RED} stroke-width="2.6" />
      ) : (
        <g>
          <path d={`M${x + 6} ${y - 3} q4 5 0 10`} />
          <path d={`M${x + 10} ${y - 7} q8 9 0 18`} />
        </g>
      )}
    </g>
  );
}

function Label({ x, y, text, anchor = 'middle', size = 10, weight = 500 }: { x: number; y: number; text: string; anchor?: string; size?: number; weight?: number }) {
  return (
    <text x={x} y={y} text-anchor={anchor} font-size={size} font-weight={weight} fill="currentColor" stroke="none">
      {text}
    </text>
  );
}

export function ShareTabIll(p: { label: string; tab: string; other: string; audio: string; share: string }) {
  return (
    <Frame label={p.label}>
      <rect x="10" y="6" width="180" height="108" rx="8" fill={FILL} />
      <rect x="22" y="18" width="156" height="22" rx="5" stroke={BLUE} stroke-width="2.4" />
      <rect x="30" y="24" width="14" height="10" rx="2" />
      <Label x={52} y={33} text={p.tab} anchor="start" />
      <rect x="22" y="46" width="156" height="22" rx="5" opacity="0.35" />
      <rect x="30" y="52" width="14" height="10" rx="2" opacity="0.35" />
      <g opacity="0.45">
        <Label x={52} y={61} text={p.other} anchor="start" />
      </g>
      <rect x="22" y="80" width="22" height="12" rx="6" fill={BLUE} stroke={BLUE} />
      <circle cx="38" cy="86" r="4" fill="#fff" stroke="none" />
      <Label x={50} y={90} text={p.audio} anchor="start" size={9} />
      <rect x="112" y="96" width="66" height="13" rx="4" fill={BLUE} stroke={BLUE} />
      <text x="145" y="106" text-anchor="middle" font-size="8.5" font-weight="600" fill="#fff" stroke="none">
        {p.share}
      </text>
    </Frame>
  );
}

export function CameraViewIll({ label }: { label: string }) {
  return (
    <Frame label={label}>
      <rect x="10" y="48" width="34" height="24" rx="4" fill={FILL} />
      <circle cx="27" cy="60" r="7" stroke={VIOLET} />
      <path d="M44 54 L92 14 M44 66 L92 112" stroke-dasharray="3 4" opacity="0.6" />
      <rect x="92" y="8" width="98" height="106" rx="6" stroke={VIOLET} stroke-dasharray="5 4" />
      <Person x={141} headY={42} />
      <line x1="118" y1="88" x2="112" y2="70" />
      <line x1="164" y1="88" x2="170" y2="70" />
      <Hand x={110} y={62} />
      <Hand x={172} y={62} />
    </Frame>
  );
}

export function MuteStringsIll({ label }: { label: string }) {
  return (
    <Frame label={label}>
      <ellipse cx="46" cy="74" rx="30" ry="26" fill={FILL} stroke={BLUE} />
      <ellipse cx="76" cy="74" rx="20" ry="19" fill={FILL} stroke={BLUE} />
      <circle cx="60" cy="74" r="7" stroke={BLUE} />
      <rect x="86" y="68" width="92" height="12" rx="2" fill={FILL} stroke={BLUE} />
      <rect x="176" y="64" width="16" height="20" rx="3" fill={FILL} stroke={BLUE} />
      <g stroke={BLUE} stroke-width="1">
        <line x1="54" y1="71" x2="188" y2="71" />
        <line x1="54" y1="74" x2="188" y2="74" />
        <line x1="54" y1="77" x2="188" y2="77" />
      </g>
      <rect x="94" y="56" width="30" height="34" rx="9" fill={FILL} />
      <path d="M100 60 v10 M108 58 v12 M116 60 v10" opacity="0.5" />
      <Speaker x={150} y={26} muted color="currentColor" />
    </Frame>
  );
}

export function ClapIll({ label }: { label: string }) {
  return (
    <Frame label={label}>
      <Person x={84} headY={22} />
      <line x1="60" y1="96" x2="75" y2="80" />
      <line x1="108" y1="96" x2="93" y2="80" />
      <Hand x={79} y={74} angle={18} />
      <Hand x={89} y={74} angle={-18} />
      <Burst x={84} y={72} color={AMBER} r0={15} r1={21} />
      <text x="146" y="58" text-anchor="middle" font-size="26" font-weight="700" fill={AMBER} stroke="none">
        ×3
      </text>
      <g stroke={AMBER}>
        <circle cx="126" cy="86" r="3" fill={AMBER} />
        <circle cx="146" cy="86" r="3" fill={AMBER} />
        <circle cx="166" cy="86" r="3" fill={AMBER} />
        <line x1="126" y1="96" x2="166" y2="96" opacity="0.6" />
      </g>
      <Label x={136} y={110} text="2 s" size={9} />
      <Label x={156} y={110} text="2 s" size={9} />
    </Frame>
  );
}

export function StartFirstIll(p: { label: string; you: string; stream: string; delay: string }) {
  return (
    <Frame label={p.label}>
      <Person x={34} headY={40} scale={0.75} />
      <Burst x={34} y={66} color={AMBER} r0={8} r1={13} />
      <Label x={34} y={112} text={p.you} />
      <path d="M68 66 H128" />
      <path d="M122 60 L130 66 L122 72" />
      <circle cx="98" cy="44" r="10" />
      <path d="M98 38 v6 l4 3" />
      <Label x={98} y={88} text={p.delay} size={9} />
      <rect x="136" y="34" width="58" height="48" rx="5" fill={FILL} />
      <line x1="136" y1="44" x2="194" y2="44" />
      <path d="M160 52 l12 7 l-12 7 z" fill={VIOLET} stroke={VIOLET} />
      <Label x={165} y={100} text={p.stream} size={9} />
    </Frame>
  );
}

export function MixerIll(p: { label: string; mic: string; instrument: string; muted: boolean }) {
  const ring = p.muted ? RED : GOOD;
  return (
    <Frame label={p.label}>
      <rect x="18" y="8" width="78" height="104" rx="8" fill={FILL} stroke={ring} stroke-width="2.4" />
      <Label x={57} y={26} text={p.mic} weight={600} />
      <rect x="30" y="36" width="54" height="6" rx="3" opacity="0.35" />
      {!p.muted && <rect x="30" y="36" width="34" height="6" rx="3" fill={AMBER} stroke={AMBER} />}
      <Speaker x={54} y={74} muted={p.muted} color={p.muted ? RED : 'currentColor'} />
      <circle cx="58" cy="76" r="20" stroke={ring} />
      <rect x="106" y="8" width="78" height="104" rx="8" fill={FILL} opacity="0.9" />
      <Label x={145} y={26} text={p.instrument} weight={600} />
      <rect x="118" y="36" width="54" height="6" rx="3" opacity="0.35" />
      <rect x="118" y="36" width="40" height="6" rx="3" fill={BLUE} stroke={BLUE} />
      <Speaker x={142} y={74} muted={false} color="currentColor" />
    </Frame>
  );
}

/**
 * A right-handed player facing the camera: guitar body on their right (the viewer's left), neck
 * toward the viewer's right. The strumming hand is over the body; the other hand frets the neck.
 */
function FrettingHand() {
  return (
    <g>
      <line x1="102" y1="70" x2="132" y2="66" />
      <Hand x={138} y={62} angle={-20} />
    </g>
  );
}

export function RaiseHandIll({ label }: { label: string }) {
  return (
    <Frame label={label}>
      <Person x={80} headY={28} />
      <Guitar x={66} y={92} />
      <FrettingHand />
      <line x1="58" y1="70" x2="42" y2="28" />
      <Hand x={40} y={22} angle={-20} color={BLUE} />
      <path d="M18 48 V16 M10 24 L18 14 L26 24" stroke={BLUE} />
    </Frame>
  );
}

export function StrikeIll({ label }: { label: string }) {
  return (
    <Frame label={label}>
      <Person x={80} headY={28} />
      <Guitar x={66} y={92} />
      <FrettingHand />
      <path d="M36 16 C12 34, 20 70, 58 82" stroke={BLUE} stroke-dasharray="4 4" />
      <path d="M48 74 L58 82 L46 86" stroke={BLUE} />
      <line x1="58" y1="70" x2="66" y2="80" />
      <Hand x={70} y={84} angle={30} color={BLUE} />
      <Burst x={70} y={92} color={BLUE} r0={14} r1={20} />
      <text x="170" y="34" text-anchor="middle" font-size="22" font-weight="700" fill={BLUE} stroke="none">
        ×3
      </text>
    </Frame>
  );
}

function HeadphonesOn({ x, headY }: { x: number; headY: number }) {
  return (
    <g stroke={AMBER}>
      <path d={`M${x - 15} ${headY + 2} A16 16 0 0 1 ${x + 15} ${headY + 2}`} stroke-width="2.6" />
      <rect x={x - 19} y={headY - 2} width="7" height="13" rx="3" fill={FILL} />
      <rect x={x + 12} y={headY - 2} width="7" height="13" rx="3" fill={FILL} />
    </g>
  );
}

export function DownloadTrackIll({ label }: { label: string }) {
  return (
    <Frame label={label}>
      <path d="M30 14 h36 l14 14 v68 h-50 z" fill={FILL} />
      <path d="M66 14 v14 h14" />
      <path d="M38 52 l5 -8 l5 16 l5 -12 l5 8 l5 -4 l5 4" stroke={BLUE} />
      <path d="M55 76 v16 M48 86 l7 7 l7 -7" />
      <path d="M92 58 H118" />
      <path d="M112 52 L120 58 L112 64" />
      <rect x="126" y="30" width="62" height="56" rx="8" fill={FILL} />
      <path d="M150 46 l16 12 l-16 12 z" fill={BLUE} stroke={BLUE} />
      <rect x="136" y="76" width="42" height="3" rx="1.5" opacity="0.4" />
    </Frame>
  );
}

export function HeadphonesPlayIll({ label }: { label: string }) {
  return (
    <Frame label={label}>
      <Person x={70} headY={36} />
      <HeadphonesOn x={70} headY={36} />
      <path d="M104 40 q8 -8 0 -16 M112 46 q14 -14 0 -28" stroke={BLUE} />
      <rect x="128" y="40" width="58" height="46" rx="8" fill={FILL} />
      <path d="M150 52 l14 11 l-14 11 z" fill={BLUE} stroke={BLUE} />
    </Frame>
  );
}

export function EarCupMicIll({ label, beeps }: { label: string; beeps: string }) {
  return (
    <Frame label={label}>
      <line x1="70" y1="112" x2="70" y2="70" />
      <line x1="52" y1="112" x2="88" y2="112" />
      <rect x="58" y="22" width="24" height="50" rx="12" fill={FILL} />
      <path d="M62 34 h16 M62 42 h16 M62 50 h16" opacity="0.5" />
      <g stroke={AMBER}>
        <rect x="84" y="24" width="20" height="40" rx="9" fill={FILL} stroke-width="2.4" />
        <path d="M104 30 C150 20, 160 70, 140 104" stroke-width="2.6" />
      </g>
      <path d="M110 44 h-4" stroke={AMBER} />
      <g stroke={BLUE}>
        <path d="M148 22 q4 -6 8 0 t8 0" />
        <path d="M170 22 q4 -6 8 0 t8 0" />
      </g>
      <Label x={168} y={40} text={beeps} size={9} />
      <path d="M14 46 h30 M38 40 l6 6 l-6 6" stroke={AMBER} />
    </Frame>
  );
}
