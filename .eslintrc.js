module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    env: {
        node: true,
        es6: true
    },
    plugins: [
        '@typescript-eslint',
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    rules: {
        'semi': 'off',
        '@typescript-eslint/semi': ['error', 'always'],
        'quotes': 'off',
        '@typescript-eslint/quotes': ['error', 'single'],
        'indent': 'off',
        '@typescript-eslint/indent': ['error', 4, { 'MemberExpression': 1, 'SwitchCase': 0 }],
        'no-multiple-empty-lines': ['error', { 'max': 1, 'maxEOF': 0 }],
        '@typescript-eslint/no-floating-promises': ['error'],
        '@typescript-eslint/no-for-in-array': ['error']
    },
    overrides: [{
        files: ['*.ts'],
        parserOptions: {
            project: ['./tsconfig.json']
        }
    }]
};
