/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Archivo Variable", "Archivo", "system-ui", "sans-serif"],
        sans: ["Manrope Variable", "Manrope", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"]
      },
      colors: {
        ink: "#0B0A14",
        panel: "#13111E",
        raised: "#1B1829",
        line: "#2A2640",
        cream: "#F4EEE1",
        muted: "#9A93AD",
        violet: { DEFAULT: "#6C47FF", light: "#9D85FF", soft: "#221A48" },
        sun: { DEFAULT: "#F5B83D", soft: "#2B2213" },
        mint: { DEFAULT: "#3DDC97", soft: "#12291F" },
        rose: { DEFAULT: "#FF6B6B", soft: "#2D1418" }
      }
    }
  },
  plugins: []
};
