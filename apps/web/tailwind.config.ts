import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // RatesAssist brand
        ink: {
          50: "#f7f8fa",
          100: "#eef0f4",
          200: "#dde2ea",
          300: "#bac3d0",
          400: "#8a96a8",
          500: "#5c6878",
          600: "#3f495a",
          700: "#2c3543",
          800: "#1d2531",
          900: "#0f141c",
        },
        accent: {
          50: "#eef6ff",
          100: "#d8eaff",
          200: "#b2d3ff",
          300: "#82b5ff",
          400: "#4d8ffb",
          500: "#2a6cf0",
          600: "#1a52d4",
          700: "#163fa6",
          800: "#163784",
          900: "#15306b",
        },
        success: {
          50: "#ecfdf5",
          100: "#d1fae5",
          300: "#6ee7b7",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
        },
        warn: {
          50: "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
        },
        critical: {
          50: "#fef2f2",
          100: "#fee2e2",
          300: "#fca5a5",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
        },
      },
      fontFamily: {
        sans: ["Arial", "Helvetica", "sans-serif"],
        mono: ["Arial", "Helvetica", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
