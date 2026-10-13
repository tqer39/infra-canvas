# リージョンの国旗

`region="ap-northeast-1"`、`region="asia-northeast1"`、`region="japaneast"` など、
リソースの明示的な `region` 属性から国・地域の旗を表示します。カードと選択時の詳細パネルに表示し、
国名を代替テキスト、国名とリージョンコードをツールチップで確認できます。

リージョンと国・地域の対応は [region-countries.json](../src/assets/region-countries.json) に保存しています。
確認日: 2026-10-13。以下の公式資料の物理的な所在地を根拠にしています。

- [AWS リージョン一覧](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html)
- [Google Cloud リージョン・ゾーン一覧](https://docs.cloud.google.com/compute/docs/regions-zones)
- [Azure リージョン一覧](https://learn.microsoft.com/en-us/azure/reliability/regions-list)

対応表のコードに完全一致する場合だけ表示します（前後の空白と大小文字は正規化）。
未知のコード、`global`、複数国にまたがるロケーション、AZ コードには旗を付けません。
表示名、リソース ID、親のリージョンからの推測や所属の継承は行いません。
旗は国・地域の所在地を示す補助表示であり、サービスの利用可否やデータ保管の保証を意味しません。

国旗 SVG は [flag-icons](https://github.com/lipis/flag-icons) の `flags/4x3`（版は国旗マニフェスト参照） から必要なものを変更せず同梱しています。
[MIT ライセンス](../src/assets/flags/LICENSE.txt) と [取得元・SHA-256](../src/assets/flags/manifest.json) を保存しています。
外部 CDN や追加の実行時依存はなく、単一 HTML にも SVG とライセンスを含めます。
