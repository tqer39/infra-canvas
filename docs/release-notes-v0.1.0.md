# Omnodi v0.1.0

Omnodi の初回リリースです。このファイルは今後のリリース用 PR の参考として、主な機能を記録しています。公開済み v0.1.0 のタグ・イメージ・Release を変更するものではありません。

## 主な機能

- 独自 DSL と Terraform の情報から、AWS・Google Cloud・Azure・外部サービスのインフラ構成図を生成します。
- 自動配置、検索、パン・ズーム、境界の展開・折りたたみ、属性編集、元に戻す・やり直すに対応し、属性と DSL を同期します。
- DSL の保存・読み込み、SVG・PNG 出力、印刷に対応します。JavaScript・CSS・アイコンを含む単一 HTML を生成し、オフラインでも操作できます。
- CLI で DSL の検証、Terraform の取り込み、プレビュー、DSL・HTML・SVG の出力ができます。
- Docker で開発環境のセットアップなしに起動でき、linux/arm64・linux/amd64 に対応します。

本体は MIT License です。同梱アイコンなどには提供元の別条件が適用されます。詳細は [README](../README.md) を参照してください。
