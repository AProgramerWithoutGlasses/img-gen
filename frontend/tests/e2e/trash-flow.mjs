import { expect } from '@playwright/test';

// Shared user workflow for the preview store and the real Go/MySQL server.
export async function checkTrashFlow(page, { readState, shot }) {
  const origin = new URL(page.url()).origin;
  const go = async path => {
    await page.goto(origin + '/#' + path);
    await expect(page.getByRole('button', { name: '我的账户', exact: true })).toBeVisible();
  };
  const own = state => state.generations.filter(item => item.userId === state.currentUserId);
  const accounting = state => ({
    balance: state.users.find(user => user.id === state.currentUserId).balance,
    generations: own(state).map(record => ({ id: record.id, cost: record.cost, status: record.status,
      succeeded: record.outputs?.filter(output => output.status === 'succeeded').length ?? record.imageIds.length,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  });
  const initial = await readState();
  const expectedAccounting = accounting(initial);
  await go('/gallery');
  const tiles = page.locator('.gallery-tile');
  await expect.poll(() => tiles.count()).toBeGreaterThanOrEqual(2);
  const originalCount = await tiles.count();
  const chooseTwo = async () => {
    await tiles.first().hover();
    await tiles.first().getByRole('checkbox').check();
    await tiles.nth(1).getByRole('checkbox').check();
  };
  const activeBar = page.getByRole('toolbar', { name: '图片整理', exact: true });
  const trashBar = page.getByRole('toolbar', { name: '回收站图片操作', exact: true });
  await page.getByRole('button', { name: '选择图片', exact: true }).click();
  await activeBar.getByRole('button', { name: /^全选/ }).click();
  await expect(activeBar.getByRole('button', { name: '取消全选', exact: true })).toHaveCount(0);
  await expect(activeBar.getByRole('button', { name: /^全选/ })).toHaveCount(0);
  await activeBar.getByRole('button', { name: '退出多选', exact: true }).click();

  await chooseTwo();
  await activeBar.getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(tiles).toHaveCount(originalCount - 2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(tiles).toHaveCount(originalCount);
  const restored = await readState();
  for (const image of initial.assets.filter(image => image.userId === initial.currentUserId)) {
    const current = restored.assets.find(item => item.id === image.id);
    expect(current?.folderIds.slice().sort()).toEqual(image.folderIds.slice().sort());
  }
  await shot('trash-undo-preserves-folders');
  await chooseTwo();
  await activeBar.getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(tiles).toHaveCount(originalCount - 2);
  await go('/gallery/trash');
  await expect(page.getByRole('region', { name: '回收站', exact: true })).toBeVisible();
  await expect(tiles).toHaveCount(2);
  await tiles.first().hover();
  for (const name of ['继续修图', '加入文件夹', '下载', '更多图片操作'])
    await expect(tiles.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(tiles.first().getByRole('button', { name: '复原', exact: true })).toBeVisible();
  await expect(tiles.first().getByRole('button', { name: '彻底删除', exact: true })).toBeVisible();
  await shot('trash-hover-only-restore-purge');

  // Keyboard selection and responsive layout retain the same two operations.
  await chooseTwo();
  await expect(trashBar).toContainText('已选 2 张');
  await expect(trashBar.getByRole('button', { name: /^全选|取消全选$/ })).toHaveCount(0);
  await shot('trash-bulk-selection-light');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(trashBar.getByRole('button', { name: '复原', exact: true })).toBeVisible();
  await expect(trashBar.getByRole('button', { name: '彻底删除', exact: true })).toBeVisible();
  await shot('trash-mobile-selection');
  await page.setViewportSize({ width: 1440, height: 900 });
  await trashBar.getByRole('button', { name: '复原', exact: true }).click();
  await expect(tiles).toHaveCount(0);
  await page.reload();
  await expect(tiles).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '回收站是空的', exact: true })).toBeVisible();
  await go('/gallery');
  await expect(tiles).toHaveCount(originalCount);

  // Single-card entry and cancellation protect permanent deletion.
  await tiles.first().hover();
  await tiles.first().getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(tiles).toHaveCount(originalCount - 1);
  await go('/gallery/trash');
  await expect(tiles).toHaveCount(1);
  await tiles.first().hover();
  await tiles.first().getByRole('button', { name: '复原', exact: true }).click();
  await expect(tiles).toHaveCount(0);
  await go('/gallery');
  await expect(tiles).toHaveCount(originalCount);
  await chooseTwo();
  await activeBar.getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(tiles).toHaveCount(originalCount - 2);
  await go('/settings/appearance');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await go('/gallery/trash');
  await expect(tiles).toHaveCount(2);
  await chooseTwo();
  await trashBar.getByRole('button', { name: '彻底删除', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '彻底删除图片？', exact: true });
  await expect(confirmation).toContainText('无法恢复');
  await expect(confirmation).toContainText('积分');
  await shot('trash-permanent-confirmation-dark');
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(tiles).toHaveCount(2);
  await trashBar.getByRole('button', { name: '彻底删除', exact: true }).click();
  await confirmation.getByRole('button', { name: '彻底删除', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(tiles).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: '回收站是空的', exact: true })).toBeVisible();
  await go('/gallery');
  await expect(tiles).toHaveCount(originalCount - 2);
  const final = await readState();
  expect(accounting(final)).toEqual(expectedAccounting);
  await shot('trash-purge-persisted-accounting-preserved');
  await go('/settings/credits');
  const history = page.getByRole('region', { name: '历史用量', exact: true });
  await expect(history).toContainText(`共 ${own(final).length} 条记录`);
  await shot('trash-credit-history-retained');
}
