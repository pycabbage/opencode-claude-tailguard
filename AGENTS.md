# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCode用プラグイン。Claude 4.6モデルで廃止された assistant message prefill に起因する `400 Bad Request` エラーを、メッセージ配列の変形で回避する。

OpenCodeのバグにより会話配列の末尾にassistantメッセージが残るケースがあり（空phantomメッセージ、タイミング問題、クロックスキュー等）、Claude 4.6 APIがこれを拒否する。本プラグインは `experimental.chat.messages.transform` フックで送信前にメッセージ配列を修正する。

## Commands

```bash
bun install          # 依存関係インストール
bun run lint         # Biome による lint/format チェック
bun test             # テスト実行
bun test --watch     # テストウォッチモード
```

## Architecture

- **エントリポイント**: `src/index.ts` — `Plugin` 型をエクスポート。`@opencode-ai/plugin` の `Hooks` インターフェースに登録するフック関数を返す
- **使用フック**: `experimental.chat.messages.transform` — LLM送信前のメッセージ配列全体を変形可能
- **設計書**: `REPORT.md` に根本原因分析、変形ロジック、型定義、パターン一覧が詳述されている。実装時は必ず参照すること

### 変形ロジック概要

1. 末尾メッセージが `role === "assistant"` でなければ何もしない
2. 末尾から連続する空assistantメッセージを削除（空 = コンテンツ保持パートが0個）
3. 削除後もまだ末尾がassistantなら、合成 `"Continue."` userメッセージを追加

### パート分類の注意点

- **ReasoningPart**: `text.length > 0` または `metadata` にsignatureキーがあれば「コンテンツ保持」。署名付きthinkingブロックは削除不可
- **ToolPart / FilePart**: 常にコンテンツ保持
- **StepStartPart / StepFinishPart / SnapshotPart 等**: 構造のみ（コンテンツなし）

## Bun Runtime

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Use `bunx <package>` instead of `npx <package>`
- Bun automatically loads .env, so don't use dotenv

### Bun APIs

- `Bun.serve()` for HTTP/WebSocket (not express)
- `bun:sqlite` for SQLite (not better-sqlite3)
- `Bun.file` over `node:fs` readFile/writeFile
- `Bun.$\`cmd\`` instead of execa

### Testing

```ts
import { test, expect } from "bun:test";
```

## Code Style

Biome (biome.json) enforces:
- インデント: スペース
- クォート: ダブルクォート
- セミコロン: 不要な場合省略 (`asNeeded`)
- トレイリングカンマ: ES5準拠
- import整理: 自動

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`
- ターゲット: ESNext, モジュール: Preserve
- 型のみのインポートには `import type` を使用すること（verbatimModuleSyntax要件）
