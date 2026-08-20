// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/application/**",
                "@/composition/**",
                "@/features/**",
                "@/infrastructure/**",
                "expo*",
                "react*",
              ],
              message: "The domain layer must remain framework- and adapter-independent.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/application/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/composition/**",
                "@/features/**",
                "@/infrastructure/**",
                "expo*",
                "react*",
              ],
              message: "The application layer may depend only on domain contracts and ports.",
            },
          ],
        },
      ],
    },
  },
]);
