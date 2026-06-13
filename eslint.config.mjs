import next from "eslint-config-next";

// eslint-config-next 16 ships a native flat-config array. Spread it directly
// (same approach as the marketing site) rather than wrapping legacy configs.
const eslintConfig = [
  ...next,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "apps/mobile/**",
      "supabase/**",
    ],
  },
];

export default eslintConfig;
