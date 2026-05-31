import { defineConfig } from "vitest/config";

// Vitest 専用設定。純粋ロジック (utils / state) のユニットテストのみを対象とし、
// DOM を要する UI コンポーネントは対象外 (environment: node)。
// StellaRecord と同じく、副作用のない関数を中心にコロケーション (*.test.ts) でテストする。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/utils/**/*.ts", "src/state/**/*.ts"],
    },
  },
});
