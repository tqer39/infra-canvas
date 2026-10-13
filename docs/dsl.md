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

メトリクス・ログ・トレースの送信は、通信の接続に `signals` 属性で明記します。
`metrics`、`logs`、`traces` の空でない配列を使います。
矢印のラベルと接続の詳細に、日本語で送信データの種類を表示します。
同じ送信元・送信先でも `signals` が異なる接続は、折りたたみ後も別接続として保持します。

```text
api -> datadog kind=traffic signals=[metrics] protocol=https port=443
api -> datadog kind=traffic signals=[logs] protocol=https port=443
collector -> newrelic kind=traffic signals=[metrics,logs,traces] protocol="OTLP/HTTP" port=443
```

送信先には `saas.datadog`、`saas.newrelic` を使えます。
[observability.infra](../examples/observability.infra) は Fargate のサービスから Collector 経由で
両サービスへ送る設計例です。送信方式・認証・Collector の対応設定は実環境で確認し、
API キーやログの内容は DSL に記載しないでください。実際のデータ送信は行いません。

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

ビューアー上部の「矢印」で「直角」または「曲線」を選択できます。
曲線はベジェ曲線で描画し、ラベルも曲線の中央へ移します。
切り替えてもノード配置・パン・ズーム・接続の選択を保持します。
開発画面と単一 HTML で利用できます。この選択は表示中のセッションにのみ適用され、
DSL には保存しません。曲線では直角経路の障害物回避を利用しないため、
密集した図では他のノードと重なる場合があります。

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

## ECS と Elastic Beanstalk の詳細構成

`aws.ecs` は従来の概要表現として維持します。詳細には次の型を使います。

| 型                          | 意味                               | 入れ子                   |
| --------------------------- | ---------------------------------- | ------------------------ |
| `aws.ecs-cluster`           | ECS クラスター                     | サービス、単発タスクなど |
| `aws.ecs-service`           | タスク数を維持するサービス         | 設計・観測した実行タスク |
| `aws.ecs-task-definition`   | タスクの設計図・リビジョン         | コンテナ定義             |
| `aws.ecs-task`              | 起動するタスク                     | 実行コンテナ             |
| `aws.ecs-container`         | コンテナ定義または実行コンテナ     | なし                     |
| `aws.beanstalk-application` | アプリケーションの論理的なまとまり | 環境、アプリケーション版 |
| `aws.beanstalk-environment` | 版を実行する環境                   | 明示した管理下リソース   |
| `aws.beanstalk-version`     | 配備するアプリケーション版         | なし                     |

タスク定義はクラスターやサービスと別ノードで宣言し、複数サービス・単発タスクから
接続できます。サービスから定義への `dependency`、実行タスクから定義への `association`、
環境から版への `deploy` など、意図を明記します。入れ子境界は折りたたみ・展開・詳細移動できます。
`cpu` は CPU units、`memory` は MiB、`desiredCount` は希望タスク数の整数で指定します。
`memory` は正の整数、`cpu` と `desiredCount` は非負整数です。
`launchType=FARGATE` でサービスの実行方式を、
`requiresCompatibilities=[FARGATE]` でタスク定義の互換性を表現できます。
クラスターには `capacityProviders=[FARGATE,FARGATE_SPOT]` を記述できます。
CPU・メモリはタスク定義とコンテナに指定し、クラスター全体の容量とは区別します。
カードには CPU units と vCPU、MiB と GiB、希望タスク数を併記します。
既存の `meta.cpu`、`meta.memory`、`meta.desiredCount` の数値文字列も表示できますが、
標準属性を優先します。`meta.tier` などは拡張テキスト属性で記述できます。
この DSL は構成図用で、Fargate の CPU・メモリの組み合わせ、OS・プラットフォームの
適合性や実際の割り当ては検証しません。利用可能な組み合わせは
[AWS の公式資料](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html)
で確認してください。

```text
aws.ecs-task-definition api_definition "API タスク定義" cpu=512 memory=1024 requiresCompatibilities=[FARGATE]
aws.ecs-cluster api_cluster "ECS クラスター" capacityProviders=[FARGATE,FARGATE_SPOT] {
  aws.ecs-service api_service "API サービス" launchType=FARGATE desiredCount=2
}
api_service -> api_definition kind=dependency label="使用するタスク定義"
```

コンテナの環境変数や認証情報は記載しないでください。

[ecs-beanstalk.infra](../examples/ecs-beanstalk.infra) はECSのサービス、単発タスク、
タスク定義と、Beanstalk StandardのWeb/Worker環境の設計例です。
実行タスクや管理下EC2は実環境から取得した情報ではありません。
BeanstalkにはEKSを使うClusterモードもあります。すべての環境をALB・EC2構成とみなさず、
図に必要な実体と関係を明示してください。

概念は [ECS公式説明](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html) と
[Beanstalk公式説明](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/concepts.html) に基づきます。

## Transit Gateway・RAM・Google Cloud VPN

[transit-vpn.infra](../examples/transit-vpn.infra) は、AWSの所有アカウント・本番/開発の参加アカウントと
Google Cloudプロジェクトを分けた設計例です。
TGWを各VPCへ複製せず、所有アカウントに一つ置き、参加側のアタッチメントから関連線を結びます。

| 型                                                               | 意味                                    |
| ---------------------------------------------------------------- | --------------------------------------- |
| `aws.transit-gateway`                                            | ネットワークの接続ハブ                  |
| `aws.tgw-attachment`                                             | VPCアタッチメント                       |
| `aws.tgw-route-table`                                            | TGWルートテーブル                       |
| `aws.tgw-route-association` / `aws.tgw-route-propagation`        | 関連付け・経路伝播の設定                |
| `aws.ram-share`                                                  | RAMリソース共有                         |
| `aws.ram-resource-association` / `aws.ram-principal-association` | 共有リソース・共有先の設定              |
| `aws.customer-gateway` / `aws.vpn-connection`                    | AWS側の対向定義・Site-to-Site VPN接続   |
| `gcp.ha-vpn` / `gcp.external-vpn` / `gcp.vpn-tunnel`             | HA VPN・外部対向定義・個別トンネル      |
| `gcp.router` / `gcp.router-interface` / `gcp.bgp-peer`           | Cloud Router・インターフェース・BGPピア |

共有先は `auth`、アタッチメント・トンネル・関連付け・伝播設定は `association` の線で区別できます。
RAMの共有やルート設定だけを、通信成立やVPN/BGPの稼働状態とみなしません。
アカウントを折りたたむと跨る接続を集約し、展開すると元の端点とkindを復元します。
Google VPCはglobal、HA VPNとCloud Routerは明示したリージョンに置きます。

公式の [AWS共有TGW](https://docs.aws.amazon.com/vpc/latest/tgw/working-with-transit-gateways.html) と
[Google CloudからAWSへのHA VPN](https://docs.cloud.google.com/network-connectivity/docs/vpn/how-to/connect-ha-vpn-aws-peer-gateway)
を根拠に、構成例は所有アカウント内のAWS VPN接続2本・Customer Gateway2つ、Google側4トンネルを描きます。
PSKや実IPは含みません。構成図の設計例であり、接続状態やSLA、ルートの到達性を検証する機能ではありません。

## AWS Organizations

[organizations.infra](../examples/organizations.infra) では、組織 → Root → 入れ子OU → アカウントを境界で定義します。
型は `aws.organization`、`aws.organization-root`、`aws.organizational-unit`、`aws.organization-account` です。
アカウント内にはリージョン・VPC・各サービスを置けます。既存の `account` も引き続き使えます。
管理アカウントとメンバーアカウントは名前や `meta.role` で明示します。
概要ではOrganizationsアカウントも折りたたみ、OUは独立して展開・折りたたみできます。

`aws.organization-policy` と `aws.organization-policy-attachment` でポリシーと適用設定を分けられます。
`meta.policyType` にSCP・タグポリシー等の種別を記述し、Root・OU・アカウントへの適用を `association` で結びます。
組織の所属だけからRAM共有・IAMの信頼や通信関係を推測しません。
SCPの継承・実効権限の計算や実際のアカウント作成は行いません。
SCPは権限を付与せず、管理アカウントにも適用されません。
[Organizationsの概念](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_getting-started_concepts.html) と
[SCPの公式説明](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html) を参照してください。

## 図上の表・リスト

サービスカードに `display=table` または `display=list` を指定すると、選択しなくても設定を読めます。
境界への指定はできません。列・行・項目は文字列配列で、HTMLを解釈しません。

```text
aws.tgw-route-table routes "TGW routes" display=table columns=["Destination", "Target"] rows=["0.0.0.0/0", "Inspection VPC", "10.100.5.0/24", "System A VPC"]
aws.vpc-endpoint endpoints "Endpoints" display=list items=["ECR API", "ECR Docker", "CloudWatch Logs"]
```

`columns` は空でない列名配列、`rows` は行順に並べたセルの配列です。
`rows` の要素数は列数の倍数にしてください。空の `rows` はヘッダーのみの表になります。
`list` には `items` を指定します。表に `items`、リストに `columns` / `rows` は指定できません。
内容の幅と折り返し高さを自動配置に渡します。境界を折りたたむとカードを隠し、展開すると復元します。
表の文字列は経路設定の説明であり、ID参照・ルート評価・通信成立の証明ではありません。

資料から再記述した構成図と確認範囲は [構成図資料の対応確認](architecture-coverage.md) を参照してください。

## アカウント・リージョン・AZの表示

表示名の下に、明示した `account`（アカウントID）、`project`、`subscription`、`region`、`az`、`azId`、`cidr` をラベル付きで表示します。
展開・折りたたみの両方で読める領域を確保します。国旗と「東京」等の名前はそのまま残します。
Terraformの `availability_zone`、`availability_zone_id`、`cidr_block` も同じ表示に使います。
対応するDSL属性が併存する場合は `az`、`azId`、`cidr` を優先します。

```text
account prod "本番アカウント" account="012345678901" {
  region tokyo "東京" region="ap-northeast-1" {
    subnet app "アプリ Subnet" private az="ap-northeast-1a" cidr="10.0.10.0/24"
  }
}
```

IDは文字列で指定し、先頭ゼロを保持します。親・名前・provider aliasから未指定の所属を推測して表示しません。
複数SubnetのサービスにはAZを一つに決めず、Subnetの関連を使います。
AZ名だけでアカウント間の同じ物理ゾーンを示すとは扱いません。確認できたAZ IDは `azId` に明記できます。
[AWSのアカウント識別子](https://docs.aws.amazon.com/general/latest/gr/acct-identifiers.html) と
[AZ IDの説明](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/dh-sharing.html) を参照してください。
[identity.infra](../examples/identity.infra) は架空IDを使った表示例です。

## EKS と Kubernetes の境界

`aws.eks` / `aws.eks-cluster`、`aws.eks-node-group`、`aws.eks-fargate-profile`、
`k8s.namespace`、`k8s.deployment` は入れ子を持ち、個別・一括で展開できます。
Pod、Service、Ingress、ServiceAccount、Node、Role、RoleBinding、NetworkPolicy は
`k8s.pod`、`k8s.service`、`k8s.ingress`、`k8s.service-account`、`k8s.node`、
`k8s.role`、`k8s.role-binding`、`k8s.network-policy` として表現できます。
Namespace と Node の所属は同じ意味ではありません。Namespace 内の Pod と Node は関連線で結びます。
EKS の VPC 内の囲みはネットワークとの論理的な関係であり、AWS 管理コントロールプレーンの物理配置を断定しません。

`replicas` は非負整数、`cpuRequest` / `cpuLimit` / `memoryRequest` / `memoryLimit` は Kubernetes quantity の文字列です。
quantity は表示用に保持し、Kubernetes の全構文・単位の妥当性は評価しません。
ECS の `cpu`（units）・`memory`（MiB）とは別の属性を使います。
Pod Identity や Access Entry は専用カードと `auth` / `association` の接続で表現します。
認証設定や Namespace の囲みだけでは、通信成立・分離・実効権限を保証しません。

## サービスの設定文字列

`config` に設定の全文を JSON 形式で引用し、改行を `\n` として記述できます。
`configFormat` は `nginx`、`yaml`、`json`、`text` のいずれかで、`config` と合わせて使います。
省略時は通常のテキストです。右ペインから複数行で編集できます。

```text
software.nginx proxy "NGINX" configFormat=nginx config="events {}\nhttp { server { listen 8080; } }\n"
software.envoy mesh "Envoy" configFormat=yaml config="static_resources: {}\n"
```

設定内容は不活性な文字列として保持します。Nginx・Envoy の構文検査・デプロイ・設定からの通信線生成は行いません。
ファイル参照、シェル、テンプレート、HTML は実行せず、往復と単一HTMLで同じテキストを保ちます。
共有用HTMLに含まれるため、秘密鍵・トークン・パスワードを埋め込まないでください。
