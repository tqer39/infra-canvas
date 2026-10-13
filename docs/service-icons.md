# 主要サービスのアイコン一覧

[Simple Icons](https://simpleicons.org/) は主要ブランドをまとめた公開 SVG カタログです。
日本のサービスも含まれます。各社公式のブランドキットと併用します。
人気順のランキングではなく、構成図で扱いやすいホスティング・DB・監視・認証・CI・共同作業の代表例です。

追加34種と既存の1Password・Elasticsearch・Kibanaは、Simple Icons（版はマニフェスト参照） の
ブランドカラー（`hex`）を SVG の `fill` 属性に適用して同梱しています。形状は変更しません。
Vercel・Notion など、ブランドカラーが黒のサービスは黒で表示します。
既存9種と合わせ、サービス・技術の43種に対応します。クラウドの15アイコンは別に維持します。
外部 CDN や新しい npm 依存は使わず、単一 HTML にも埋め込みます。
[既存9種の対応表・利用条件](assets.md) と、`src/assets/manifest.json` に版・取得元・カラー・原本と着色後のハッシュを記録しています。
Simple Icons の CC0 はブランドの商標利用を許諾するものではありません。提供元の条件が別途適用されます。

| サービス・技術  | DSL の型              | 区分           | ブランドの確認先                                                                                                                                             |
| --------------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare      | `saas.cloudflare`     | 海外・共通技術 | [提供元](https://www.cloudflare.com/trademark/)                                                                                                              |
| Vercel          | `saas.vercel`         | 海外・共通技術 | [提供元](https://vercel.com/geist/brands)                                                                                                                    |
| Netlify         | `saas.netlify`        | 海外・共通技術 | [提供元](https://www.netlify.com/press/)                                                                                                                     |
| Supabase        | `saas.supabase`       | 海外・共通技術 | [提供元](https://github.com/supabase/supabase/blob/4031a7549f5d46da7bc79c01d56be4177dc7c114/packages/common/assets/images/supabase-logo-wordmark--light.svg) |
| Firebase        | `saas.firebase`       | 海外・共通技術 | [提供元](https://firebase.google.com/brand-guidelines)                                                                                                       |
| DigitalOcean    | `saas.digitalocean`   | 海外・共通技術 | [提供元](https://www.digitalocean.com/press/)                                                                                                                |
| Render          | `saas.render`         | 海外・共通技術 | [提供元](https://render.com)                                                                                                                                 |
| Railway         | `saas.railway`        | 海外・共通技術 | [提供元](https://railway.app)                                                                                                                                |
| MongoDB         | `saas.mongodb`        | 海外・共通技術 | [提供元](https://www.mongodb.com/pressroom)                                                                                                                  |
| Redis           | `saas.redis`          | 海外・共通技術 | [提供元](https://redis.io/brand-guidelines)                                                                                                                  |
| PostgreSQL      | `saas.postgresql`     | 海外・共通技術 | [提供元](https://www.postgresql.org/about/policies/trademarks/)                                                                                              |
| MySQL           | `saas.mysql`          | 海外・共通技術 | [提供元](https://www.mysql.com/about/legal/logos.html)                                                                                                       |
| Docker          | `saas.docker`         | 海外・共通技術 | [提供元](https://www.docker.com/company/newsroom/media-resources)                                                                                            |
| Kubernetes      | `saas.kubernetes`     | 海外・共通技術 | [提供元](https://github.com/kubernetes/kubernetes/tree/cac53883f4714452f3084a22e4be20d042a9df33/logo)                                                        |
| Terraform       | `saas.terraform`      | 海外・共通技術 | [提供元](https://www.hashicorp.com/brand)                                                                                                                    |
| Sentry          | `saas.sentry`         | 海外・共通技術 | [提供元](https://sentry.io/branding/)                                                                                                                        |
| Datadog         | `saas.datadog`        | 海外・共通技術 | [提供元](https://www.datadoghq.com/about/resources/)                                                                                                         |
| Grafana         | `saas.grafana`        | 海外・共通技術 | [提供元](https://grafana.com)                                                                                                                                |
| Prometheus      | `saas.prometheus`     | 海外・共通技術 | [提供元](https://prometheus.io)                                                                                                                              |
| CircleCI        | `saas.circleci`       | 海外・共通技術 | [提供元](https://circleci.com/press)                                                                                                                         |
| Bitbucket       | `saas.bitbucket`      | 海外・共通技術 | [提供元](https://atlassian.design/foundations/logos)                                                                                                         |
| Jira            | `saas.jira`           | 海外・共通技術 | [提供元](https://atlassian.design/foundations/logos/)                                                                                                        |
| Notion          | `saas.notion`         | 海外・共通技術 | [提供元](https://www.notion.so)                                                                                                                              |
| Discord         | `saas.discord`        | 海外・共通技術 | [提供元](https://discord.com/branding)                                                                                                                       |
| Stripe          | `saas.stripe`         | 海外・共通技術 | [提供元](https://stripe.com/newsroom/information)                                                                                                            |
| Auth0           | `saas.auth0`          | 海外・共通技術 | [提供元](https://auth0.com)                                                                                                                                  |
| Okta            | `saas.okta`           | 海外・共通技術 | [提供元](https://www.okta.com/terms-of-use-for-okta-content/)                                                                                                |
| Anthropic       | `saas.anthropic`      | 海外・共通技術 | [提供元](https://www.anthropic.com)                                                                                                                          |
| Hugging Face    | `saas.huggingface`    | 海外・共通技術 | [提供元](https://huggingface.co/brand)                                                                                                                       |
| Qiita           | `saas.qiita`          | 日本           | [提供元](https://help.qiita.com/ja/articles/others-brand-guideline)                                                                                          |
| Zenn            | `saas.zenn`           | 日本           | [提供元](https://zenn.dev/mediakit)                                                                                                                          |
| LINE            | `saas.line`           | 日本           | [提供元](https://line.me/en/logo)                                                                                                                            |
| Hatena Bookmark | `saas.hatenabookmark` | 日本           | [提供元](https://hatenacorp.jp/press/resource)                                                                                                               |
| Rakuten         | `saas.rakuten`        | 日本           | [提供元](https://global.rakuten.com/corp/news/media)                                                                                                         |

[service-catalog.infra](../examples/service-catalog.infra) に全サービスの例があります。
接続を含む実例は [saas.infra](../examples/saas.infra) です。

Backlog は [公式ロゴページ](https://nulab.com/ja/about/logo/) にダウンロード申請があります。
kintone は [製品ロゴ使用ガイドライン](https://cybozu.co.jp/logotypes/assets/kintone/kintone-visual-identity-guide.pdf) を公開しています。
この固定版の Simple Icons にないサービスを、別会社のアイコンで代用しません。
追加するときは公式素材の取得・同梱条件を確認します。
