import type { Page, Request } from '@playwright/test';

/** 共有ホストのネットワーク変更で初期ロードが中断された場合だけ、一度読み直す。 */
export async function navigateWithNetworkRecovery(
  page: Pick<Page, 'on' | 'off'>,
  navigate: Page['goto'],
  url: string,
  options?: Parameters<Page['goto']>[1],
): ReturnType<Page['goto']> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let networkChanged = false;
    const failed = (request: Request) => {
      if (request.failure()?.errorText === 'net::ERR_NETWORK_CHANGED') networkChanged = true;
    };
    page.on('requestfailed', failed);
    let response: Awaited<ReturnType<Page['goto']>> = null;
    try {
      response = await navigate(url, options);
    } catch (error) {
      if (!networkChanged || attempt === 1) throw error;
    } finally {
      page.off('requestfailed', failed);
    }
    if (!networkChanged) return response;
    if (attempt === 1) throw new Error('初期ロード中のネットワーク変更が再発しました');
    console.warn('初期ロードで ERR_NETWORK_CHANGED を検出したため、一度だけ読み直します');
  }
  throw new Error('初期ロードを完了できませんでした');
}
