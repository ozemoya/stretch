import type { CSSProperties } from "react";

export type SketchIconName =
  | "bag" | "cart" | "milk" | "eggs" | "bread" | "produce"
  | "tag" | "coin" | "pump" | "car" | "map" | "list" | "arrow"
  | "star" | "bubble" | "badge";

type Props = {
  name: SketchIconName;
  size?: number;
  className?: string;
  label?: string;
  style?: CSSProperties;
};

const olive = "#61752A";
const peach = "#E6AD69";
const butter = "#F2CD64";
const sage = "#A6B68B";
const paper = "#F7F0DD";
const pngIcons: Partial<Record<SketchIconName, string>> = {
  bag: "/assets/icons/stretch-icon_1.png",
  coin: "/assets/icons/stretch-icon_2.png",
  map: "/assets/icons/stretch-icon_3.png",
  tag: "/assets/icons/stretch-icon_4.png",
  list: "/assets/icons/stretch-icon_5.png",
  cart: "/assets/icons/stretch-icon_6.png",
  car: "/assets/icons/stretch-icon_7.png",
};

export default function SketchIcon({ name, size = 72, className, label, style }: Props) {
  const png = pngIcons[name];
  if (png) return (
    <img
      className={`sketch-icon ${className ?? ""}`}
      src={png}
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      style={{ objectFit: "cover", ...style }}
    />
  );
  return (
    <svg
      className={`sketch-icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={style}
    >
      {name === "bag" && <>
        <path d="M28 38 Q58 34 93 39 L89 102 Q59 107 31 101 Z" fill={paper} />
        <path d="M43 40 V29 Q43 15 57 15 Q74 15 75 31 L75 39" />
        <path d="M49 40 V30 Q50 23 58 23 Q67 23 68 32 V40" />
        <path d="M42 64 Q57 51 77 64 Q71 83 59 88 Q46 81 42 64Z" fill={sage} />
        <path d="M59 63 Q56 56 60 49 M60 57 Q66 51 72 54" />
      </>}
      {name === "cart" && <>
        <path d="M13 27 L25 28 L37 79 L91 77 L101 38 L29 39" />
        <path d="M36 79 Q30 85 42 88 L90 87 M46 42 L51 74 M65 42 L66 74 M83 42 L79 74" />
        <circle cx="46" cy="97" r="6" fill={butter} /><circle cx="84" cy="96" r="6" fill={butter} />
        <path d="M36 17 Q44 10 52 18 M77 22 Q83 14 91 20" stroke={olive} />
      </>}
      {name === "milk" && <>
        <path d="M37 35 L44 22 L74 22 L83 36 L83 98 Q61 103 35 97 L35 37Z" fill={paper} />
        <path d="M44 22 L43 13 L75 13 L74 22 M37 35 L83 36 M44 22 L55 36 L55 100" />
        <path d="M59 54 Q72 45 79 57 L78 76 Q69 83 59 77Z" fill={sage} />
        <path d="M62 63 Q67 58 74 62" />
      </>}
      {name === "eggs" && <>
        <path d="M20 65 Q60 54 101 65 L94 93 Q63 102 27 92Z" fill={paper} />
        <path d="M20 65 L30 49 Q61 40 91 49 L101 65 M34 65 L36 88 M58 61 L59 97 M81 63 L82 92" />
        <path d="M32 49 Q26 25 38 22 Q49 25 47 49 M54 45 Q51 19 63 17 Q75 21 72 47 M78 48 Q78 27 88 25 Q98 29 93 51" fill={butter} />
      </>}
      {name === "bread" && <>
        <path d="M26 43 Q19 22 39 18 Q49 14 60 22 Q70 14 84 22 Q103 30 93 48 L93 91 Q62 101 26 92Z" fill={peach} />
        <path d="M26 43 Q59 51 93 48 M37 62 Q43 67 46 65 M60 70 Q65 73 69 70 M77 61 L82 64" />
      </>}
      {name === "produce" && <>
        <path d="M58 42 Q37 30 25 50 Q18 70 38 90 Q58 105 78 91 Q98 74 94 54 Q84 32 62 42" fill={peach} />
        <path d="M59 43 Q55 29 65 18 M60 36 Q76 16 92 25 Q82 38 60 36Z" fill={sage} />
        <path d="M35 61 Q29 72 38 81 M77 54 Q84 56 84 64" />
      </>}
      {name === "tag" && <>
        <path d="M16 58 L53 20 Q60 14 69 22 L103 54 Q108 62 100 70 L63 104 Q55 109 47 100 L16 69 Q11 64 16 58Z" fill={butter} />
        <circle cx="69" cy="39" r="6" fill={paper} />
        <path d="M43 68 Q54 56 67 67 Q74 75 65 83 Q53 91 41 79 M57 57 L53 90" />
      </>}
      {name === "coin" && <>
        <ellipse cx="58" cy="63" rx="40" ry="37" fill={butter} />
        <ellipse cx="58" cy="60" rx="32" ry="30" />
        <path d="M68 46 Q51 39 47 51 Q44 59 59 61 Q73 64 69 75 Q64 85 47 76 M58 39 V83" />
        <path d="M89 30 L96 21 M95 45 L106 44 M21 34 L13 28" />
      </>}
      {name === "pump" && <>
        <path d="M25 99 L25 34 Q26 21 39 21 L71 21 Q83 22 83 36 L83 99Z" fill={peach} />
        <path d="M36 36 L71 36 L71 60 L36 60Z" fill={paper} />
        <path d="M82 39 Q97 39 98 50 L99 76 Q98 86 91 84 Q86 82 86 73 L86 67 M91 41 L99 34 L108 44 L103 52 M20 100 H89" />
        <path d="M48 72 L58 67 L68 73 L60 82Z" fill={butter} />
      </>}
      {name === "car" && <>
        <path d="M18 72 L27 56 L41 49 L81 48 L95 59 L105 70 L104 88 L18 87Z" fill={peach} />
        <path d="M38 51 L46 32 L77 32 L88 53 M47 32 L47 53 M78 32 L80 53 M24 69 L35 69 M94 69 L102 71" />
        <circle cx="39" cy="88" r="9" fill={paper} /><circle cx="86" cy="88" r="9" fill={paper} />
        <path d="M56 20 Q59 16 64 20 M104 24 L109 20" />
      </>}
      {name === "map" && <>
        <path d="M15 29 L43 20 L73 29 L102 20 L104 91 L75 101 L45 91 L17 100Z" fill={paper} />
        <path d="M44 21 L45 91 M74 29 L75 100 M30 71 Q35 51 52 55 Q64 58 71 49 Q81 36 91 46" strokeDasharray="5 6" />
        <circle cx="31" cy="72" r="5" fill={sage} /><circle cx="90" cy="46" r="5" fill={peach} />
      </>}
      {name === "arrow" && <>
        <path d="M15 81 Q25 30 84 53 M72 32 L90 54 L65 66" strokeWidth="6" />
        <path d="M22 92 L18 97 M30 20 L36 15" stroke={peach} />
      </>}
      {name === "star" && <>
        <path d="M60 10 L68 42 L98 28 L79 55 L109 70 L75 73 L76 107 L58 81 L30 104 L41 71 L9 57 L43 51 L34 19 L57 42Z" fill={butter} />
        <path d="M18 22 L15 15 M97 11 L103 8 M106 95 L111 99" stroke={peach} />
      </>}
      {name === "bubble" && <>
        <path d="M17 26 Q57 8 101 28 Q112 59 94 80 Q73 93 48 83 L27 103 L30 78 Q10 63 17 26Z" fill={paper} />
        <path d="M32 48 Q42 41 50 49 M58 48 Q69 40 78 49 M37 65 Q61 76 82 61" />
      </>}
      {name === "badge" && <>
        <path d="M60 10 L71 19 L86 15 L91 31 L106 38 L101 54 L110 67 L96 78 L95 95 L77 96 L65 109 L51 101 L35 105 L29 90 L14 80 L21 64 L13 48 L28 39 L33 22 L48 24Z" fill={sage} />
        <path d="M37 61 L53 76 L83 44" strokeWidth="7" />
      </>}
    </svg>
  );
}
