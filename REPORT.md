# OpenCode Claude 4.6 Assistant Message Prefill エラー調査報告

## 1. 問題の概要

OpenCodeでClaude Opus 4.6 / Sonnet 4.6モデルを使用すると、以下のエラーが頻発しセッションが停止する:

```
This model does not support assistant message prefill.
The conversation must end with a user message.
```

- **影響バージョン**: OpenCode 1.2.4以降（Claude 4.6モデル利用時）
- **影響プロバイダ**: Anthropic直接API, GitHub Copilot, OpenRouter, AWS Bedrock, Google Vertex AI — 全プロバイダ共通
- **影響インターフェース**: Web UI, TUI（TUIは発生頻度が低い）
- **GitHub Issue**: [anomalyco/opencode#13768](https://github.com/anomalyco/opencode/issues/13768) (2026-02-15起票, OPEN, 42コメント, 18リアクション)

## 2. Anthropic APIの破壊的変更

Claude 4.6モデル（Opus 4.6, Sonnet 4.6）およびSonnet 4.5で、**assistant message prefillが廃止**された。

従来のClaude 3.x / 4.5 Opusでは、会話の末尾にassistantロールのメッセージを配置して応答の「前書き」を制御する「prefill」テクニックが使用可能だったが、Claude 4.6ではこれが完全に削除され、試みると `400 Bad Request` が返る。

Anthropicは以下の代替手段を推奨している:
- `output_config.format` による構造化出力
- System promptでの応答形式指示
- Tool use (strict mode)

参考:
- [Anthropic: Prefill Claude's response](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prefill-claudes-response)
- [Anthropic: Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)

## 3. OpenCodeにおける根本原因

5つの独立した原因が特定されている。いずれも最終的に「会話配列の末尾がassistantメッセージになる」という同一の結果を引き起こす。

### 原因A: エージェントループのタイミング問題（主因）

ツール呼び出し完了後、5〜21msで空のassistantメッセージが生成され末尾に残る。ツール結果（Anthropic APIではrole: "user"）が最終メッセージとなるべきだが、直後に生成されたassistantメッセージがそれを上書きする。

**根拠**: [#13768 コメント14](https://github.com/anomalyco/opencode/issues/13768) (@bekworks) — 4件のエラーインスタンスすべてで「ツール完了 → 5-21ms → 0パーツのassistantターン失敗」のパターンを確認。

### 原因B: Web UIのphantomメッセージ

`opencode web`モードでは、各assistant応答完了後に自動的に空の第2 assistantターンが送信される。特徴: `step-start` + `step-finish` のみ、テキストコンテンツなし、負のコスト値(-0.0025166)、負の入力トークン値(-25197)。

**根拠**: [#13768 コメント7](https://github.com/anomalyco/opencode/issues/13768) (@Yiximail) — セッションエクスポートで確認。

### 原因C: Web UIのID比較とクロックスキュー

`prompt.ts` のエージェントループ終了条件:

```typescript
if (
  lastAssistant?.finish &&
  !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
  lastUser.id < lastAssistant.id  // ← タイムスタンプベースのID比較
) {
  break
}
```

Web UIではメッセージIDがクライアント側で事前生成され、assistantメッセージIDはサーバー側で生成される。クライアントの時刻がサーバーより進んでいると比較が失敗し、ループが終了せず余計なassistantメッセージが生成される。

**根拠**: [#13768 コメント24](https://github.com/anomalyco/opencode/issues/13768) (@nguquen) — `prompt.ts`のコード解析。

### 原因D: リモートWeb接続時のSSEイベントリスナーリーク

リモートSSE接続(`/global/event`)ごとに`global.ts:83`で新しいイベントリスナーが追加されるが、接続切断時にリスナーがクリーンアップされない。イベントが複数回発火し、重複処理によりphantom assistantメッセージが生成される。

**根拠**: [#13768 コメント12](https://github.com/anomalyco/opencode/issues/13768) (@Yiximail)

### 原因E: maxSteps到達時のassistantメッセージ

`maxSteps`が枯渇すると、OpenCodeは末尾に `{role: "assistant", content: "CRITICAL - MAXIMUM STEPS REACHED..."}` メッセージを追加する。

**根拠**: [#13768 コメント35](https://github.com/anomalyco/opencode/issues/13768) (@dennis-d859)。ただしバニラ構成ではmaxStepsが設定されないため発生頻度は低い。

### 補足: cache_control/prefillコードパス

モデルがテキストのみで応答した場合（`finish="stop"`）、次のリクエストに `cache_control` 付きのassistant prefillが含まれ、Claude 4.6で400エラーとなる。

### 補足: ストリーミングモードでのエラー隠蔽

ストリーミングモードではAnthropicが400を空ボディ（content-length: 0）で返すため、実際のエラーメッセージが完全に隠蔽される。error-recoveryミドルウェアがエラーテキストでパターンマッチできないため、プログラム的な回復も不可能。

## 4. 提出されたPR一覧と状態

| PR | 状態 | アプローチ | 概要 |
|---|---|---|---|
| [#14772](https://github.com/anomalyco/opencode/pull/14772) | **Open (未マージ)** | Safety net | `normalizeMessages()` 内で `stripTrailingAssistant()` を追加。`ProviderTransform.message()` チョークポイントで全リクエストをカバー |
| [#16883](https://github.com/anomalyco/opencode/pull/16883) | Closed | Root cause | `prompt.ts` の2行修正: max stepsメッセージのrole変更 + parentID比較によるクロックスキュー耐性 |
| [#16900](https://github.com/anomalyco/opencode/pull/16900) | Closed | Root cause | #16883の改訂版 |
| [#16921](https://github.com/anomalyco/opencode/pull/16921) | **Open (未マージ)** | Provider-specific | Copilot Claude用にuser-final維持 |
| [#18091](https://github.com/anomalyco/opencode/pull/18091) | **Open (未マージ)** | 複合修正 | normalizeMessagesにガード追加 + CSP/cache/idle timeout修正 |
| [#18421](https://github.com/anomalyco/opencode/pull/18421) | Closed | Synthetic message | `toModelMessages()` で末尾assistant検出時に合成 `"Continue."` userメッセージを追加 |

2026-03-28時点で**mainlineに修正は未マージ**。メンテナ @rekram1-node は3/26-27に調査を開始した段階。

## 5. プラグインによる解決策

### 使用するフック

```typescript
"experimental.chat.messages.transform"?: (
  input: {},
  output: { messages: { info: Message; parts: Part[] }[] }
) => Promise<void>;
```

OpenCodeの `@opencode-ai/plugin` が提供するexperimentalフック。LLMに送信されるメッセージ配列全体を変形可能。`toModelMessages()` の前段で呼ばれるため、最終的なAPI送信内容を制御できる。

### 変形制約

- **thinkingブロック（`ReasoningPart`）は削除不可**: signatureが付加されたthinkingディレクティブ（text=0文字でも）は保持・変形が必要
- **完全に空のブロックのみ削除可能**: text=0文字かつsignatureなしのパートは削除可能
- コンテンツを保持するassistantメッセージ自体の削除は不可

### パート分類基準

| Part type | コンテンツ保持の条件 |
|---|---|
| `TextPart` | `text.length > 0` |
| `ReasoningPart` | `text.length > 0` または `metadata` にsignature相当のキーが存在 |
| `ToolPart` | 常にコンテンツ保持 |
| `FilePart` | 常にコンテンツ保持 |
| `AgentPart` | `source` が存在する場合 |
| `StepStartPart`, `StepFinishPart`, `SnapshotPart`, `PatchPart`, `RetryPart`, `CompactionPart` | 構造のみ（コンテンツなし） |

メッセージ単位: コンテンツ保持パートが0個 → 空メッセージ

### 処理フロー

```
1. 末尾メッセージが role === "assistant" か?
   ├─ No → 終了（変形不要）
   └─ Yes
        2. 対象モデルか? (最新UserMessageの model.modelID を確認)
           ├─ No → 終了
           └─ Yes
                3. 末尾から連続するassistantメッセージを逆順走査
                   各メッセージについて:
                   ├─ 空メッセージ → 配列から削除 (pop)
                   └─ コンテンツ保持 → 維持（パート変更なし）
                4. 削除後、末尾がまだ assistant か?
                   ├─ No → 終了（空assistant除去だけで解決）
                   └─ Yes → 合成userメッセージを末尾に追加
                5. 終了
```

### 変形パターン一覧

| 入力パターン | 変形結果 |
|---|---|
| `[U, A(text+thinking)]` | `[U, A(text+thinking), U("Continue.")]` |
| `[U, A(text+thinking), A(empty)]` | `[U, A(text+thinking), U("Continue.")]` |
| `[U, A(empty)]` | `[U]` |
| `[U, A(empty), A(empty)]` | `[U]` |
| `[U, A(thinking署名付き text="")]` | `[U, A(thinking署名付き), U("Continue.")]` |
| `[U, A(tool+thinking)]` | `[U, A(tool+thinking), U("Continue.")]` |

### 合成userメッセージの構造

```typescript
{
  info: {
    role: "user",
    id: syntheticId(),           // 一意のID生成
    sessionID: <lastAssistantのsessionID>,
    time: { created: Date.now() },
    agent: <直近UserMessageのagent>,
    model: <直近UserMessageのmodel>,
  },
  parts: [{
    id: syntheticPartId(),
    sessionID: <同上>,
    messageID: <上記infoのid>,
    type: "text",
    text: "Continue.",
  }],
}
```

## 6. SDK型定義（参考）

### Message型 (`@opencode-ai/sdk` types.gen.d.ts)

```typescript
export type UserMessage = {
    role: "user";
    id: string;
    sessionID: string;
    time: { created: number };
    agent: string;
    model: { providerID: string; modelID: string };
    system?: string;
    tools?: { [key: string]: boolean };
};

export type AssistantMessage = {
    role: "assistant";
    id: string;
    sessionID: string;
    time: { created: number; completed?: number };
    error?: ProviderAuthError | UnknownError | ...;
    parentID: string;
    modelID: string;
    providerID: string;
    mode: string;
    cost: number;
    tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
    finish?: string;
};

export type Message = UserMessage | AssistantMessage;
```

### ReasoningPart型

```typescript
export type ReasoningPart = {
    id: string;
    sessionID: string;
    messageID: string;
    type: "reasoning";
    text: string;
    metadata?: { [key: string]: unknown };  // signatureはここに格納される
    time: { start: number; end?: number };
};
```

### toModelMessages() でのReasoningPart処理

`message-v2.ts` の `toModelMessages()` 内:

```typescript
if (part.type === "reasoning") {
    assistantMessage.parts.push({
      type: "reasoning",
      text: part.text,
      // 同一モデルの場合のみ providerMetadata (signature含む) を伝搬
      ...(differentModel ? {} : { providerMetadata: part.metadata }),
    })
}
```

`differentModel` が true の場合（現在のモデルと生成元モデルが異なる場合）、`providerMetadata`（signatureを含む）はストリップされる。signatureは同一モデルでのみ有効。

### Pluginフック型定義 (`@opencode-ai/plugin` index.d.ts)

```typescript
export interface Hooks {
    "experimental.chat.messages.transform"?: (
        input: {},
        output: { messages: { info: Message; parts: Part[] }[] }
    ) => Promise<void>;

    "experimental.chat.system.transform"?: (
        input: { sessionID?: string; model: Model },
        output: { system: string[] }
    ) => Promise<void>;

    "chat.params"?: (
        input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
        output: { temperature: number; topP: number; topK: number; options: Record<string, any> }
    ) => Promise<void>;
}
```

## 7. 未決定事項

1. **合成userメッセージのテキスト内容**: `"Continue."` が最適か、より明示的な指示が必要か
2. **ReasoningPart.metadata内のsignatureキー名**: Anthropic SDKの `providerMetadata` 仕様に依存。実装時に実際のmetadataをログ出力して確認が必要
3. **対象モデルのマッチングパターン**: `claude-opus-4-6`, `claude-opus-4.6` 等の表記揺れへの対応
4. **`experimental` フックの安定性**: APIが将来変更される可能性がある
