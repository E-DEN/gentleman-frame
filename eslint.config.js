// eslint.config.js — gentleman-frame コードスタイルルール
// 使い方: npx eslint js/
export default [
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        FileReader: 'readonly',
        AudioContext: 'readonly',
        OffscreenCanvas: 'readonly',
        createImageBitmap: 'readonly',
        alert: 'readonly',
        lucide: 'readonly',
        t: 'readonly',
        GFRainEngine: 'readonly',
      },
    },
    rules: {
      // ---- コメントスタイル ----
      // // の後にスペースを必須とする
      // セクション区切りの形式: // ---- 説明 ---- （ダッシュ4本・説明前後にスペース）
      'spaced-comment': ['error', 'always'],

      // /** */ ブロックコメント禁止 → // コメントに統一
      'multiline-comment-style': ['error', 'separate-lines'],

      // ---- 空行ルール ----
      // 連続空行は最大1行まで（2行以上禁止）
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 1, maxBOF: 0 }],

      // ---- 変数宣言 ----
      // var 禁止（const / let のみ）
      'no-var': 'error',

      // 再代入のない変数は const に（破壊的代入は警告のみ）
      'prefer-const': ['warn', { destructuring: 'any' }],

      // ---- 等値比較 ----
      // == 禁止・=== 必須（null チェックのみ例外）
      'eqeqeq': ['error', 'always', { null: 'ignore' }],

      // ---- 未使用変数 ----
      // _ プレフィックスの引数は意図的なので警告対象外
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // rain.js は Codrops 由来のレガシー IIFE コード（var 使用を許容）
    files: ['js/rain.js'],
    rules: {
      'no-var': 'off',
      'prefer-const': 'off',
    },
  },
];
