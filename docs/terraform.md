# Terraform の取り込み

`importTerraformRepository({ repository, root?, json? })` はローカルリポジトリを
読み取り、共通の `Diagram` を返します。Terraform、Git、provider のコマンド実行、
認証、plan 作成、apply は行いません。JSON ファイルパスは repository 基準です。
root は repository 内の対象ディレクトリを指定します。

```typescript
import { importTerraformRepository, importTerraformJSON } from 'infra-canvas/terraform';
const diagram = await importTerraformRepository({
  repository: '/path/to/terraform-repository',
  root: 'environments/production',
  json: 'local-plan.json',
});
const fromJSON = importTerraformJSON(document, { repository: '/path/to/repository' });
```

CLI の実行例です。出力した DSL は通常のビューアへ入力できます。

```bash
npm run cli -- import examples/terraform --json fixture-plan.json --out /tmp/model.json --dsl /tmp/imported.infra
```

## 入力の種類と根拠

[Terraform 公式 JSON 仕様](https://developer.hashicorp.com/terraform/internals/json-format)
に従う `terraform show -json` の format_version 1.x を扱います。
planned_values / resource_changes は予定構成、values は state の記録として識別します。
raw tfstate や binary plan は直接扱いません。plan が削除を予定するリソースは
planned_values に存在しないため予定構成へ含めません。

JSON の resource address は provenance に保持します。module、count、for_each の実体は
それぞれ別ノードです。DSL の ID には UTF-8 アドレスの hex を使用し、元アドレスを
ラベルと provenance に残します。同じアドレスは同じ ID になります。

root と `./`、`../` から始まるローカル module の `.tf` を読み取り、宣言のファイル・行を
対応づけます。リポジトリ外、外部 module、循環 module は推測で補いません。
Git の HEAD/ref をファイルから読める場合だけ commit を記録します。
コミット未確定、外部 module のソース、アカウントの未解決を表示できます。

## AWS の意味づけ

VPC、Subnet、EC2、ALB、ECS、RDS、SG、IGW、NAT、ルート、S3、Lambda、IAM Role、
OIDC 等を代表種別へ変換します。その他も Terraform の種別で残します。

Subnet がルートテーブルへ明示的に関連し、IGW 宛ての IPv4/IPv6 デフォルトルートを
確認できた場合だけ public とします。名称による判定はありません。証拠が足りない
Subnet は unknown です。main route table の暗黙関連や Private の断定は未対応です。

EC2 の subnet_id は実配置として扱います。ALB の subnets、ECS の network_configuration、
DB Subnet Group 等は複数 Subnet の配置設定として関連線で表します。
SG は複数リソースから関連できる重複可能な overlay です。排他的な所属境界にしません。
SG ルールは通信成立の証拠にしません。

Terraform configuration の直接 resource reference と depends_on は dependency です。
state の depends_on も依存として扱います。通信経路へ変換しません。
provider alias は provider 属性として保持し、アカウントを推定しません。
module 出力経由や曖昧な実体参照の依存は未解決のままです。

## 機密値と静的取り込みの範囲

表示属性は availability_zone、availability_zone_id、region、CIDR、instance_type、engine、engine_version の
形式検証つき allowlist です。ECS タスク定義の `cpu`（CPU units）、`memory`（MiB）、
`requires_compatibilities` とサービスの `launch_type`、`desired_count` も取り込みます。
数値は整数または数字だけの文字列を使い、機密・未確定の属性は除外します。
`container_definitions` の JSON 内の環境変数などは取り込みません。
任意の name、description、tags、user_data、パスワード、
接続文字列、outputs、variables は表示モデルへ取り込みません。
sensitive_values / after_sensitive が true または配下に true を含む属性は除外します。
Subnet/SG/VPC の ID は関連解決にのみ使い、値を属性へコピーしません。
Organizations account の非機密・確定した12桁の `id` は例外として `account` に保存し、図上の識別情報に表示します。
機密・未確定のアカウントIDとAZ IDは表示せず、provider aliasからアカウントIDを推測しません。
unknown は対応する安全属性の未確定情報として記録します。

アドレス、ファイルパス、リポジトリパスは出典として残ります。共有前にはそれらの
公開範囲も確認してください。Terraform は for_each の機密 key を許容しませんが、
入力 JSON 自体が不正な場合のアドレス匿名化は行いません。

JSON を指定しない場合は限定した HCL scanner で宣言・文字列/数値の literal と直接参照を
読み取ります。変数、関数、式評価、dynamic、count/for_each 展開、外部 module は
評価しません。count/for_each は宣言を一つ残し、plan JSON が必要な旨を表示します。
静的取り込みは構文検証器ではありません。Terraform の validate を代替しません。

Terraform show JSON は機密値を平文で含み得ます。
[公式 show の注意](https://developer.hashicorp.com/terraform/cli/commands/show)に従い、
実環境の plan/state/JSON を Git へ追加しないでください。
examples/terraform の fixture-plan.json / fixture-state.json は合成した匿名サンプルです。

## 検証

```bash
node --import tsx --test tests/terraform.test.ts
```

plan/state 識別、module/count/for_each の実体、ソース対応、ルート根拠、配置設定と実配置、
SG の重複関連、依存の意味、未確定値、秘密の除外、静的読み取りを回帰テストします。

## ECS と Elastic Beanstalk

`aws_ecs_cluster`、`aws_ecs_service`、`aws_ecs_task_definition` を別種別へ変換します。
サービスの `cluster` を解決できればクラスターの配下に置き、`task_definition` は定義への依存線にします。
ID・ARN・名前または静的な直接参照が、一つの候補と完全一致する場合だけ関連付けます。
異なるリビジョンを同一視しません。曖昧な候補は未解決として残します。
タスク定義はクラスターへ所属させません。

`aws_elastic_beanstalk_application`、`aws_elastic_beanstalk_environment`、
`aws_elastic_beanstalk_application_version` をアプリケーション・環境・版へ変換します。
`application` の一意な参照で環境と版を所属させ、同じアプリケーション内の
`version_label` と版の `name` が一意に一致する場合に依存線を表示します。

参照値は関連解決だけに使います。機密・未確定値は除外し、コンテナ定義JSON、環境変数、
Beanstalkの任意の `setting`、ソースバンドルの場所を表示属性へ取り込みません。
設定内のVPC・Subnetの解釈、管理下のEC2・ALB・ASG・EKS等の自動発見は未対応です。
Terraformのサービス定義から実行タスクを推測して増やすこともありません。
必要な実体はDSLで明示できます。クラウドAPIへの接続は行いません。

## Transit Gateway・RAM・Google Cloud VPN

AWSのTGW、VPCアタッチメント、TGWルートテーブルと関連付け・伝播、RAM共有と
リソース/共有先関連、Customer Gateway、VPN接続を別ノードに変換します。
設定のID・ARNから対象を一意に解決し、`association` の線で関係を表示します。
VPN接続のTGW attachment IDもルートテーブル関連の解決に使えます。
同一IDの候補が複数ある場合は任意の一件を選びません。
共有先のアカウント・OU・組織は自動生成せず、principal値も表示モデルへコピーしません。
provider aliasからアカウント所属を推定しません。

Google providerは今回の限定対応として、`google_compute_network`、HA VPN、external VPN、
VPN tunnel、Cloud Router、router interface、router peerのplan/state JSONと静的直接参照を扱います。
self_link・ID・直接参照を完全一致で解決します。裸の名前は明示的なproject/regionの一致が必要で、
インターフェース名はrouterも一致させます。解決できない外部参照は未解決として残します。
別state間の自動結合やIPアドレスからのAWS/Google対向の自動発見は行いません。

PSK、VPNの生成済み設定XML、実IP、BGP認証、任意の設定は取り込みません。
トンネル/BGPの稼働状態、ルーティングの到達性、共有承認状態をクラウドAPIから確認する機能はありません。
Terraformの参照は通信線へ変換しません。必要なクラウド間の対向・通信意図はDSLで明示できます。

## Organizationsの階層とポリシー

`aws_organizations_organization`、`aws_organizations_organizational_unit`、`aws_organizations_account`、
`aws_organizations_policy`、`aws_organizations_policy_attachment` を取り込みます。
organizationの明示的な `roots` からRoot境界を作り、OU・アカウントの `parent_id` を一意なID・直接参照で解決します。
静的な `aws_organizations_organization.NAME.roots[0].id` の直接参照もRootを表示します。
繰り返し定義・式・機密値・未確定値・複数候補・所属循環は推測せず未解決に残します。
`parent_id` 省略時のRoot所属、organizationのaccounts一覧からのアカウント生成や管理アカウント推定は行いません。

policy attachmentの `policy_id` と `target_id` は設定関係の線に変換します。
明示した対応ポリシー種別だけを `meta.policyType` に取り込み、本文JSON・アカウントメール・タグはコピーしません。
ポリシーの継承や有効性、実効権限の評価、実際のアカウント作成・招待・移動は行いません。
各アカウント内のTerraformリソース所属をprovider aliasから推測しません。必要な配置はDSLで明示してください。
