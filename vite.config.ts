import { defineConfig } from "vite";
import cssnano from "cssnano";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// L6 Build-3: CSS color の minify。
//   stylelint の `color-function-notation: modern` でソース側は modern を維持する一方、
//   ビルド成果物 (dist) は cssnano の colormin preset で `rgb(0 0 0 / .5)` のような
//   表記を短い hex/hsl に圧縮する (例: `#000` / `#00000080`)。
//   `lite` preset の colormin だけを有効化し、それ以外 (cssDeclarationSorter 等) は
//   既存 vite のデフォルト minifier (esbuild) と被らないよう保守的に絞る。
//
// なぜ全体 preset ではなく colormin のみか:
//   - Vite 7 は本体に esbuild の CSS minifier を内蔵しており、
//     セレクタや空白の圧縮はそれで十分。
//   - 色表記の短縮 (hex 化) は esbuild の対象外であり、cssnano の colormin が
//     最小単位で補完する役割を担う。
export default defineConfig(() => ({
  clearScreen: false,
  // Path alias: `@/*` -> `src/*` を tsconfig.app.json と一致させる。
  // tsc は paths を解決できるが、Vite (esbuild + rollup) は別途
  // resolve.alias の設定が必要なため、ここで同じマッピングを宣言する。
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  css: {
    postcss: {
      plugins: [
        cssnano({
          preset: ["lite", { colormin: true }],
        }),
      ],
    },
  },
  server: {
    port: 1421,
    strictPort: true,
    host: host ?? false,
    hmr: host ? { protocol: "ws", host, port: 1422 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
