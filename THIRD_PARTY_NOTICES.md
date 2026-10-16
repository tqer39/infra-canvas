# 第三者素材と利用条件

Infra Canvas 本体のコード・文書・独自素材は [MIT License](LICENSE) です。
第三者のコード・素材・モデルと商標に、このライセンスを上書きして適用しません。

## 同梱アイコン

- AWS・Google Cloud・Azure と各サービスの公式素材は、提供元の利用・再配布・商標条件に従います。
  対応する配布元・ハッシュ・利用条件は [アイコン資料](docs/assets.md)、
  [サービス一覧](docs/service-icons.md)、`src/assets/manifest.json` を参照してください。
- Simple Icons の素材は CC0 です。`src/assets/SIMPLE-ICONS-LICENSE.txt` と
  `src/assets/SIMPLE-ICONS-DISCLAIMER.txt` を同梱しています。商標の許諾は別です。
- flag-icons の国旗素材は MIT です。著作権・許諾表示は `src/assets/flags/LICENSE.txt`、
  配布元・版は `src/assets/flags/manifest.json` に記録しています。
- `external-user.svg` と `saas-fly.svg` は本プロジェクト独自の汎用記号です。
  `saas-fly.svg` は Fly.io の公式ブランド画像を含みません。

商標は各権利者に帰属します。本プロジェクトへの承認・提携を示しません。
ソースや生成した HTML の再配布でも、含まれる第三者素材の条件を確認してください。

## 依存コードとモデル

npm 依存にはそれぞれのライセンスが適用されます。固定した版と取得元は `package-lock.json`、
著作権・許諾文はインストール先の各パッケージを参照してください。
ビルド時の第三者コードのライセンスコメントは削除せず配布物に含めます。
バンドルされた依存の許諾原文はビルド時に `dist/THIRD_PARTY_LICENSES.txt` と
`dist/web/THIRD_PARTY_LICENSES.txt` に収集し、単一 HTML の末尾にも埋め込みます。
HTML 内では `infra-canvas-license-notices` 要素から確認できます。
ELK.js は EPL-2.0 を選択して利用します。本体の MIT と区別し、依存の変更時にはその条件に従います。
ELK.js のソースは [公式リポジトリ](https://github.com/kieler/elkjs)、
元の ELK のソースは [公式リポジトリ](https://github.com/eclipse/elk) で提供されています。
ブラウザーで別途取得する LLM の重み・ランタイムにも各配布元の条件が適用されます。
