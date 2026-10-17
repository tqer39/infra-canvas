import awsSource from '../../examples/aws.infra?raw';
import subnetSecuritySource from '../../examples/subnet-security.infra?raw';
import ecsBeanstalkSource from '../../examples/ecs-beanstalk.infra?raw';
import organizationsSource from '../../examples/organizations.infra?raw';
import referenceAwsWebSource from '../../examples/reference/aws-web.infra?raw';
import referenceClassmethodWebsocketSource from '../../examples/reference/classmethod-websocket.infra?raw';
import referenceServerworksInspectionSource from '../../examples/reference/serverworks-inspection.infra?raw';
import referenceEksSingleAccountSingleClusterSource from '../../examples/reference/eks-single-account-single-cluster.infra?raw';
import referenceEksSingleAccountMultiClusterSource from '../../examples/reference/eks-single-account-multi-cluster.infra?raw';
import referenceEksMultiAccountSingleClusterSource from '../../examples/reference/eks-multi-account-single-cluster.infra?raw';
import referenceEksMultiAccountMultiClusterSource from '../../examples/reference/eks-multi-account-multi-cluster.infra?raw';
import gcpWebSource from '../../examples/gcp-web.infra?raw';
import gcpAnalyticsSource from '../../examples/gcp-analytics.infra?raw';
import referenceGcpDeliverySource from '../../examples/reference/gcp-delivery.infra?raw';
import azureWebSource from '../../examples/azure-web.infra?raw';
import azureFunctionsSource from '../../examples/azure-functions.infra?raw';
import referenceAzurePrivateLinkSource from '../../examples/reference/azure-private-link.infra?raw';
import gcpAzureSource from '../../examples/gcp-azure.infra?raw';
import multicloudSource from '../../examples/multicloud.infra?raw';
import transitVpnSource from '../../examples/transit-vpn.infra?raw';
import saasSource from '../../examples/saas.infra?raw';
import observabilitySource from '../../examples/observability.infra?raw';
import proxiesSource from '../../examples/proxies.infra?raw';
import architectureSource from '../../examples/architecture.infra?raw';
import expressionsSource from '../../examples/expressions.infra?raw';
import identitySource from '../../examples/identity.infra?raw';
import serviceCatalogSource from '../../examples/service-catalog.infra?raw';
import llmCatalogSource from '../../examples/llm-catalog.infra?raw';
import largeSource from '../../examples/large.infra?raw';

export const sampleGroups = [
  {
    label: 'AWS',
    samples: [
      { id: 'aws', label: 'AWS 2アカウント Web アプリケーション', source: awsSource },
      {
        id: 'subnetSecurity',
        label: 'AWS Subnetとセキュリティグループ',
        source: subnetSecuritySource,
      },
      {
        id: 'ecs-beanstalk',
        label: 'ECS と Elastic Beanstalk の詳細構成',
        source: ecsBeanstalkSource,
      },
      {
        id: 'organizations',
        label: 'AWS Organizations マルチアカウント（設計例）',
        source: organizationsSource,
      },
      { id: 'reference/aws-web', label: 'AWS公式・多層Web構成', source: referenceAwsWebSource },
      {
        id: 'reference/classmethod-websocket',
        label: 'クラスメソッド・CloudFront VPC Origin WebSocket',
        source: referenceClassmethodWebsocketSource,
      },
      {
        id: 'reference/serverworks-inspection',
        label: 'サーバーワークス・集中検査VPC',
        source: referenceServerworksInspectionSource,
      },
    ],
  },
  {
    label: 'EKS・Kubernetes',
    samples: [
      {
        id: 'reference/eks-single-account-single-cluster',
        label: 'EKS 単一アカウント・単一クラスター',
        source: referenceEksSingleAccountSingleClusterSource,
      },
      {
        id: 'reference/eks-single-account-multi-cluster',
        label: 'EKS 単一アカウント・複数クラスター',
        source: referenceEksSingleAccountMultiClusterSource,
      },
      {
        id: 'reference/eks-multi-account-single-cluster',
        label: 'EKS 複数アカウント・共有クラスター',
        source: referenceEksMultiAccountSingleClusterSource,
      },
      {
        id: 'reference/eks-multi-account-multi-cluster',
        label: 'EKS 複数アカウント・複数クラスター',
        source: referenceEksMultiAccountMultiClusterSource,
      },
    ],
  },
  {
    label: 'Google Cloud',
    samples: [
      { id: 'gcp-web', label: 'Google Cloud・Cloud Run Web アプリ', source: gcpWebSource },
      { id: 'gcp-analytics', label: 'Google Cloud・イベント分析', source: gcpAnalyticsSource },
      {
        id: 'reference/gcp-delivery',
        label: 'Google Cloud公式・複数プロジェクトのWeb配信',
        source: referenceGcpDeliverySource,
      },
    ],
  },
  {
    label: 'Azure',
    samples: [
      { id: 'azure-web', label: 'Azure・App Service Web アプリ', source: azureWebSource },
      {
        id: 'azure-functions',
        label: 'Azure・Blob アップロードの非同期処理',
        source: azureFunctionsSource,
      },
      {
        id: 'reference/azure-private-link',
        label: 'Azure公式・Private LinkとApp Service',
        source: referenceAzurePrivateLinkSource,
      },
    ],
  },
  {
    label: 'マルチクラウド',
    samples: [
      { id: 'gcp-azure', label: 'Google Cloud と Azure', source: gcpAzureSource },
      { id: 'multicloud', label: 'マルチクラウド設計案', source: multicloudSource },
      {
        id: 'transit-vpn',
        label: 'RAM共有 Transit Gateway と Google Cloud HA VPN（設計例）',
        source: transitVpnSource,
      },
    ],
  },
  {
    label: '外部サービス・運用',
    samples: [
      { id: 'saas', label: 'SaaS・IaaS のサービス連携', source: saasSource },
      {
        id: 'observability',
        label: 'Datadog・New Relic へのメトリクスとログ送信（設計例）',
        source: observabilitySource,
      },
      { id: 'proxies', label: 'Nginx・Envoy の設定付き構成', source: proxiesSource },
    ],
  },
  {
    label: '表現・カタログ',
    samples: [
      { id: 'architecture', label: '経路・冗長化・跨る境界', source: architectureSource },
      { id: 'expressions', label: 'インフラ表現サンプル — P2・P3', source: expressionsSource },
      { id: 'identity', label: 'アカウント・リージョン・AZの識別情報', source: identitySource },
      {
        id: 'service-catalog',
        label: '主要サービスのアイコンカタログ',
        source: serviceCatalogSource,
      },
      { id: 'llm-catalog', label: 'LLM・AI サービスのアイコン', source: llmCatalogSource },
      { id: 'large', label: '大規模構成 300リソース', source: largeSource },
    ],
  },
];
