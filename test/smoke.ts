/* eslint-disable no-console */
(globalThis as Record<string, unknown>).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
const { createPinia, setActivePinia } = await import('pinia');
const { useFlagStore } = await import('../src/stores/flags');

setActivePinia(createPinia());
const store = useFlagStore();
const past = '2026-10-04T00:01';
let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failures += 1;
}

// 1. 种子：f1 有等待生效的 v3（仅产品审批），f2/f3 有正在生效的 v1
check('seed: f1 v3 等待生效', store.releasesOf('f1').find((r) => r.version === 3)?.status === 'pending');
check('seed: f2 v1 正在生效', store.effectiveOf('f2')?.version === 1);

// 2. 审批未完成时到点 → 切换失败，留待处理，原状态不变
store.scheduleRelease('r3', past);
store.tick();
const r3 = store.releaseById('r3')!;
check('审批未完成到点 → 留待处理', r3.status === 'pending' && !!r3.failureReason);
check('审批未完成到点 → f1 仍未启用', store.flagById('f1')!.enabled === false);

// 3. 补齐审批后重设定时 → 一次性切换并记下生效时间
store.approveRelease('r3', '研发负责人');
store.scheduleRelease('r3', past);
store.tick();
check('双审批后到点 → v3 正在生效', store.effectiveOf('f1')?.version === 3);
check('切换后开关启用且放量 10%', store.flagById('f1')!.enabled && store.effectiveOf('f1')!.rollout === 10);
check('记录了生效时间', !!store.releaseById('r3')!.effectiveAt);

// 4. 依赖开关被关掉 → 到点切换失败，保持原生效版本
store.submitRelease(); // f1 v4
store.approveRelease(store.releasesOf('f1')[0].id, '产品负责人');
store.approveRelease(store.releasesOf('f1')[0].id, '研发负责人');
store.emergencyStop('f3'); // 依赖 payment-v3 停用
store.scheduleRelease(store.releasesOf('f1')[0].id, past);
store.tick();
const v4 = store.releasesOf('f1')[0];
check('依赖未启用 → v4 待处理', v4.version === 4 && v4.status === 'pending' && v4.failureReason!.includes('payment-v3'));
check('依赖未启用 → 仍保持 v3 生效', store.effectiveOf('f1')?.version === 3);

// 5. 新提交使旧候选审批失效（作废）
store.submitRelease(); // f1 v5，v4 应作废
const v4after = store.releasesOf('f1').find((r) => r.version === 4)!;
check('后续提交 → v4 作废且注明审批失效', v4after.status === 'voided' && v4after.voidReason!.includes('失效'));

// 6. 依赖恢复后重试 → 切换成功，v3 作废
const f3 = store.flagById('f3')!;
f3.enabled = true; // 模拟依赖恢复
const v5 = store.releasesOf('f1')[0];
store.approveRelease(v5.id, '产品负责人');
store.approveRelease(v5.id, '研发负责人');
store.attemptRelease(v5.id, '手动');
check('依赖恢复后重试 → v5 生效', store.effectiveOf('f1')?.version === 5);
check('v3 已被取代作废', store.releaseById('r3')!.status === 'voided');

// 7. 紧急停止与待生效发布撞单 → 停止优先，待生效一并作废
store.submitRelease(); // f1 v6 pending
store.emergencyStop('f1');
check('紧急停止 → 开关关闭', store.flagById('f1')!.enabled === false);
check('紧急停止 → 生效版本作废', store.releasesOf('f1').every((r) => r.status !== 'effective'));
check('紧急停止 → 待生效版本一并作废', store.releasesOf('f1').find((r) => r.version === 6)!.status === 'voided');
store.tick();
check('紧急停止后定时不再切换', store.releasesOf('f1').every((r) => r.status !== 'effective'));

// 8. 回滚恢复上一个生效版本
store.rollback('f1');
check('回滚 → 恢复 v5 生效', store.effectiveOf('f1')?.version === 5 && store.flagById('f1')!.enabled);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
