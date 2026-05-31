import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";

// Mira (Vanilla TS + 自作 Store<T>) 用の ESLint flat config。
// StellaRecord (React 構成) と異なり React 系プラグインは含めない。
// レイヤ境界は no-restricted-imports で機械的に強制する:
//   - utils はリーフ層 (他のレイヤを参照禁止)
//   - state / api はそれぞれ低位層 (上位レイヤ参照禁止)
//   - pages 間の相互参照禁止
export default tseslint.config(
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    plugins: {
      unicorn,
    },
    rules: {
      "unicorn/prefer-at": "error",
      "unicorn/prefer-string-replace-all": "error",
      "unicorn/no-array-for-each": "off",
      "unicorn/prefer-array-flat": "error",
      "unicorn/prefer-module": "error",
      "unicorn/no-array-reduce": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/filename-case": "off",
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        {
          selector: "function",
          format: ["camelCase", "PascalCase"],
        },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: true,
          allowAny: false,
          allowNullish: true,
          allowRegExp: false,
        },
      ],
      // Vanilla DOM 実装では addEventListener / setTimeout に async 関数を直接渡す場面が多く、
      // 戻り値 void を要求する箇所での async 渡しが普通になる。voidReturn 系のみ無効化。
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
      // 一時的な fire-and-forget / autoplay 抑制等で意図的な空 catch を許す
      "@typescript-eslint/no-empty-function": ["error", { allow: ["arrowFunctions"] }],
      // DOM 中心の Vanilla 実装で `addEventListener` 等の戻り値を捨てる場面が多い
      "@typescript-eslint/no-confusing-void-expression": "off",
      // 非同期処理の浮きは厳格に: void 演算子か .catch() を明示
      "@typescript-eslint/no-floating-promises": "error",
      // catch (e: unknown) に統一
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
    },
  },

  // utils はリーフ層: 他のレイヤを参照禁止
  {
    files: ["src/utils/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../pages/*", "../../pages/*"], message: "utils から pages 参照禁止" },
            {
              group: ["../components/*", "../../components/*"],
              message: "utils から components 参照禁止",
            },
            {
              group: ["../services/*", "../../services/*"],
              message: "utils から services 参照禁止",
            },
            { group: ["../state/*", "../../state/*"], message: "utils から state 参照禁止" },
            {
              group: ["../animations/*", "../../animations/*"],
              message: "utils から animations 参照禁止",
            },
            { group: ["../api/*", "../../api/*"], message: "utils から api 参照禁止" },
          ],
        },
      ],
    },
  },

  // state はリーフ層に近い: pages/components/services/animations を参照禁止
  {
    files: ["src/state/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../pages/*", "../../pages/*"], message: "state から pages 参照禁止" },
            {
              group: ["../components/*", "../../components/*"],
              message: "state から components 参照禁止",
            },
            {
              group: ["../services/*", "../../services/*"],
              message: "state から services 参照禁止",
            },
            {
              group: ["../animations/*", "../../animations/*"],
              message: "state から animations 参照禁止",
            },
          ],
        },
      ],
    },
  },

  // api はリーフ層: 上位レイヤ参照禁止
  {
    files: ["src/api/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../pages/*", "../../pages/*"], message: "api から pages 参照禁止" },
            {
              group: ["../components/*", "../../components/*"],
              message: "api から components 参照禁止",
            },
            { group: ["../services/*", "../../services/*"], message: "api から services 参照禁止" },
            {
              group: ["../animations/*", "../../animations/*"],
              message: "api から animations 参照禁止",
            },
          ],
        },
      ],
    },
  },

  // services は上位 (pages/components) を参照禁止
  {
    files: ["src/services/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../pages/*", "../../pages/*"], message: "services から pages 参照禁止" },
            {
              group: ["../components/*", "../../components/*"],
              message: "services から components 参照禁止",
            },
          ],
        },
      ],
    },
  },

  // animations は utils/types のみ参照可
  {
    files: ["src/animations/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../pages/*", "../../pages/*"], message: "animations から pages 参照禁止" },
            {
              group: ["../components/*", "../../components/*"],
              message: "animations から components 参照禁止",
            },
            {
              group: ["../services/*", "../../services/*"],
              message: "animations から services 参照禁止",
            },
            { group: ["../api/*", "../../api/*"], message: "animations から api 参照禁止" },
          ],
        },
      ],
    },
  },

  // pages 同士の相互参照禁止 (例: HomePage が CalendarPage を import 等)
  {
    files: ["src/pages/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../calendar/*", "../home/*", "../settings/*", "../debug/*"],
              message: "pages 間の直接参照禁止 (共通処理は utils/ へ)",
            },
          ],
        },
      ],
    },
  },

  // tsconfig project 設定 (vite.config.ts は別 project から扱う想定だが、Mira は単一 tsconfig)
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // vite.config.ts / vitest.config.ts は tsconfig.json の include 外なので type-aware rules を全部 off
  {
    files: ["vite.config.ts", "vitest.config.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      "src-tauri/tauri.conf.json",
      "tauri.conf.json",
      "eslint.config.js",
    ],
  },
);
