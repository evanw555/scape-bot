module.exports = {
    "root": true,
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "ecmaVersion": 2017
    },
    "env": {
        "es6": true,
        "node": true
    },
    "plugins": [
        "@typescript-eslint",
    ],
    "extends": [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
    ],
    "rules": {
        // add custom rules here
        // https://eslint.org/docs/rules/
        "indent": ["error", 4, { "MemberExpression": 1, "SwitchCase": 1 }], // use 4 spaces
        "quotes": ["error", "single"], // use double quotes
        "no-plusplus":  ["error", { "allowForLoopAfterthoughts": true }],
        "no-unused-vars": ["error", { "args": "none" }],
        "no-shadow": ["error", { "allow": ["err", "error", "res", "response", "body", "req", "result"] }],
        "quote-props": ["error", "consistent"],
        "arrow-parens": ["error", "as-needed", { "requireForBlockBody": true }],
        "semi": ["error", "always"],
        "max-len": 0, // ["error", { "code": 80, ignoreUrls: true }] disabled for now, but probably a good idea to enforce
        "linebreak-style": 0, // to disable a rule, set the value to 0
        "no-param-reassign": 0,
        "comma-dangle": 0,
        "consistent-return": 0,
        "no-underscore-dangle": 0,
        "arrow-body-style": 0,
        "camelcase": 0,
        "no-console": 0,
        "no-loop-func": 0,
        "import/no-dynamic-require": 0,
        "no-prototype-builtins": 0,
        "@typescript-eslint/semi": ["error", "always"],
        "@typescript-eslint/quotes": ["error", "double"],
        "@typescript-eslint/indent": ["error", 4, { "MemberExpression": 1, "SwitchCase": 0 }]
    }
};
