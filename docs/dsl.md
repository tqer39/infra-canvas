# Infra Canvas DSL 仕様 v1

DSL は宣言的な構成図です。構文と参照の検証は、実際のクラウド構成の妥当性を保証しません。
設計案を記述でき、HTML、JavaScript、ループ、条件分岐は実行しません。

## 基本構文

```text
diagram "Web アプリケーション" version=1 {
  account prod "本番" {
    vpc main region="ap-northeast-1" {
      subnet public_a public az="ap-northeast-1a"
      subnet private_a private az="ap-northeast-1a"
      aws.alb web "ロードバランサー" subnets=[public_a]
      aws.ecs api "API" subnets=[private_a]
      sg application members=[web, api]
      sg monitoring members=[api]
    }
  }
  github.actions pipeline "CI/CD"
  web -> api kind=traffic protocol=http port=8080
  pipeline -> api kind=deploy
  view overview level=overview
  view service level=service
  view network level=subnet
  view security level=resource overlay=sg direction=RIGHT
}
```

図は `diagram "タイトル" version=1 { ... }` で囲みます。`version` を省略すると `1` です。
各宣言は改行または `;` で区切ります。`#` と `//` から行末まではコメントです。
配列内では改行も使用できます。

リソース宣言は `種別 ID "表示名" 属性名=値 ...` です。表示名を省略すると ID を表示します。
ID は図全体で一意です。入れ子でも同じ名前を再利用できません。前方参照は使用できます。
ID と種別は英字または `_` で始まり、後続に英数字、`_`、`.`、`:`、`-` を使用できます。
ID は表示名や座標から独立しています。`view` ID も同じ名前空間に含まれます。

属性値は二重引用符で囲んだ文字列、有限数、`true` / `false`、文字列の配列です。
単純な ID 形式の文字列は引用符を省略できます。
引用符、改行、バックスラッシュなどのエスケープは JSON の文字列規則に従います。
配列は `[id_a, id_b]` または `["タグ 1", "タグ 2"]` と書きます。
未知の属性や重複属性はエラーです。

## 種別と所属

入れ子にできる境界は `account`、`project`、`subscription`、`region`、`vpc`、`network`、
`subnet`、`group`、`module` です。子は一つの直接の親に所属します。

サービス種別は `aws.ecs`、`gcp.compute`、`azure.vm`、`github.actions` などです。
SaaS の対応型は `saas.github`、`saas.1password`、`saas.linear`、`saas.gitlab`、`saas.neon`、
`saas.fly`、`saas.resend`、`saas.elasticsearch`、`saas.kibana` です。
[アイコン対応表と利用条件](assets.md) と [サービス連携の例](../examples/saas.infra) を参照してください。
未対応の種別も解析して代替表示で残します。アイコン対応表は拡張できます。

`subnet ID public` / `private` / `unknown` の短縮形は `subnetType` 属性になります。
設計 DSL の宣言上の意図です。Terraform 取り込みは別途ルート設定の根拠を使用します。

`subnets=[a, b]` は複数 Subnet への配置設定を表します。単一の実体が両方に存在するとは解釈しません。
参照先が存在し、`subnet` 種別であることを検証します。
`sg ID members=[api, db]` は関連を示します。SG は排他的な境界ではありません。
一つのリソースを複数の SG に関連付けられます。
リソース側の `securityGroups=[sg_a, sg_b]` も使用できます。
SG の関連や許可規則だけで通信成立を断定しません。

## 属性

| 型         | 属性名                                                                                   | 用途                       |
| ---------- | ---------------------------------------------------------------------------------------- | -------------------------- |
| 文字列     | `description`, `region`, `az`, `cidr`, `protocol`                                        | 説明、配置設定             |
| 文字列     | `account`, `project`, `subscription`, `scope`, `environment`                             | 管理スコープ               |
| 文字列     | `status`, `network`, `routeEvidence`, `provider`, `role`, `url`, `version`, `subnetType` | 表示メタデータ             |
| 文字列配列 | `subnets`, `members`, `securityGroups`, `dependsOn`                                      | リソース ID 参照           |
| 文字列配列 | `tags`, `unresolved`                                                                     | タグ、未解決情報           |
| 数値       | `port`, `width`, `height`, `x`, `y`, `line`                                              | 属性情報・将来の配置保存用 |
| boolean    | `public`, `unknown`, `fixed`                                                             | 属性情報・将来の固定配置用 |
| 文字列     | `meta.*`                                                                                 | 拡張用のテキスト属性       |

`width`、`height`、`x`、`y`、`fixed` は保持されますが、初期版の ELK 自動配置への固定指定は未対応です。

Terraform アダプターの属性として `terraformType`、`availability_zone`、`cidr_block`、
`instance_type`、`engine`、`engine_version`、`placement`、`subnetVisibility` も文字列で受け付けます。

取り込み元は `sourceKind="plan"` / `"state"` / `"static"` / `"design"` と、
`repository`、`commit`、`root`、`address`、`file`、`line` に保存します。
`serializeDSL` は構成モデルの `provenance` と `unresolved` をこれらの属性へ書き出します。
`parseDSL` は同じ情報を復元します。ソース位置が未確定なら省略します。

## 型付き接続

```text
web -> api kind=traffic protocol=https port=443
api -> database kind=dependency label="構成上の依存"
pipeline -> role kind=auth protocol=oidc
role -> api kind=deploy
sg -> api kind=association
```

`kind` は `traffic`、`dependency`、`auth`、`deploy`、`association` です。省略時は `traffic` です。
接続には `protocol`、`port`、`label`、`description` も指定できます。
`port` は 0 から 65535 の整数です。端点は宣言されたリソースの ID を指定します。
Terraform の参照と `depends_on` は `dependency` であり、通信の証拠として扱いません。

## 表示設定

`view ID level=値 overlay=sg direction=RIGHT` を図の中で宣言します。
`level` は `overview`、`service`、`subnet`、`resource` です。
`direction` は `RIGHT` または `DOWN` です。`overlay` は現在 `sg` のみ対応します。

- `overview`: アカウント、プロジェクト、サブスクリプションを折りたたみます。
- `service`: Subnet の中に直接配置した実体を Subnet に集約します。
- `subnet`: Subnet 配置設定の関連線を表示します。
- `resource`: 個々のリソースを表示します。`overlay=sg` で SG と関連線を追加します。

表示 API の `collapsed` は明示的に折りたたむ境界 ID の配列です。
`expanded` は view による自動折りたたみから除外する境界 ID の配列です。
明示した `collapsed` が優先されます。

非表示の子の端点は、表示中の祖先境界に集約します。同じ端点、方向、kind、属性の線は集約し、
`originalIds` に元の接続 ID を残します。異なる kind、方向、protocol は混合しません。
折りたたんだ内部だけの接続は省略し、展開すると原図から復元します。
表示操作では共通モデルを変更しません。

## 診断と修正例

```text
diagram "修正前" {
  aws.ecs api subnets=[missing]
}
```

診断は `reference.missing`、2 行 24 列です。`missing` を宣言してください。
診断の行・列は 1 から始まり、列は JavaScript 文字列の UTF-16 コード単位です。
構文エラー時は最初の回復不能な箇所で停止します。属性・参照エラーは複数をまとめて返します。
エラーがあると `ParseResult.diagram` は返しません。

```text
diagram "修正後" {
  subnet private_a private
  aws.ecs api subnets=[private_a]
}
```

`id.duplicate` は ID を変更して参照も更新します。
`attribute.type` は属性値の型または許可値を修正します。
`attribute.unknown` は属性名の誤記を直すか、独自のテキスト情報を `meta.note="値"` として保存します。
`reference.type` は Subnet や SG の参照先の種別を確認します。

## 公開 API

```typescript
import { parseDSL, validateDiagram, buildDisplayGraph, layoutGraph, serializeDSL } from 'infra-canvas';

const result = parseDSL(source);
if (!result.diagram) throw new Error(JSON.stringify(result.diagnostics));
const diagram = validateDiagram(result.diagram);
const graph = buildDisplayGraph(diagram, { view: 'security', collapsed: [] });
const placement = await layoutGraph(graph, { direction: 'RIGHT' });
const dsl = serializeDSL(result.diagram);
```

`validateDiagram(value)` は外部 JSON の型、有限属性値、親境界、循環、参照、表示設定、ソース情報を検証します。
不正な入力は修正や推測で埋めず例外を返します。CLI とブラウザの JSON 読み込みは共通の検証を使用します。

共通モデル、表示モデル、配置を分離しています。ノードの配置座標は直接の親に対する相対座標です。
`LayoutResult.edges` の接続経路とラベル中心は図全体の絶対座標です。ELK が計算した直交経路を保持し、
ラベルのテキスト寸法も配置へ渡します。入れ子の辺は `container` の親座標を累積して変換します。
ELK のアルゴリズム、seed、入力 ID 順序を固定します。同じ入力と同じライブラリ版で配置を検証します。
小さな変更による既存位置の維持は保証しません。`durationMs` は各実行の測定値で、再現性比較の対象外です。

## LLM への生成指示

「DSL v1 の `diagram` 一つを書いてください。ID を図全体で一意にしてください。
クラウドの管理境界を入れ子で示し、複数 Subnet と SG は配列で関連付けてください。
接続の意図に合う `kind` を付け、通信の根拠がなければ `dependency` を使ってください。
未知の所属を推測せず `unresolved` に記録してください。機密値を含めないでください。
`parseDSL` の診断があれば対象行を修正してください。」

実例は `examples/aws.infra`、`examples/gcp-azure.infra`、`examples/multicloud.infra`、
`examples/large.infra` にあります。大規模例はサービス 300 個、境界 18 個、接続 299 本です。
