// Tailwind CSS v4 via PostCSS. The app keeps its hand-authored global CSS
// (design tokens + component layer shared with the marketing site); Tailwind
// is imported without preflight so utilities coexist with that layer rather
// than replacing it. Token bridging lives in app/globals.css (@theme inline).
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
