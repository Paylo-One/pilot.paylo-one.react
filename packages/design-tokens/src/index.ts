export const colors = {
  light: {
    background: "#f4f5f7",
    surface: "#fbfbfd",
    surfaceElevated: "#ffffff",
    surfaceSunken: "#eef0f3",
    command: "#16181d",
    textPrimary: "#16181d",
    textSecondary: "#565d68",
    textMuted: "#878d98",
    textInverse: "#f7f8fa",
    border: "#e3e5ea",
    borderStrong: "#cdd1d8",
    accent: "#157a86",
    accentPressed: "#0d4f57",
    accentTint: "#e4f1f2",
    accentOn: "#ffffff",
    info: "#3f6e8f",
    infoTint: "#e8eff5",
    success: "#2f7d5b",
    successTint: "#e7f1ec",
    warning: "#8a6514",
    warningTint: "#f5edda",
    danger: "#9e3c34",
    dangerTint: "#f3e5e4",
  },
  dark: {
    background: "#0e1014",
    surface: "#15181e",
    surfaceElevated: "#1b1f27",
    surfaceSunken: "#0a0c0f",
    command: "#07090c",
    textPrimary: "#e8eaed",
    textSecondary: "#a0a6b0",
    textMuted: "#6c727d",
    textInverse: "#16181d",
    border: "#262b33",
    borderStrong: "#38404b",
    accent: "#2aa7b5",
    accentPressed: "#1f8b97",
    accentTint: "#11353a",
    accentOn: "#07181a",
    info: "#7aafc6",
    infoTint: "#162432",
    success: "#4caa82",
    successTint: "#102a1e",
    warning: "#c9a04e",
    warningTint: "#2a2010",
    danger: "#cf6b60",
    dangerTint: "#2e1914",
  },
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
  xxl: 64,
} as const;

export const radius = {
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  pill: 999,
} as const;

export const typography = {
  fontFamily: {
    body: "IBM Plex Sans",
    mono: "IBM Plex Mono",
  },
  size: {
    h1: 30,
    h2: 22,
    h3: 17,
    body: 15,
    small: 13,
    label: 11,
  },
  lineHeight: {
    tight: 1.18,
    snug: 1.4,
    normal: 1.6,
  },
} as const;

export const elevation = {
  flat: 0,
  card: 1,
  overlay: 8,
} as const;

export const zIndex = {
  content: 0,
  sticky: 10,
  overlay: 100,
  modal: 200,
} as const;
