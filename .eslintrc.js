module.exports = {
    root: true,
    parser: "@typescript-eslint/parser",
    env: {
        node: true,
        es6: true
    },
    plugins: [
        "@typescript-eslint",
    ],
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
    ],
    rules: {
        "semi": "off",
        "@typescript-eslint/semi": ["error", "always"],
        "quotes": "off",
        "@typescript-eslint/quotes": ["error", "double"],
        "indent": "off",
        "@typescript-eslint/indent": ["error", 4, { "MemberExpression": 1, "SwitchCase": 0 }]
    }
};
