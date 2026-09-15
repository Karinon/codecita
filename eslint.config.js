import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-plugin-prettier/recommended";
import pluginPromise from "eslint-plugin-promise";
import globals from "globals";
import ts from "typescript-eslint";

export default [
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: ["node_modules", "dist", "tools", "src/pcodec.wasm"],
  },

  // js
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      camelcase: "warn",
      eqeqeq: "error",
      strict: "error",
      "max-lines-per-function": [
        "warn",
        { max: 50, skipComments: true, skipBlankLines: true },
      ],
      "no-confusing-arrow": ["error", { allowParens: false }],
    },
  },
  importPlugin.flatConfigs.recommended,
  {
    rules: {
      "import/no-unresolved": "off",
      "import/named": "off",
      "import/namespace": "off",
      "import/default": "off",
      "import/no-named-as-default-member": "off",
      "import/order": [
        "warn",
        {
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],
    },
  },

  pluginPromise.configs["flat/recommended"],

  // ts
  ...ts.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  prettier,
  {
    rules: {
      "prettier/prettier": "warn",
    },
  },
  // prettier disables style rules, re-enable curly
  {
    rules: {
      curly: "warn",
    },
  },
];
